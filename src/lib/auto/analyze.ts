import { PY, SCRIPT, run, venvReady } from './media.ts';
import { detectSilences } from '../studio/retime.ts';
import { detectTempo } from './tempo.ts';
import { assetPath, updateProject } from './store.ts';
import type { AutoAsset, AutoProject, SceneInfo, VideoAnalysis } from './types.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const MAX_ANALYSE_SECONDS = 600;
/** Mouth-region frame difference (0..255 grayscale at ~480 px) above which a visible face is flagged "likely speaking". Heuristic, tunable. */
export const MOUTH_MOTION_THRESHOLD = 1.6;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Scene cut times (s) from ffmpeg's scene score on a down-scaled copy: classical, no model. */
export async function detectSceneCuts(file: string, duration: number, threshold = 0.32): Promise<number[]> {
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-nostdin', '-t', String(Math.min(duration, MAX_ANALYSE_SECONDS)), '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 300_000, nice: true });
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.3 && t < duration - 0.3).sort((a, b) => a - b);
}

interface Sample { t: number; sharp: number; bright: number; motion: number; face: number[] | null; mouth: number }

/** Pure: build scene records from cut times + per-sample metrics + silences. Exported for tests. */
export function buildScenes(cuts: number[], duration: number, samples: Sample[], silences: { start: number; end: number }[], rate: number): SceneInfo[] {
  const bounds = [0, ...cuts, duration]; let segs: [number, number][] = [];
  for (let i = 0; i < bounds.length - 1; i++) segs.push([bounds[i], bounds[i + 1]]);
  // fold slivers (< 0.8 s) into their neighbour so a flash frame never becomes a "scene"
  const merged: [number, number][] = [];
  for (const s of segs) { if (merged.length && s[1] - s[0] < 0.8) merged[merged.length - 1][1] = s[1]; else merged.push([...s]); }
  while (merged.length > 1 && merged[0][1] - merged[0][0] < 0.8) { merged[1][0] = merged[0][0]; merged.shift(); } // a leading sliver folds forward
  segs = merged.length ? merged : [[0, duration]];
  return segs.map(([a, b]) => {
    const inn = samples.filter((s) => s.t >= a && s.t < b); const n = Math.max(1, inn.length);
    const sharp = inn.reduce((x, s) => x + s.sharp, 0) / n, bright = inn.reduce((x, s) => x + s.bright, 0) / n;
    const motion = inn.reduce((x, s) => x + s.motion, 0) / n;
    const withFace = inn.filter((s) => s.face); const faceFraction = withFace.length / n;
    const faceCenterX = withFace.length ? withFace.reduce((x, s) => x + s.face![0] + s.face![2] / 2, 0) / withFace.length : null;
    const mouth = withFace.length ? withFace.reduce((x, s) => x + s.mouth, 0) / withFace.length : 0;
    const silent = silences.reduce((x, s) => x + Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)), 0);
    const speechFraction = clamp01(1 - silent / Math.max(0.01, b - a));
    const speaking = faceFraction > 0.3 && speechFraction > 0.4 && mouth > MOUTH_MOTION_THRESHOLD;
    const sh = clamp01((Math.log10(Math.max(1, sharp)) - 0.8) / 2.2), ex = clamp01(1 - Math.abs(bright - 120) / 120);
    const mo = Math.exp(-0.5 * ((motion - 4) / 4) ** 2);                          // gentle movement is good; frozen or chaotic is not
    const score = +(0.3 * sh + 0.2 * ex + 0.15 * mo + 0.2 * faceFraction + 0.15 * (speaking ? 1 : speechFraction * 0.4)).toFixed(3);
    return { start: +a.toFixed(3), end: +b.toFixed(3), score, sharpness: +sharp.toFixed(1), brightness: +bright.toFixed(1), motion: +motion.toFixed(2), faceFraction: +faceFraction.toFixed(2), faceCenterX, speaking, speechFraction: +speechFraction.toFixed(2) };
  });
}

export async function analyseVideo(file: string, duration: number, hasAudio: boolean): Promise<VideoAnalysis> {
  const notes: string[] = []; const d = Math.min(duration, MAX_ANALYSE_SECONDS);
  if (duration > MAX_ANALYSE_SECONDS) notes.push(`only the first ${MAX_ANALYSE_SECONDS / 60} minutes were analysed`);
  const cuts = await detectSceneCuts(file, d);
  const silences = hasAudio ? await detectSilences(file, 0, d, -34, 0.5).catch(() => { notes.push('silence detection failed'); return []; }) : [];
  if (!hasAudio) notes.push('no audio track');
  let samples: Sample[] = [], level: VideoAnalysis['level'] = 'full';
  if (venvReady()) {
    const rate = Math.max(1, Math.min(4, 1200 / Math.max(1, d)));
    try { samples = JSON.parse((await run(PY(), [SCRIPT('auto_analyze.py'), 'video', '--input', file, '--rate', String(rate), '--start', '0', '--end', String(d)], { timeoutMs: 600_000, nice: true })).stdout).samples; }
    catch (e) { level = 'basic'; notes.push(`frame analysis failed: ${(e as Error).message.slice(0, 80)}`); }
  } else { level = 'basic'; notes.push('OpenCV not installed: faces and sharpness skipped'); }
  const scenes = buildScenes(cuts, d, samples, silences, 4);
  const total = scenes.reduce((x, s) => x + (s.end - s.start), 0) || 1;
  const quality = +(scenes.reduce((x, s) => x + s.score * (s.end - s.start), 0) / total).toFixed(3);
  const silent = silences.reduce((x, s) => x + (s.end - s.start), 0);
  return { scenes, silences, speechFraction: +clamp01(1 - silent / Math.max(0.01, d)).toFixed(3), faceFraction: +(samples.filter((s) => s.face).length / Math.max(1, samples.length)).toFixed(3), quality, level, notes };
}

export type AnalyseProgress = (done: number, total: number, label: string) => void;
/** Analyse every asset that has not been analysed yet (photos are analysed at upload). Results are saved on the project. */
export async function analyseProject(p: AutoProject, onProgress?: AnalyseProgress): Promise<AutoProject> {
  const todo = p.assets.filter((a) => (a.kind === 'video' && !a.video) || (a.kind === 'audio' && !a.audio));
  let i = 0;
  for (const a of todo) {
    onProgress?.(i, todo.length, a.name);
    const f = assetPath(p, a);
    if (a.kind === 'video') { const v = await analyseVideo(f, a.duration, a.hasAudio); updateProject(p.id, (q) => { const t = q.assets.find((x) => x.id === a.id); if (t) t.video = v; }); }
    else { const t = await detectTempo(f, 45); updateProject(p.id, (q) => { const x = q.assets.find((y) => y.id === a.id); if (x) x.audio = t; }); }
    i++;
  }
  onProgress?.(todo.length, todo.length, 'done');
  return (await import('./store.ts')).getProject(p.id)!;
}
export type { AutoAsset };
