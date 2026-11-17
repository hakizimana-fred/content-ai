// Synthetic data, used ONLY to test the scoring maths. It is never shown in the app or reported as a measurement.
import assert from 'node:assert/strict';
import { evaluate, stats, type PollRecord } from '../src/lib/radar/evaluation.ts';
import { createHttpJsonProvider, configFromEnv } from '../src/lib/radar/providers/http-json.ts';
import { nullProvider } from '../src/lib/radar/providers/null.ts';
import { ProviderError, hasStreamAccess } from '../src/lib/radar/providers/types.ts';

const M = 60_000, T0 = 1_000_000_000_000;
const poll = (min: number, state: 'live' | 'offline' | null, extra: Partial<PollRecord> = {}): PollRecord =>
  state ? { at: T0 + min * M, ok: true, state, durationMs: 200, ...extra } : { at: T0 + min * M, ok: false, durationMs: 1000, error: 'network', ...extra };

// Truth: live 10→40 min. Polls every 2 min from 0 to 60.
const truth = [{ start: T0 + 10 * M, end: T0 + 40 * M }];
const perfectish: PollRecord[] = [];
for (let m = 0; m <= 60; m += 2) perfectish.push(poll(m, m >= 12 && m <= 42 ? 'live' : 'offline', { streamAvailable: m >= 12 && m <= 42 ? true : undefined }));
let r = evaluate(truth, perfectish);
assert.equal(r.sessions.detected, 1); assert.equal(r.sessions.startLatencyMs!.median, 2 * M);   // first live poll at min 12
assert.equal(r.sessions.endLatencyMs!.median, 4 * M);   // creator stops at min 40; provider still live at 42, first offline poll at 44
assert.equal(r.falsePositives.polls, 0); assert.equal(r.pollLevel.precision, 1); assert.equal(r.pollLevel.recall, 1);
assert.equal(r.polls.uptime, 1); assert.equal(r.stream.availability, 1);

// Missed session (provider never says live) = false negatives.
const missed = perfectish.map((p) => ({ ...p, state: 'offline' as const }));
r = evaluate(truth, missed);
assert.equal(r.sessions.missed, 1); assert.equal(r.sessions.recall, 0); assert(r.pollLevel.fn > 0); assert.equal(r.sessions.startLatencyMs, null);

// False positive: provider says live for 6 minutes while the creator was not live (min 50-56), as one episode.
const fpRun = perfectish.map((p) => (p.at >= T0 + 50 * M && p.at <= T0 + 56 * M ? { ...p, state: 'live' as const } : p));
r = evaluate(truth, fpRun);
assert.equal(r.falsePositives.episodes, 1); assert.equal(r.falsePositives.polls, 4); assert(r.pollLevel.precision! < 1);

// Errors are not offline: they hurt uptime but not recall/precision.
const flaky = perfectish.map((p, i) => (i % 5 === 0 ? poll((p.at - T0) / M, null) : p));
r = evaluate(truth, flaky);
assert(r.polls.uptime < 1 && r.polls.errors === 7); assert.equal(r.polls.errorKinds.network, 7); assert.equal(r.falsePositives.polls, 0);

// Short sessions are flagged rather than silently counted as provider failures.
r = evaluate([{ start: T0 + 5 * M, end: T0 + 6 * M }], perfectish);
assert.equal(r.sessions.shorterThanPollGap, 1); assert(r.warnings.some((w) => /shorter than the polling gap/.test(w)));
assert(evaluate(truth, perfectish).warnings.some((w) => /ground-truth session/.test(w)), 'tiny samples must be warned about');
assert.deepEqual(stats([5, 1, 3]), { n: 3, median: 3, p95: 5, max: 5 }); assert.equal(stats([]), null);

// Provider contract: schema drift is an error, never "offline".
const mk = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const cfg = { url: 'https://x.test/{username}', livePath: 'data.isLive', streamPath: 'data.hls', dataSource: 'third-party-service' as const };
const ok = await createHttpJsonProvider(cfg, mk({ data: { isLive: true, hls: 'https://s/a.m3u8' } })).check('u');
assert.equal(ok.state, 'live');
assert.equal((await createHttpJsonProvider(cfg, mk({ data: { isLive: false } })).check('u')).state, 'offline');
for (const [body, status, kind] of [[{ data: {} }, 200, 'schema'], [{}, 401, 'auth'], [{}, 429, 'rate-limit'], [{}, 503, 'unavailable']] as const) {
  await assert.rejects(createHttpJsonProvider(cfg, mk(body, status)).check('u'), (e: unknown) => e instanceof ProviderError && e.kind === kind, `${status}/${kind}`);
}
const p = createHttpJsonProvider(cfg, mk({ data: { isLive: true, hls: 'https://s/a.m3u8' } }));
assert(hasStreamAccess(p)); assert.equal((await p.getStream('u'))?.kind, 'hls');
assert.equal(p.info.platformTermsRisk, 'unverified'); assert.equal(p.info.commercialUse, 'unverified');
assert.equal(createHttpJsonProvider({ ...cfg, dataSource: 'unofficial-protocol' }, mk({})).info.platformTermsRisk, 'at-risk');
assert.equal(createHttpJsonProvider({ ...cfg, streamPath: undefined }, mk({})).info.capabilities.streamAccess, false); // detection ≠ stream access
await assert.rejects(nullProvider.check('u'), (e: unknown) => e instanceof ProviderError && e.kind === 'not-configured');
assert.equal(configFromEnv({}), null); assert.equal(configFromEnv({ RADAR_HTTP_URL: 'x', RADAR_HTTP_LIVE_PATH: 'a' }), null); // must declare a source
console.log('radar evaluation + provider contract tests passed');
