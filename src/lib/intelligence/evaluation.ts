import type { CandidateMoment, LoudnessSample, SilenceInterval, TranscriptSegmentLike } from './types.ts';
import { scoreCandidateMoments } from './attention-scorer.ts';

/** A human-labelled "this is a good clip" interval. */
export interface LabelledMoment { start: number; end: number; note?: string }
export interface Window { start: number; end: number }

export interface EvalVideo {
  id: string;
  duration: number;
  silences: SilenceInterval[];
  loudness: LoudnessSample[];
  transcript?: TranscriptSegmentLike[];
  labels: LabelledMoment[];
}

export type Strategy = 'uniform' | 'random' | 'acoustic' | 'hybrid';
export const STRATEGIES: Strategy[] = ['uniform', 'random', 'acoustic', 'hybrid'];

/** Deterministic PRNG so experiments are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function iou(a: Window, b: Window): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = (a.end - a.start) + (b.end - b.start) - inter;
  return union > 0 ? inter / union : 0;
}

/** Baseline: k evenly spaced fixed-length windows. This is the bar the engine must beat. */
export function uniformWindows(duration: number, k: number, len: number): Window[] {
  const out: Window[] = [];
  const usable = Math.max(0, duration - len);
  for (let i = 0; i < k; i++) {
    const s = k === 1 ? usable / 2 : (usable * i) / (k - 1);
    out.push({ start: s, end: Math.min(duration, s + len) });
  }
  return out;
}

export function randomWindows(duration: number, k: number, len: number, seed: number): Window[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: k }, () => {
    const s = rnd() * Math.max(0, duration - len);
    return { start: s, end: Math.min(duration, s + len) };
  });
}

export function selectWindows(v: EvalVideo, strategy: Strategy, k: number, opts: { len: number; seed: number; minDuration: number; maxDuration: number }): Window[] {
  switch (strategy) {
    case 'uniform': return uniformWindows(v.duration, k, opts.len);
    case 'random': return randomWindows(v.duration, k, opts.len, opts.seed);
    case 'acoustic':
    case 'hybrid': {
      const cands: CandidateMoment[] = scoreCandidateMoments(v.silences, v.loudness, v.duration, {
        sourceId: v.id, targetCount: k, minDuration: opts.minDuration, maxDuration: opts.maxDuration,
        transcript: strategy === 'hybrid' ? v.transcript : undefined,
      });
      return cands.map((c) => ({ start: c.startTime, end: c.endTime }));
    }
  }
}

export interface VideoResult { id: string; recall: number; precision: number; meanBestIoU: number; firstHitRank: number | null }

/** A prediction "hits" a label if IoU >= threshold. Recall = labels found; precision = useful predictions. */
export function scoreVideo(v: EvalVideo, preds: Window[], iouThreshold = 0.3): VideoResult {
  const hitLabels = v.labels.filter((l) => preds.some((p) => iou(p, l) >= iouThreshold)).length;
  const usefulPreds = preds.filter((p) => v.labels.some((l) => iou(p, l) >= iouThreshold)).length;
  const bestIoUs = v.labels.map((l) => Math.max(0, ...preds.map((p) => iou(p, l))));
  const rank = preds.findIndex((p) => v.labels.some((l) => iou(p, l) >= iouThreshold));
  return {
    id: v.id,
    recall: v.labels.length ? hitLabels / v.labels.length : 0,
    precision: preds.length ? usefulPreds / preds.length : 0,
    meanBestIoU: bestIoUs.length ? bestIoUs.reduce((a, b) => a + b, 0) / bestIoUs.length : 0,
    firstHitRank: rank >= 0 ? rank + 1 : null,
  };
}

export interface StrategySummary { strategy: Strategy; recall: number; precision: number; meanBestIoU: number; perVideo: VideoResult[] }

export function runExperiment(videos: EvalVideo[], k: number, opts: { len?: number; randomTrials?: number; minDuration?: number; maxDuration?: number; iouThreshold?: number } = {}): StrategySummary[] {
  const { len = 40, randomTrials = 200, minDuration = 22, maxDuration = 70, iouThreshold = 0.3 } = opts;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return STRATEGIES.map((strategy) => {
    // Random is averaged over many seeds so one lucky draw can't flatter (or hurt) the baseline.
    const trials = strategy === 'random' ? randomTrials : 1;
    const perVideo: VideoResult[] = videos.map((v) => {
      const rs = Array.from({ length: trials }, (_, t) =>
        scoreVideo(v, selectWindows(v, strategy, k, { len, seed: 1000 + t, minDuration, maxDuration }), iouThreshold));
      return { id: v.id, recall: mean(rs.map((r) => r.recall)), precision: mean(rs.map((r) => r.precision)),
        meanBestIoU: mean(rs.map((r) => r.meanBestIoU)), firstHitRank: rs[0].firstHitRank };
    });
    return { strategy, recall: mean(perVideo.map((r) => r.recall)), precision: mean(perVideo.map((r) => r.precision)),
      meanBestIoU: mean(perVideo.map((r) => r.meanBestIoU)), perVideo };
  });
}
