import { getCreator, listCreators, updateLive, getOpenSession, upsertSession, addNotification, addAudit, flushStore } from './store.ts';
import { bus } from './events.ts';
import { can } from './permissions.ts';
import { applyOutcome, type Outcome, type TransitionConfig, type TransitionEvent } from './transition.ts';
import { resolveProvider, transitionConfigFromEnv, type ProviderResolution } from './provider-config.ts';
import { ProviderError, type LiveDetectionProvider } from './providers/types.ts';
import type { Creator, LiveSession } from '../../types/radar.ts';

/**
 * The backend owner of LIVE monitoring. Runs inside the Next.js server process (started from instrumentation.ts), so it
 * keeps working with no browser open and restarts with the server. State is persisted after every check; on boot it
 * simply resumes from the persisted state, staggering the first checks.
 */
export interface MonitorOptions {
  getProvider: () => ProviderResolution;
  getConfig?: (providerMinMs: number) => TransitionConfig;
  tickMs?: number;
  concurrency?: number;
  /** Minimum gap between any two outgoing provider requests (global politeness / rate limiting). */
  minGapMs?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  rand?: () => number;
}

export interface MonitorStatus {
  running: boolean; startedAt?: string; lastTickAt?: string; inFlight: number;
  checksTotal: number; failuresTotal: number; cooldownUntil?: string; lastError?: string;
  provider: { id: string; name: string; dataSource: string; commercialUse: string; platformTermsRisk: string } | null;
  problem: string | null; intervalMs: number;
}

type Hook = (session: LiveSession, creator: Creator) => void | Promise<void>;
const hooks: Hook[] = [];
/** Phase 3 registers the recorder here. It must call gate.authorize(...) itself before doing anything. */
export const onLiveStarted = (fn: Hook) => { hooks.push(fn); };

const dur = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };

export function createMonitor(o: MonitorOptions) {
  const now = o.now ?? Date.now, rand = o.rand ?? Math.random;
  const tickMs = o.tickMs ?? 1000, concurrency = o.concurrency ?? 2, minGapMs = o.minGapMs ?? 250, timeoutMs = o.requestTimeoutMs ?? 20_000;
  const inflight = new Set<string>();
  const st = { running: false, startedAt: undefined as number | undefined, lastTickAt: undefined as number | undefined, checksTotal: 0, failuresTotal: 0, cooldownUntil: 0, lastError: undefined as string | undefined };
  let timer: ReturnType<typeof setInterval> | null = null, lastLaunch = 0, lastProblem: string | null | undefined, degradedNotified = false, lastProviderNotifyAt = 0, offKick: (() => void) | null = null;
  let ticking = false;

  const cfgFor = (p: LiveDetectionProvider) => (o.getConfig ?? ((m) => transitionConfigFromEnv(process.env, m)))(p.info.minPollIntervalMs);

  function handleEvents(events: TransitionEvent[], c: Creator, provider: LiveDetectionProvider) {
    for (const e of events) {
      if (e.type === 'live-started') {
        const s = e.session;
        addAudit(c.id, 'LIVE detected', `via ${provider.info.name} · recording ${s.recordingAuthorized ? 'permitted' : `not permitted${s.recordingNote ? ` (${s.recordingNote})` : ''}`}`);
        if (c.notify) addNotification({
          kind: 'live-detected', creatorId: c.id, username: c.username, title: 'LIVE DETECTED',
          body: `@${c.username} just started broadcasting. ${s.recordingAuthorized ? 'Recording is permitted for this creator (the recorder is not built yet, so nothing is being recorded).' : 'Detection only: no recording permission on file, so nothing will be recorded.'}`,
        });
        for (const h of hooks) Promise.resolve(h(s, c)).catch((err) => console.error('[radar] onLiveStarted hook failed', err));
      } else if (e.type === 'live-ended') {
        const s = e.session; const len = Date.parse(s.endedAt!) - Date.parse(s.startedAt ?? s.firstDetectedAt);
        addAudit(c.id, 'LIVE ended', `${s.endConfirmed ? 'confirmed' : 'contact lost, end unconfirmed'} · ~${dur(len)}`);
        if (c.notify) addNotification({ kind: 'live-ended', creatorId: c.id, username: c.username, title: 'LIVE ENDED', body: `@${c.username} stopped broadcasting after about ${dur(len)}${s.endConfirmed ? '' : ' (we lost contact, so the end time is approximate)'}.` });
      } else if (e.type === 'error-started') {
        addAudit(c.id, 'Status check failing', `${e.kind}: ${e.message}`);
      } else if (e.type === 'provider-failing' && now() - lastProviderNotifyAt > 30 * 60_000) {
        lastProviderNotifyAt = now(); degradedNotified = true;
        addNotification({ kind: 'provider-error', title: 'LIVE detection is failing', body: `Checks for @${c.username} have failed ${e.count} times in a row (${e.kind}: ${e.message}). Status is shown as ERROR, not offline, until the provider answers again.` });
      } else if (e.type === 'recovered' && degradedNotified) {
        degradedNotified = false;
        addNotification({ kind: 'provider-recovered', title: 'LIVE detection recovered', body: 'The provider is answering again.' });
      }
    }
  }

  async function checkOne(c: Creator, provider: LiveDetectionProvider) {
    const cfg = cfgFor(provider);
    inflight.add(c.id); bus.publish({ type: 'checking', creatorId: c.id, on: true });
    let outcome: Outcome;
    try {
      const r = await provider.check(c.username, AbortSignal.timeout(timeoutMs));
      if (r.state === 'unknown') outcome = { ok: false, kind: 'unavailable', message: 'Provider could not determine status.' };
      else outcome = { ok: true, state: r.state, viewerCount: r.viewerCount, providerSessionId: r.sessionId, startedAt: r.startedAt };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      outcome = { ok: false, kind: pe?.kind ?? 'unavailable', message: (e as Error).message, retryAfterMs: pe?.retryAfterMs };
    }
    st.checksTotal++;
    try {
      const fresh = getCreator(c.id); if (!fresh) return;            // removed mid-check
      if (!outcome.ok) { st.failuresTotal++; st.lastError = `${outcome.kind}: ${outcome.message}`; if (outcome.kind === 'rate-limit') st.cooldownUntil = now() + Math.max(outcome.retryAfterMs ?? 0, cfg.intervalMs * 2); }
      const rec = can(fresh, 'recording');
      const t = applyOutcome(fresh.live, getOpenSession(c.id), outcome, now(), cfg, {
        creatorId: c.id, username: c.username, provider: provider.info.id,
        recordingAuthorized: rec.allowed, recordingNote: rec.reason, newId: () => `ls_${now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`,
      });
      // Spread checks out so creators don't all fire on the same tick.
      if (t.live.nextCheckAt) t.live.nextCheckAt = new Date(Date.parse(t.live.nextCheckAt) + Math.round(rand() * 0.1 * cfg.intervalMs)).toISOString();
      const important = t.events.length > 0 || fresh.live.state !== t.live.state;
      for (const s of t.closed) upsertSession(s, { durable: true });
      if (t.open) upsertSession(t.open, { durable: important });
      updateLive(c.id, t.live, { durable: important });
      handleEvents(t.events, getCreator(c.id) ?? fresh, provider);
    } finally {
      inflight.delete(c.id); bus.publish({ type: 'checking', creatorId: c.id, on: false });
    }
  }

  async function tick() {
    if (ticking) return; ticking = true;
    try {
      st.lastTickAt = now();
      const { provider, problem } = o.getProvider();
      if (problem !== lastProblem) { lastProblem = problem; bus.publish({ type: 'provider-status', problem }); }
      if (problem || !provider.info.capabilities.detection) return;      // nothing is checked, nothing is faked
      if (now() < st.cooldownUntil) return;                              // honouring a provider rate limit
      const t = now();
      const due = listCreators()
        .filter((c) => c.monitoring === 'active' && !inflight.has(c.id) && (!c.live.nextCheckAt || Date.parse(c.live.nextCheckAt) <= t))
        .sort((a, b) => Date.parse(a.live.nextCheckAt ?? '1970-01-01') - Date.parse(b.live.nextCheckAt ?? '1970-01-01'));
      for (const c of due) {
        if (inflight.size >= concurrency || now() - lastLaunch < minGapMs) break;
        lastLaunch = now();
        void checkOne(c, provider).catch((e) => { st.lastError = (e as Error).message; console.error('[radar] check failed', e); });
      }
    } finally { ticking = false; }
  }

  return {
    start() {
      if (st.running) return;
      st.running = true; st.startedAt = now();
      // Recovery: resume from persisted state; stagger first checks so a restart doesn't burst the provider.
      const cs = listCreators().filter((c) => c.monitoring === 'active');
      cs.forEach((c, i) => updateLive(c.id, { ...c.live, nextCheckAt: new Date(now() + i * Math.max(minGapMs, 500)).toISOString() }));
      offKick = bus.onKick((id) => { const c = getCreator(id); if (c && c.monitoring === 'active') { updateLive(id, { ...c.live, nextCheckAt: new Date(now()).toISOString() }); setTimeout(() => void tick(), 0); } });
      timer = setInterval(() => void tick(), tickMs); timer.unref?.();
      setTimeout(() => void tick(), 0);
    },
    async stop() {
      st.running = false; if (timer) clearInterval(timer); timer = null; offKick?.(); offKick = null;
      for (let i = 0; i < 100 && inflight.size; i++) await new Promise((r) => setTimeout(r, 50));
      flushStore();
    },
    tick,
    status(): MonitorStatus {
      const { provider, problem } = o.getProvider(); const i = provider.info;
      return { running: st.running, startedAt: st.startedAt ? new Date(st.startedAt).toISOString() : undefined, lastTickAt: st.lastTickAt ? new Date(st.lastTickAt).toISOString() : undefined,
        inFlight: inflight.size, checksTotal: st.checksTotal, failuresTotal: st.failuresTotal, cooldownUntil: st.cooldownUntil > now() ? new Date(st.cooldownUntil).toISOString() : undefined, lastError: st.lastError,
        provider: problem ? null : { id: i.id, name: i.name, dataSource: i.dataSource, commercialUse: i.commercialUse, platformTermsRisk: i.platformTermsRisk }, problem, intervalMs: cfgFor(provider).intervalMs };
    },
    isChecking: (id: string) => inflight.has(id),
  };
}
export type Monitor = ReturnType<typeof createMonitor>;

/** Process-wide singleton (guards against duplicate loops when Next re-evaluates modules in dev). */
const g = globalThis as unknown as { __radarMonitor?: Monitor };
export function startMonitor(): Monitor {
  if (!g.__radarMonitor) { g.__radarMonitor = createMonitor({ getProvider: () => resolveProvider(process.env), concurrency: Number(process.env.RADAR_CONCURRENCY) || 2 }); g.__radarMonitor.start(); console.log('[radar] monitor started'); }
  return g.__radarMonitor;
}
export const getMonitor = (): Monitor | undefined => g.__radarMonitor;
