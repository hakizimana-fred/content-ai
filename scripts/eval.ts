/**
 * Moment-detection benchmark.
 *   node scripts/eval.ts experiments/manifest.json [--k 5] [--iou 0.3]
 *   node scripts/eval.ts --selftest
 *
 * Compares uniform / random / acoustic / hybrid(acoustic+text) selection against
 * human-labelled good moments. See experiments/README.md for the manifest format.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeAudioSignal } from '../src/lib/intelligence/signal-analyzer.ts';
import { runExperiment, type EvalVideo } from '../src/lib/intelligence/evaluation.ts';
import type { LoudnessSample, SilenceInterval, TranscriptSegmentLike } from '../src/lib/intelligence/types.ts';

const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const k = Number(flag('k', '5'));
const iouT = Number(flag('iou', '0.3'));

function probeDuration(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat(r.stdout);
}

/** Synthetic podcast: flat chatter with 3 planted "moments" (laughter/loud burst preceded by a question). */
function syntheticVideo(seed: number): EvalVideo {
  const duration = 600;
  const loudness: LoudnessSample[] = [];
  const silences: SilenceInterval[] = [];
  const segments: TranscriptSegmentLike[] = [];
  const labels = [{ start: 90 + seed * 7, end: 130 + seed * 7 }, { start: 300, end: 342 }, { start: 470 - seed * 5, end: 510 - seed * 5 }];
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let t = 0; t < duration; t += 0.25) {
    const inMoment = labels.some((l) => t >= l.start && t <= l.end);
    loudness.push({ timestamp: t, momentaryLufs: -26 + rnd() * 3 + (inMoment ? 4 + rnd() * 6 : 0) });
  }
  for (let t = 8; t < duration; t += 8 + rnd() * 10) silences.push({ start: t, end: t + 0.4, duration: 0.4 });
  for (let t = 0; t < duration; t += 6) {
    const lab = labels.find((l) => t >= l.start - 1 && t < l.start + 6);
    segments.push({ start: t, end: t + 5.8, avg_logprob: -0.3,
      text: lab ? 'Why did nobody ever tell you the truth about this? Because it cost us a million.' : 'So we went to the shop and then we talked about the weather today' });
  }
  return { id: `synthetic_${seed}`, duration, silences, loudness, transcript: segments, labels };
}

async function main() {
  let videos: EvalVideo[];
  if (args.includes('--selftest')) {
    videos = [1, 2, 3, 4, 5].map(syntheticVideo);
    console.log('SELFTEST on synthetic data (validates the harness, NOT real-world performance)\n');
  } else {
    const manifestPath = args.find((a) => !a.startsWith('--') && a !== String(k) && a !== String(iouT));
    if (!manifestPath) { console.error('usage: node scripts/eval.ts <manifest.json> | --selftest'); process.exit(1); }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      videos: { id: string; path: string; transcript?: string; labels: { start: number; end: number }[] }[] };
    const base = path.dirname(path.resolve(manifestPath));
    videos = [];
    for (const v of manifest.videos) {
      const file = path.resolve(base, v.path);
      const duration = probeDuration(file);
      process.stderr.write(`analysing ${v.id} (${duration.toFixed(0)}s)...\n`);
      const sig = await analyzeAudioSignal(file, duration);
      const tfile = v.transcript ? path.resolve(base, v.transcript) : null;
      const transcript = tfile && fs.existsSync(tfile) ? (JSON.parse(fs.readFileSync(tfile, 'utf8')).segments as TranscriptSegmentLike[]) : undefined;
      videos.push({ id: v.id, duration, silences: sig.silenceIntervals, loudness: sig.loudnessSamples, transcript, labels: v.labels });
    }
  }

  const results = runExperiment(videos, k, { iouThreshold: iouT });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(7);
  console.log(`videos=${videos.length}  labels=${videos.reduce((a, v) => a + v.labels.length, 0)}  k=${k}  IoU>=${iouT}\n`);
  console.log('strategy   recall@k  precision  meanBestIoU');
  for (const r of results) console.log(`${r.strategy.padEnd(10)} ${pct(r.recall)}  ${pct(r.precision)}  ${r.meanBestIoU.toFixed(3).padStart(10)}`);

  const uni = results.find((r) => r.strategy === 'uniform')!;
  for (const name of ['acoustic', 'hybrid'] as const) {
    const r = results.find((x) => x.strategy === name)!;
    const wins = r.perVideo.filter((p, i) => p.recall > uni.perVideo[i].recall).length;
    const losses = r.perVideo.filter((p, i) => p.recall < uni.perVideo[i].recall).length;
    console.log(`${name} vs uniform: lift ${(r.recall - uni.recall >= 0 ? '+' : '') + pct(r.recall - uni.recall).trim()} recall, wins ${wins} / losses ${losses} / ties ${videos.length - wins - losses}`);
  }
  if (videos.length < 20) console.log('\nNote: <20 labelled videos — treat differences as directional, not significant.');
}
main();
