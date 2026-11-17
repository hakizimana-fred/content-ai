/**
 * Detection experiment runner for ONE explicitly consenting test creator.
 *
 *   node scripts/radar-prototype.ts poll   --creator <username> --name <run> [--interval 30] [--minutes 120]
 *   node scripts/radar-prototype.ts truth  --name <run> start|end          (the creator/operator says when they ACTUALLY went live / stopped)
 *   node scripts/radar-prototype.ts report --name <run>
 *
 * It only DETECTS. It never records, downloads or publishes anything. It refuses to start unless:
 *   1. the creator exists in storage/radar.json with an active (non-expired, non-revoked) permission, and
 *   2. a provider is explicitly configured through RADAR_HTTP_* (see src/lib/radar/providers/http-json.ts).
 * Log: storage/radar-experiments/<run>.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { permissionStatus } from '../src/lib/radar/permissions.ts';
import { evaluate, type PollRecord, type TruthSession } from '../src/lib/radar/evaluation.ts';
import { configFromEnv, createHttpJsonProvider } from '../src/lib/radar/providers/http-json.ts';
import { hasStreamAccess, ProviderError } from '../src/lib/radar/providers/types.ts';
import type { Creator } from '../src/types/radar.ts';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const name = flag('name');
const dir = path.resolve('storage/radar-experiments');
const die = (m: string): never => { console.error(m); process.exit(1); };
if (!cmd || !['poll', 'truth', 'report'].includes(cmd)) die('Usage: poll | truth start|end | report   (see header of this file)');
if (!name || !/^[\w-]+$/.test(name)) die('--name <run> is required (letters, numbers, - and _).');
const file = path.join(dir, `${name}.jsonl`);
const append = (o: object) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(file, JSON.stringify(o) + '\n'); };
const readLog = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

if (cmd === 'truth') {
  const kind = rest.find((r) => r === 'start' || r === 'end') ?? die('Say `start` or `end`.');
  append({ type: 'truth', kind, at: Date.now() });
  console.log(`Recorded ground truth: ${kind} at ${new Date().toISOString()}`);
}

if (cmd === 'report') {
  const log = readLog(); if (!log.length) die(`No log at ${file}`);
  const truth: TruthSession[] = []; let open: TruthSession | null = null;
  for (const e of log.filter((l) => l.type === 'truth')) { if (e.kind === 'start') { open = { start: e.at, end: null }; truth.push(open); } else if (open) { open.end = e.at; open = null; } }
  const polls: PollRecord[] = log.filter((l) => l.type === 'poll');
  const meta = log.find((l) => l.type === 'meta');
  console.log(JSON.stringify({ run: name, provider: meta?.provider ?? 'unknown', report: evaluate(truth, polls) }, null, 2));
}

if (cmd === 'poll') {
  const username = (flag('creator') ?? die('--creator <username> is required.')).replace(/^@/, '').toLowerCase();
  const radar = (() => { try { return JSON.parse(fs.readFileSync('storage/radar.json', 'utf-8')); } catch { return null; } })();
  const creator: Creator | undefined = radar && Object.values<Creator>(radar.creators ?? {}).find((c) => c.username === username);
  if (!creator) die(`@${username} is not in Live Radar. Add them and record their permission first.`);
  const st = permissionStatus(creator!.permission);
  if (st !== 'active' && st !== 'expiring') die(`@${username} has no active permission on file (status: ${st}). Not running.`);

  const cfg = configFromEnv();
  if (!cfg) die('No provider configured. Set RADAR_HTTP_URL, RADAR_HTTP_LIVE_PATH and RADAR_HTTP_SOURCE (see providers/http-json.ts). Nothing was called.');
  const provider = createHttpJsonProvider(cfg!);
  const interval = Math.max(Number(flag('interval') ?? 30) * 1000, provider.info.minPollIntervalMs);
  const stopAt = Date.now() + Number(flag('minutes') ?? 120) * 60_000;
  append({ type: 'meta', at: Date.now(), creator: username, provider: provider.info, intervalMs: interval });
  console.log(`Polling @${username} every ${interval / 1000}s via "${provider.info.name}" (${provider.info.dataSource}). Ctrl+C to stop. Detection only: nothing is recorded.`);

  let stop = false; process.on('SIGINT', () => { stop = true; });
  while (!stop && Date.now() < stopAt) {
    const t0 = Date.now();
    const rec: PollRecord = { at: t0, ok: false, durationMs: 0 };
    try {
      const r = await provider.check(username);
      rec.ok = true; rec.state = r.state === 'live' ? 'live' : 'offline';
      // Stream availability is measured as "does the provider hand back a URL" only. We do not open or record it.
      if (r.state === 'live' && hasStreamAccess(provider)) rec.streamAvailable = !!(await provider.getStream(username).catch(() => null));
    } catch (e) { rec.error = e instanceof ProviderError ? e.kind : 'other'; if (e instanceof ProviderError && e.kind === 'rate-limit') await new Promise((r) => setTimeout(r, e.retryAfterMs ?? 60_000)); }
    rec.durationMs = Date.now() - t0;
    append({ type: 'poll', ...rec });
    process.stdout.write(`${new Date().toISOString()} ${rec.ok ? rec.state : `error:${rec.error}`}\n`);
    await new Promise((r) => setTimeout(r, Math.max(0, interval - rec.durationMs)));
  }
  console.log('Stopped. Run: report --name', name);
}
