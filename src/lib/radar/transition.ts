import type { LiveInfo, LiveSession } from '../../types/radar.ts';

/**
 * Pure LIVE-state machine. No I/O, no clock, no randomness: everything arrives as arguments, so it can be tested
 * exhaustively. Its one rule: state changes ONLY in response to what a provider actually answered.
 *   ok+live    → live (open or continue a session)
 *   ok+offline → offline, but only after `offlineConfirmations` consecutive readings (one blip must not end a session)
 *   failure    → error. NEVER offline. An open session stays open until contact has been lost for `lostAfterMs`.
 */
export type Outcome =
  | { ok: true; state: 'live' | 'offline'; viewerCount?: number; providerSessionId?: string; startedAt?: number }
  | { ok: false; kind: string; message: string; retryAfterMs?: number };

export interface TransitionConfig {
  intervalMs: number;            // normal gap between checks of one creator
  confirmDelayMs: number;        // gap while confirming a possible end
  offlineConfirmations: number;  // consecutive offline readings required to close a session
  lostAfterMs: number;           // failures for this long on a live session → close it as "lost contact"
  maxBackoffMs: number;
  failingNotifyAfter: number;    // consecutive failures before a "provider failing" event
}

export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  intervalMs: 60_000, confirmDelayMs: 30_000, offlineConfirmations: 2, lostAfterMs: 30 * 60_000, maxBackoffMs: 10 * 60_000, failingNotifyAfter: 5,
};

export interface Ctx {
  creatorId: string; username: string; provider: string;
  recordingAuthorized: boolean; recordingNote?: string;
  newId: () => string;
}

export type TransitionEvent =
  | { type: 'live-started'; session: LiveSession }
  | { type: 'live-ended'; session: LiveSession }
  | { type: 'error-started'; kind: string; message: string }
  | { type: 'provider-failing'; kind: string; message: string; count: number }
  | { type: 'recovered' };

export interface Transition {
  live: LiveInfo;
  /** The session still open after this check (persist it), or null. */
  open: LiveSession | null;
  /** Sessions this check closed (persist each). Usually 0 or 1; 2 never happens, but a list keeps callers honest. */
  closed: LiveSession[];
  events: TransitionEvent[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const finish = (live: LiveInfo, session: LiveSession | null, events: TransitionEvent[], extraClosed: LiveSession[] = []): Transition => {
  const closed = [...extraClosed, ...(session?.endedAt ? [session] : [])];
  return { live, open: session && !session.endedAt ? session : null, closed, events };
};

export function failureDelay(kind: string, retryAfterMs: number | undefined, consecutive: number, cfg: TransitionConfig): number {
  switch (kind) {
    case 'not-found': return 6 * 3_600_000;                                        // invalid username: don't hammer
    case 'auth': return Math.min(cfg.maxBackoffMs, 15 * 60_000);                    // bad key: retrying fast won't fix it
    case 'rate-limit': return Math.max(retryAfterMs ?? 0, cfg.intervalMs * 2);
    default: return Math.min(cfg.maxBackoffMs, cfg.intervalMs * 2 ** Math.max(0, consecutive - 1)); // network / unavailable / schema
  }
}

export function applyOutcome(prev: LiveInfo, open: LiveSession | null, outcome: Outcome, now: number, cfg: TransitionConfig, ctx: Ctx): Transition {
  const events: TransitionEvent[] = [];
  let session = open ? { ...open } : null;
  const base: LiveInfo = { ...prev, checkedAt: iso(now), provider: ctx.provider };

  /* ── failure: never offline ── */
  if (!outcome.ok) {
    const n = (prev.consecutiveErrors ?? 0) + 1;
    const live: LiveInfo = {
      ...base, state: 'error', since: prev.state === 'error' ? prev.since : iso(now),
      error: { kind: outcome.kind, message: outcome.message, at: iso(now) }, consecutiveErrors: n,
      nextCheckAt: iso(now + failureDelay(outcome.kind, outcome.retryAfterMs, n, cfg)),
    };
    if (prev.state !== 'error') events.push({ type: 'error-started', kind: outcome.kind, message: outcome.message });
    if (n === cfg.failingNotifyAfter) events.push({ type: 'provider-failing', kind: outcome.kind, message: outcome.message, count: n });
    // Contact lost for too long while we believed it was live: close it, honestly marked as unconfirmed.
    if (session && prev.lastSuccessAt && now - Date.parse(prev.lastSuccessAt) >= cfg.lostAfterMs) {
      session = { ...session, endedAt: prev.lastSuccessAt, endConfirmed: false, endReason: 'lost-contact' };
      events.push({ type: 'live-ended', session });
      live.sessionId = undefined; live.viewerCount = undefined;
    }
    return finish(live, session, events);
  }

  const recovered = prev.state === 'error';
  if (recovered) events.push({ type: 'recovered' });
  const common: Partial<LiveInfo> = { lastSuccessAt: iso(now), error: undefined, consecutiveErrors: 0 };

  /* ── provider says LIVE ── */
  if (outcome.state === 'live') {
    // A different provider session id means a new broadcast: close the old one rather than merging two lives.
    if (session && outcome.providerSessionId && session.providerSessionId && outcome.providerSessionId !== session.providerSessionId) {
      session = { ...session, endedAt: iso(now), endConfirmed: true, endReason: 'session-changed' };
      events.push({ type: 'live-ended', session });
      const closedOld = session; session = null;
      const r = applyOutcome({ ...prev, state: 'unknown', sessionId: undefined, error: undefined }, null, outcome, now, cfg, ctx);
      return finish(r.live, r.open, [...events, ...r.events], [closedOld]);
    }
    if (!session) {
      session = {
        id: ctx.newId(), creatorId: ctx.creatorId, username: ctx.username, provider: ctx.provider, providerSessionId: outcome.providerSessionId,
        firstDetectedAt: iso(now), lastDetectedAt: iso(now), startedAt: outcome.startedAt ? iso(outcome.startedAt) : undefined,
        endConfirmed: false, detectionResult: 'live', peakViewers: outcome.viewerCount, lastViewerCount: outcome.viewerCount, checks: 1,
        recordingAuthorized: ctx.recordingAuthorized, recordingNote: ctx.recordingNote,
      };
      events.push({ type: 'live-started', session });
    } else {
      session = {
        ...session, lastDetectedAt: iso(now), checks: session.checks + 1, lastViewerCount: outcome.viewerCount ?? session.lastViewerCount,
        peakViewers: Math.max(session.peakViewers ?? 0, outcome.viewerCount ?? 0) || undefined,
        startedAt: session.startedAt ?? (outcome.startedAt ? iso(outcome.startedAt) : undefined), providerSessionId: session.providerSessionId ?? outcome.providerSessionId,
      };
    }
    return finish({ ...base, ...common, state: 'live', since: prev.state === 'live' ? prev.since : iso(now), sessionId: session.id, viewerCount: outcome.viewerCount, consecutiveOffline: 0, firstOfflineAt: undefined, nextCheckAt: iso(now + cfg.intervalMs) }, session, events);
  }

  /* ── provider says OFFLINE ── */
  if (session) {
    const k = (prev.consecutiveOffline ?? 0) + 1;
    const firstOff = prev.firstOfflineAt ?? iso(now);
    if (k < cfg.offlineConfirmations) {
      // Possible end: keep the session open, recheck sooner.
      return finish({ ...base, ...common, state: 'live', sessionId: session.id, consecutiveOffline: k, firstOfflineAt: firstOff, nextCheckAt: iso(now + cfg.confirmDelayMs) }, session, events);
    }
    session = { ...session, endedAt: firstOff, endConfirmed: true, endReason: 'offline-confirmed' };
    events.push({ type: 'live-ended', session });
  }
  return finish({ ...base, ...common, state: 'offline', since: prev.state === 'offline' ? prev.since : iso(now), sessionId: undefined, viewerCount: undefined, consecutiveOffline: 0, firstOfflineAt: undefined, nextCheckAt: iso(now + cfg.intervalMs) }, session, events);
}
