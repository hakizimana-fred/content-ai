/**
 * Scores a detection experiment against ground truth.
 *
 * Ground truth is what a consenting test creator reports (they note when they actually start and stop). Polls are
 * what a provider told us. Nothing here is simulated: it only reads what was logged.
 */
export interface TruthSession { start: number; end: number | null }
export interface PollRecord { at: number; ok: boolean; state?: 'live' | 'offline'; durationMs: number; streamAvailable?: boolean; error?: string }

export interface Stats { n: number; median: number; p95: number; max: number }

export interface EvalReport {
  polls: { total: number; ok: number; errors: number; uptime: number; errorKinds: Record<string, number>; latency: Stats | null };
  sessions: { total: number; detected: number; missed: number; recall: number | null; startLatencyMs: Stats | null; endLatencyMs: Stats | null; shorterThanPollGap: number };
  falsePositives: { episodes: number; polls: number };
  pollLevel: { tp: number; fp: number; tn: number; fn: number; precision: number | null; recall: number | null; ambiguousSkipped: number };
  stream: { liveDetections: number; withStream: number; availability: number | null };
  warnings: string[];
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
export function stats(xs: number[]): Stats | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, median: pct(s, 50), p95: pct(s, 95), max: s[s.length - 1] };
}
const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function evaluate(truth: TruthSession[], pollsIn: PollRecord[], opts: { graceMs?: number; now?: number } = {}): EvalReport {
  const grace = opts.graceMs ?? 60_000;
  const polls = [...pollsIn].sort((a, b) => a.at - b.at);
  const end = (t: TruthSession) => t.end ?? opts.now ?? (polls.at(-1)?.at ?? t.start);
  const warnings: string[] = [];

  const okPolls = polls.filter((p) => p.ok && p.state);
  const errorKinds: Record<string, number> = {};
  for (const p of polls.filter((x) => !x.ok)) errorKinds[p.error ?? 'unknown'] = (errorKinds[p.error ?? 'unknown'] ?? 0) + 1;

  // Typical gap between polls, to flag sessions too short to be observable at this polling rate.
  const gaps = polls.slice(1).map((p, i) => p.at - polls[i].at);
  const medGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;

  // Session-level. Also records each session's "lag windows": the time between the creator's real start and our first
  // live detection, and between the real end and our first offline reading. Polls inside those windows measure latency
  // (reported separately), so they must not also be counted as false negatives / false positives.
  const startLat: number[] = [], endLat: number[] = [];
  const lag: Array<[number, number]> = [];
  let detected = 0, short = 0;
  for (const t of truth) {
    const e = end(t);
    if (medGap && e - t.start < medGap) short++;
    const firstLive = okPolls.find((p) => p.state === 'live' && p.at >= t.start - grace && p.at <= e);
    if (firstLive) {
      detected++; startLat.push(Math.max(0, firstLive.at - t.start));
      if (firstLive.at > t.start) lag.push([t.start, firstLive.at]);
    }
    if (t.end !== null) {
      const off = okPolls.find((p) => p.state === 'offline' && p.at >= t.end!);
      if (off && firstLive) { endLat.push(off.at - t.end); lag.push([t.end, off.at]); }
    }
  }
  const inLag = (at: number) => lag.some(([a, b]) => at >= a && at < b);

  // Poll-level confusion over the remaining polls.
  let tp = 0, fp = 0, tn = 0, fn = 0, amb = 0;
  const fpPolls = new Set<PollRecord>();
  for (const p of okPolls) {
    if (inLag(p.at)) { amb++; continue; }
    const inside = truth.some((t) => p.at >= t.start && p.at <= end(t));
    if (p.state === 'live') { if (inside) tp++; else { fp++; fpPolls.add(p); } }
    else { if (inside) fn++; else tn++; }
  }
  // False-positive episodes: runs of consecutive false-positive polls.
  let episodes = 0, prevFp = false;
  for (const p of okPolls) { const f = fpPolls.has(p); if (f && !prevFp) episodes++; if (!inLag(p.at)) prevFp = f; }

  const liveTruthDetections = okPolls.filter((p) => p.state === 'live' && truth.some((t) => p.at >= t.start && p.at <= end(t)));
  const withKnown = liveTruthDetections.filter((p) => p.streamAvailable !== undefined);
  const withStream = withKnown.filter((p) => p.streamAvailable).length;

  if (truth.length < 5) warnings.push(`Only ${truth.length} ground-truth session(s). Rates from so few sessions are anecdotes, not measurements.`);
  if (polls.length < 50) warnings.push(`Only ${polls.length} polls; uptime and error rates are not yet meaningful.`);
  if (short) warnings.push(`${short} session(s) were shorter than the polling gap and could not have been observed reliably.`);
  if (truth.some((t) => t.end === null)) warnings.push('A ground-truth session has no end; it is treated as still running.');

  return {
    polls: { total: polls.length, ok: polls.filter((p) => p.ok).length, errors: polls.filter((p) => !p.ok).length, uptime: polls.length ? polls.filter((p) => p.ok).length / polls.length : 0, errorKinds, latency: stats(polls.map((p) => p.durationMs)) },
    sessions: { total: truth.length, detected, missed: truth.length - detected, recall: ratio(detected, truth.length), startLatencyMs: stats(startLat), endLatencyMs: stats(endLat), shorterThanPollGap: short },
    falsePositives: { episodes, polls: fp },
    pollLevel: { tp, fp, tn, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), ambiguousSkipped: amb },
    stream: { liveDetections: withKnown.length, withStream, availability: ratio(withStream, withKnown.length) },
    warnings,
  };
}
