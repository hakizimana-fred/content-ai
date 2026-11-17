/**
 * End-to-end test of the monitoring BACKEND against a controllable local HTTP server that speaks the provider format.
 * The server is a test fixture; the monitor, adapter, state machine, store, event bus and permission gate are the real code.
 * It proves the mechanism. It does NOT prove detection against real TikTok (no real provider is configured yet).
 * Runs in a temp working directory so it never touches real storage/.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-mon-')); process.chdir(tmp);
const imp = (p: string) => import(path.join(here, '../src/lib/radar', p));
const store = await imp('store.ts'); const { createMonitor, onLiveStarted } = await imp('monitor.ts');
const { createHttpJsonProvider } = await imp('providers/http-json.ts'); const { nullProvider } = await imp('providers/null.ts');
const { bus } = await imp('events.ts'); const { authorize, PermissionError } = await imp('gate.ts');

/* ── controllable fake provider (fixture) ── */
type Mode = { kind: 'live'; room?: string; viewers?: number } | { kind: 'offline' } | { kind: 'status'; code: number; retryAfter?: number };
const modes = new Map<string, Mode>(); const hits: Array<{ user: string; at: number }> = [];
const srv = http.createServer((req, res) => {
  const user = decodeURIComponent(new URL(req.url!, 'http://x').searchParams.get('user') ?? ''); hits.push({ user, at: Date.now() });
  const m = modes.get(user) ?? { kind: 'status', code: 404 };
  if (m.kind === 'status') { res.writeHead(m.code, m.retryAfter ? { 'retry-after': String(m.retryAfter) } : {}); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: { isLive: m.kind === 'live', viewers: m.kind === 'live' ? m.viewers ?? 0 : 0, room: m.kind === 'live' ? m.room ?? 'r1' : null } }));
});
await new Promise<void>((r) => srv.listen(0, r)); const port = (srv.address() as { port: number }).port;
const mkProvider = () => createHttpJsonProvider({ url: `http://127.0.0.1:${port}/?user={username}`, livePath: 'data.isLive', viewersPath: 'data.viewers', sessionPath: 'data.room', dataSource: 'third-party-service', minPollIntervalMs: 0 });
const cfg = { intervalMs: 150, confirmDelayMs: 80, offlineConfirmations: 2, lostAfterMs: 60_000, maxBackoffMs: 400, failingNotifyAfter: 3 };
const mkMonitor = (resolution = { provider: mkProvider(), problem: null as string | null }) => createMonitor({ getProvider: () => resolution, getConfig: () => cfg, tickMs: 25, minGapMs: 0, concurrency: 3, rand: () => 0 });
const waitFor = async (cond: () => boolean, label: string, ms = 5000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error(`timeout: ${label}`); await new Promise((r) => setTimeout(r, 20)); } };
const state = (id: string) => store.getCreator(id).live.state as string;
const events: Array<{ type: string; [k: string]: unknown }> = []; bus.subscribe((e: { type: string }) => events.push(e as never));

/* 0. No provider configured ⇒ nothing is checked and nothing is faked. */
{
  const a = store.addCreator({ username: 'noprov' }); assert(a.ok);
  const m = mkMonitor({ provider: nullProvider, problem: 'No LIVE detection provider is configured. Missing: RADAR_HTTP_URL' }); m.start();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hits.length, 0, 'no provider ⇒ zero requests'); assert.equal(state(a.creator.id), 'unknown'); assert.match(m.status().problem!, /Missing: RADAR_HTTP_URL/);
  assert(events.some((e) => e.type === 'provider-status')); await m.stop(); store.removeCreator(a.creator.id);
}

const monitor = mkMonitor(); monitor.start();

/* 1–2. Add a creator ⇒ monitored automatically (no manual activation); real backend check happens. */
modes.set('test_creator', { kind: 'offline' });
const added = store.addCreator({ username: '@Test_Creator', language: 'Luganda' }); assert(added.ok); const id = added.creator.id;
assert.equal(added.creator.monitoring, 'active', 'new creators are monitored by default');
await waitFor(() => hits.some((h) => h.user === 'test_creator'), 'first backend check');
await waitFor(() => state(id) === 'offline', 'status becomes offline from a real answer');

/* 3–6. Creator goes live ⇒ LIVE, session, notification, pushed event, no refresh needed. */
events.length = 0; modes.set('test_creator', { kind: 'live', room: 'roomA', viewers: 42 });
await waitFor(() => state(id) === 'live', 'detect LIVE');
let c = store.getCreator(id); assert.equal(c.live.viewerCount, 42); assert.equal(c.live.provider, 'http-json');
const open = store.getOpenSession(id); assert(open); assert.equal(open.providerSessionId, 'roomA'); assert.equal(open.recordingAuthorized, false);
assert(events.some((e) => e.type === 'creator-updated' && (e.creator as { live: { state: string } }).live.state === 'live'), 'frontend event pushed');
const note = store.listNotifications().find((n: { kind: string }) => n.kind === 'live-detected'); assert(note, 'notification created'); assert.match(note.body, /just started broadcasting/); assert.match(note.body, /no recording permission/);
assert(events.some((e) => e.type === 'notification'), 'notification pushed live');
assert(c.audit.some((a: { action: string }) => a.action === 'LIVE detected'));
// still live ⇒ same session, not a new one, and viewer peak tracked
modes.set('test_creator', { kind: 'live', room: 'roomA', viewers: 90 }); await waitFor(() => store.getOpenSession(id)?.peakViewers === 90, 'peak viewers');
assert.equal(store.listSessions({ creatorId: id }).length, 1);

/* Provider outage while live: ERROR, never offline, session stays open; recovery continues the same session. */
modes.set('test_creator', { kind: 'status', code: 503 });
await waitFor(() => state(id) === 'error', 'outage ⇒ error'); assert(store.getOpenSession(id), 'session survives outage'); assert.notEqual(state(id), 'offline');
assert.equal(store.getCreator(id).live.error.kind, 'unavailable');
await waitFor(() => store.getCreator(id).live.consecutiveErrors >= 3, 'retries with backoff'); assert(store.listNotifications().some((n: { kind: string }) => n.kind === 'provider-error'), 'failing notification after threshold');
modes.set('test_creator', { kind: 'live', room: 'roomA', viewers: 10 }); await waitFor(() => state(id) === 'live', 'recovery'); assert.equal(store.listSessions({ creatorId: id }).length, 1, 'same session after recovery');
assert(store.listNotifications().some((n: { kind: string }) => n.kind === 'provider-recovered'));

/* 7–10. Creator ends ⇒ eventually OFFLINE after confirmation; session saved with confirmed end. */
modes.set('test_creator', { kind: 'offline' });
await waitFor(() => state(id) === 'offline', 'detect OFFLINE'); await waitFor(() => !store.getOpenSession(id), 'session closed');
const [ses] = store.listSessions({ creatorId: id }); assert(ses.endedAt); assert.equal(ses.endConfirmed, true); assert.equal(ses.endReason, 'offline-confirmed'); assert.equal(ses.peakViewers, 90); assert(Date.parse(ses.endedAt) >= Date.parse(ses.firstDetectedAt));
assert(store.listNotifications().some((n: { kind: string }) => n.kind === 'live-ended')); assert.equal(store.getCreator(id).live.sessionId, undefined);

/* Invalid username (provider 404) ⇒ ERROR not-found, long back-off, never offline. */
const bad = store.addCreator({ username: 'doesnt_exist_zz' }); assert(bad.ok);
await waitFor(() => state(bad.creator.id) === 'error', 'invalid username'); assert.equal(store.getCreator(bad.creator.id).live.error.kind, 'not-found');
{ const n = hits.filter((h) => h.user === 'doesnt_exist_zz').length; await new Promise((r) => setTimeout(r, 500)); assert.equal(hits.filter((h) => h.user === 'doesnt_exist_zz').length, n, 'invalid username is not hammered'); }

/* Rate limit ⇒ global cooldown: no requests at all while Retry-After applies. */
modes.set('test_creator', { kind: 'status', code: 429, retryAfter: 1 });
await waitFor(() => store.getCreator(id).live.error?.kind === 'rate-limit', 'rate-limited'); await new Promise((r) => setTimeout(r, 100));
const before = hits.length; await new Promise((r) => setTimeout(r, 600)); assert.equal(hits.length, before, 'no requests during cooldown'); assert(monitor.status().cooldownUntil, 'cooldown reported in status');
modes.set('test_creator', { kind: 'offline' }); await waitFor(() => state(id) === 'offline', 'resumes after cooldown', 8000);

/* Pause / resume persists and is honoured. */
store.updateCreator(id, { monitoring: 'paused' }); await new Promise((r) => setTimeout(r, 100)); const paused = hits.filter((h) => h.user === 'test_creator').length; await new Promise((r) => setTimeout(r, 500));
assert.equal(hits.filter((h) => h.user === 'test_creator').length, paused, 'paused creators are not checked');
store.updateCreator(id, { monitoring: 'active' }); await waitFor(() => hits.filter((h) => h.user === 'test_creator').length > paused, 'resume ⇒ immediate check');

/* Recording stays a separate, permission-gated capability. Hook sees the session; recorder must authorize() itself. */
const seen: string[] = []; let recorderBlocked = 0, recorderAllowed = 0;
onLiveStarted(async (s: { id: string; creatorId: string }) => { seen.push(s.id); try { authorize(s.creatorId, 'recording', { purpose: 'auto-record' }); recorderAllowed++; } catch (e) { if (e instanceof PermissionError) recorderBlocked++; } });
modes.set('test_creator', { kind: 'live', room: 'roomB' }); await waitFor(() => state(id) === 'live', 'second broadcast'); await waitFor(() => seen.length === 1, 'hook called');
assert.equal(recorderBlocked, 1); assert.equal(recorderAllowed, 0, 'no permission ⇒ recorder blocked'); assert.equal(store.getOpenSession(id).recordingAuthorized, false);
modes.set('test_creator', { kind: 'offline' }); await waitFor(() => !store.getOpenSession(id), 'second broadcast ends');
store.grantPermission(id, { grantedBy: 'Test creator', evidence: 'test fixture', scope: { recording: true, editing: false, redistribution: false, monetization: false }, platforms: ['tiktok'] });
modes.set('test_creator', { kind: 'live', room: 'roomC' }); await waitFor(() => seen.length === 2, 'third broadcast');
assert.equal(recorderAllowed, 1, 'with permission the recorder may proceed'); assert.equal(store.getOpenSession(id).recordingAuthorized, true);
assert.equal(store.listSessions({ creatorId: id }).length, 3, 'history keeps every broadcast');

/* Application restart: stop everything, drop in-memory state, reload from disk, resume, finish the open session. */
await monitor.stop(); store._resetStoreCacheForTests();
const reloaded = store.getCreator(id); assert.equal(reloaded.live.state, 'live', 'LIVE state persisted'); assert(store.getOpenSession(id), 'open session persisted');
assert.equal(store.listSessions({ creatorId: id }).length, 3, 'history persisted'); assert.equal(store.getCreator(id).monitoring, 'active', 'monitoring flag persisted');
modes.set('test_creator', { kind: 'offline' }); const hitsBefore = hits.length;
const monitor2 = mkMonitor(); monitor2.start();
await waitFor(() => hits.length > hitsBefore, 'monitoring resumes by itself after restart'); await waitFor(() => !store.getOpenSession(id), 'restart recovery closes the finished session', 8000);
assert.equal(state(id), 'offline'); assert.equal(store.listSessions({ creatorId: id })[0].endConfirmed, true);
await monitor2.stop(); srv.close(); store.flushStore();
console.log('radar monitor end-to-end tests passed');
