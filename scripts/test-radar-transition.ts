import assert from 'node:assert/strict';
import { applyOutcome, failureDelay, DEFAULT_TRANSITION_CONFIG as D, type Outcome } from '../src/lib/radar/transition.ts';
import type { LiveInfo, LiveSession } from '../src/types/radar.ts';

const cfg = { ...D, intervalMs: 60_000, confirmDelayMs: 30_000, offlineConfirmations: 2, lostAfterMs: 10 * 60_000, failingNotifyAfter: 3 };
let n = 0; const ctx = { creatorId: 'c1', username: 'u', provider: 'p', recordingAuthorized: false, newId: () => `ls${++n}` };
const T = 1_700_000_000_000, M = 60_000;
const live = (extra: Partial<Extract<Outcome, { ok: true }>> = {}): Outcome => ({ ok: true, state: 'live', ...extra });
const off: Outcome = { ok: true, state: 'offline' };
const fail = (kind = 'network', retryAfterMs?: number): Outcome => ({ ok: false, kind, message: `${kind} failure`, retryAfterMs });
// Drive the machine through a script of [minute, outcome]; returns final state and every event.
function run(script: Array<[number, Outcome]>, start: { live?: LiveInfo; open?: LiveSession | null } = {}) {
  let l: LiveInfo = start.live ?? { state: 'unknown' }, s: LiveSession | null = start.open ?? null; const ev: string[] = []; const log: LiveInfo[] = [];
  for (const [m, o] of script) { const r = applyOutcome(l, s, o, T + m * M, cfg, ctx); l = r.live; s = r.open; closed.push(...r.closed); for (const e of r.events) ev.push(e.type); log.push(l); }
  return { l, s, ev, log };
}
const closed: LiveSession[] = [];

// 1. First real LIVE answer opens a session and fires exactly one live-started.
let r = run([[0, live({ viewerCount: 10, providerSessionId: 'room1', startedAt: T - 5 * M })]]);
assert.equal(r.l.state, 'live'); assert.deepEqual(r.ev, ['live-started']); assert.equal(r.s!.providerSessionId, 'room1'); assert.equal(r.s!.startedAt, new Date(T - 5 * M).toISOString());
// 2. Continued LIVE: no new event, peak viewers tracked, one session only.
r = run([[0, live({ viewerCount: 10 })], [1, live({ viewerCount: 50 })], [2, live({ viewerCount: 30 })]]);
assert.deepEqual(r.ev, ['live-started']); assert.equal(r.s!.peakViewers, 50); assert.equal(r.s!.lastViewerCount, 30); assert.equal(r.s!.checks, 3);
// 3. A single offline blip does NOT end a session (state stays live, recheck sooner).
r = run([[0, live()], [1, off]]);
assert.equal(r.l.state, 'live'); assert.equal(r.l.consecutiveOffline, 1); assert.deepEqual(r.ev, ['live-started']);
assert.equal(Date.parse(r.l.nextCheckAt!) - (T + 1 * M), cfg.confirmDelayMs);
// 4. …and a blip followed by LIVE resets the counter (flapping provider ≠ two sessions).
r = run([[0, live()], [1, off], [2, live()]]);
assert.equal(r.l.state, 'live'); assert.equal(r.l.consecutiveOffline, 0); assert.deepEqual(r.ev, ['live-started']);
// 5. Two consecutive offline readings close the session; end time = FIRST offline reading; confirmed.
closed.length = 0;
r = run([[0, live()], [5, off], [6, off]]);
assert.equal(r.l.state, 'offline'); assert.deepEqual(r.ev, ['live-started', 'live-ended']);
assert.equal(closed[0].endedAt, new Date(T + 5 * M).toISOString()); assert.equal(closed[0].endConfirmed, true); assert.equal(closed[0].endReason, 'offline-confirmed');
// 6. Offline with no session just stays offline, no events.
r = run([[0, off], [1, off]]); assert.equal(r.l.state, 'offline'); assert.deepEqual(r.ev, []);
// 7. CRITICAL: failures are never OFFLINE. Unknown stays error; offline→error; live→error keeps the session open.
r = run([[0, fail()]]); assert.equal(r.l.state, 'error'); assert.deepEqual(r.ev, ['error-started']);
r = run([[0, off], [1, fail('unavailable')]]); assert.equal(r.l.state, 'error'); assert.notEqual(r.l.state, 'offline');
r = run([[0, live()], [1, fail()], [2, fail()]]); assert.equal(r.l.state, 'error'); assert(r.s, 'open session must survive provider failures'); assert.equal(r.ev.filter((e) => e === 'live-ended').length, 0);
// 8. Recovery: still live → the SAME session continues (no second live-started); events show recovered.
r = run([[0, live()], [1, fail()], [2, live()]]); assert.equal(r.l.state, 'live'); assert.deepEqual(r.ev, ['live-started', 'error-started', 'recovered']); assert.equal(r.s!.checks, 2);
// 9. Recovery after the creator really stopped during the outage: needs two offline readings, like any end.
closed.length = 0; r = run([[0, live()], [1, fail()], [2, off], [3, off]]); assert.equal(r.l.state, 'offline'); assert.equal(closed.length, 1);
// 10. Lost contact: failing ≥ lostAfterMs on a live session closes it as UNCONFIRMED, ending at the last good reading.
closed.length = 0; r = run([[0, live()], [1, live()], [3, fail()], [12, fail()]]);
assert.equal(closed.length, 1); assert.equal(closed[0].endConfirmed, false); assert.equal(closed[0].endReason, 'lost-contact'); assert.equal(closed[0].endedAt, new Date(T + 1 * M).toISOString()); assert.equal(r.l.state, 'error');
// 11. Spam control: error-started once, provider-failing exactly at the threshold, not every retry.
r = run([[0, fail()], [1, fail()], [2, fail()], [3, fail()], [4, fail()]]); assert.deepEqual(r.ev, ['error-started', 'provider-failing']);
// 12. Backoff: grows with consecutive failures, capped; rate-limit honours Retry-After; invalid username backs off for hours; auth doesn't spin.
assert.equal(failureDelay('network', undefined, 1, cfg), 60_000); assert.equal(failureDelay('network', undefined, 3, cfg), 240_000); assert.equal(failureDelay('network', undefined, 20, cfg), cfg.maxBackoffMs);
assert.equal(failureDelay('rate-limit', 300_000, 1, cfg), 300_000); assert.equal(failureDelay('rate-limit', undefined, 1, cfg), 120_000);
assert(failureDelay('not-found', undefined, 1, cfg) >= 3_600_000); assert(failureDelay('auth', undefined, 1, cfg) >= 60_000);
// 13. Different provider session id while live = a NEW broadcast: old one closed (session-changed), new one opened.
closed.length = 0; r = run([[0, live({ providerSessionId: 'A' })], [5, live({ providerSessionId: 'B' })]]);
assert.deepEqual(r.ev, ['live-started', 'live-ended', 'live-started']); assert.equal(closed[0].endReason, 'session-changed'); assert.equal(r.s!.providerSessionId, 'B');
// 14. Recording authorization is only a snapshot on the session; the machine never starts anything.
const auth = applyOutcome({ state: 'unknown' }, null, live(), T, cfg, { ...ctx, recordingAuthorized: true, recordingNote: 'ok' }); assert.equal(auth.open!.recordingAuthorized, true);
// 15. Restart recovery input: persisted live state + open session + first check offline ⇒ confirmed end path still works.
const persisted = run([[0, live()]]); closed.length = 0;
const resumed = run([[10, off], [11, off]], { live: persisted.l, open: persisted.s }); assert.equal(resumed.l.state, 'offline'); assert.equal(closed.length, 1);
console.log('radar transition tests passed');
