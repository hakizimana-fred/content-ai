import fs from 'node:fs';
import path from 'node:path';
import { PY, SCRIPT, run } from './media.ts';
import type { AutoProject, QcCheck, QcReport, Timeline } from './types.ts';

/**
 * Automated quality control of a finished MP4. Every check measures the real file (ffprobe, ffmpeg filters, sampled frames)
 * and the scene renderer's own text boxes. Results are stored per project and shown in the UI.
 */
type Status = QcCheck['status'];
const chk = (id: string, label: string, status: Status, detail: string): QcCheck => ({ id, label, status, detail });

interface SceneBox { x: number; y: number; w: number; h: number; text: string; slam?: boolean }
export interface SceneMeta { boxes: SceneBox[]; fonts: string[]; peakRssMB: number | null; frames: number; w: number; h: number }

/** Text must stay inside the title-safe area: 6% at the sides, 5% at the top, and a larger bottom margin on tall (platform UI) formats. */
export function safeArea(w: number, h: number) { const portrait = h > w * 1.2; return { l: w * 0.06, r: w * 0.94, t: h * 0.05, b: h * (portrait ? 0.88 : 0.93) }; }
export function textViolations(meta: SceneMeta, w: number, h: number): string[] {
  const a = safeArea(w, h), out: string[] = [];
  for (const b of meta.boxes) if (b.x < a.l - 1 || b.x + b.w > a.r + 1 || b.y < a.t - 1 || b.y + b.h > a.b + 1) out.push(`"${b.text.slice(0, 24)}"`);
  return out;
}

export async function runQc(project: AutoProject, t: Timeline, file: string, sceneMetaFiles: (string | null)[], hasAudioExpected: boolean): Promise<QcReport> {
  const checks: QcCheck[] = []; const stats: QcReport['stats'] = {};
  const base: QcReport = { at: Date.now(), file: path.basename(file), verdict: 'fail', checks, stats };
  // 1. exists + readable
  let info: { format?: { duration?: string; size?: string; bit_rate?: string }; streams?: { codec_type: string; width?: number; height?: number; duration?: string; codec_name?: string; r_frame_rate?: string }[] };
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < 2000) throw new Error('file missing or empty');
    info = JSON.parse((await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30_000 })).stdout);
    if (!info.streams?.some((s) => s.codec_type === 'video')) throw new Error('no video stream');
    checks.push(chk('readable', 'MP4 exists and is readable', 'pass', `${(fs.statSync(file).size / 1e6).toFixed(2)} MB, ${info.streams.find((s) => s.codec_type === 'video')!.codec_name}`));
  } catch (e) { checks.push(chk('readable', 'MP4 exists and is readable', 'fail', (e as Error).message.slice(0, 160))); return finish(base); }
  const v = info.streams!.find((s) => s.codec_type === 'video')!, a = info.streams!.find((s) => s.codec_type === 'audio');
  const dur = Number(info.format?.duration ?? 0); stats.durationSec = +dur.toFixed(2); stats.bytes = Number(info.format?.size ?? 0); stats.codec = v.codec_name ?? null;
  // 2. resolution + duration
  checks.push(v.width === t.w && v.height === t.h ? chk('resolution', 'Resolution', 'pass', `${v.width}×${v.height} as requested`) : chk('resolution', 'Resolution', 'fail', `${v.width}×${v.height}, expected ${t.w}×${t.h}`));
  const tol = Math.max(0.6, t.total * 0.03); const dd = Math.abs(dur - t.total);
  checks.push(dd <= tol ? chk('duration', 'Duration', 'pass', `${dur.toFixed(2)} s (planned ${t.total.toFixed(2)} s)`) : chk('duration', 'Duration', dd <= tol * 3 ? 'warn' : 'fail', `${dur.toFixed(2)} s, planned ${t.total.toFixed(2)} s`));
  const fr = (v.r_frame_rate ?? '').split('/').map(Number); const fps = fr[1] ? fr[0] / fr[1] : 0; stats.fps = +fps.toFixed(2);
  checks.push(Math.abs(fps - t.fps) < 0.6 ? chk('fps', 'Frame rate', 'pass', `${fps.toFixed(1)} fps`) : chk('fps', 'Frame rate', 'warn', `${fps.toFixed(2)} fps, expected ${t.fps}`));
  // 3. audio present + A/V sync
  if (!hasAudioExpected) checks.push(chk('audio', 'Audio present', 'skipped', 'this video was set to have no audio'));
  else if (!a) checks.push(chk('audio', 'Audio present', 'fail', 'no audio stream although music/audio was expected'));
  else {
    const vol = await run('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { timeoutMs: 60_000 }).then((r) => r.stderr).catch(() => '');
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1], max = /max_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1]; stats.audioMeanDb = mean ? Number(mean) : null; stats.audioPeakDb = max ? Number(max) : null;
    checks.push(max !== undefined && Number(max) > -50 ? chk('audio', 'Audio present', 'pass', `${a.codec_name}, mean ${mean} dB, peak ${max} dB`) : chk('audio', 'Audio present', 'fail', `audio stream is silent (peak ${max ?? '?'} dB)`));
    const ad = Number(a.duration ?? dur), vd = Number(v.duration ?? dur); const drift = Math.abs(ad - vd); stats.avDriftSec = +drift.toFixed(3);
    checks.push(drift < 0.25 ? chk('sync', 'Audio and video lengths match', 'pass', `drift ${(drift * 1000).toFixed(0)} ms`) : chk('sync', 'Audio and video lengths match', drift < 0.6 ? 'warn' : 'fail', `audio ${ad.toFixed(2)} s vs video ${vd.toFixed(2)} s`));
  }
  // 4. black frames + frozen video (blackdetect / freezedetect over the whole file, scaled down for speed)
  const fadeBlack = t.shots.flatMap((s, i) => (s.transitionOut?.type === 'fadeblack' ? [{ a: s.cutAt - (s.transitionOut.dur) - 0.2, b: s.cutAt + s.transitionOut.dur + 0.2 }] : (void i, []))); 
  const vf = await run('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'scale=iw/6:-2,blackdetect=d=0.2:pix_th=0.1,freezedetect=n=-55dB:d=1.6', '-an', '-f', 'null', '-'], { timeoutMs: 240_000, nice: true }).then((r) => r.stderr).catch((e) => String(e));
  const blacks = [...vf.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ s: +m[1], e: +m[2] }));
  const bad = blacks.filter((b) => !(b.s < 0.35 && b.e < 1.2) && !(b.e >= dur - 0.15 && b.s > dur - 1.6) && !fadeBlack.some((f) => b.s >= f.a && b.e <= f.b));
  stats.blackIntervals = blacks.length;
  checks.push(!bad.length ? chk('black', 'No unintended black frames', 'pass', blacks.length ? `${blacks.length} intentional black interval(s) (open/close/fade)` : 'none') : chk('black', 'No unintended black frames', 'fail', bad.map((b) => `${b.s.toFixed(1)}–${b.e.toFixed(1)} s`).join(', ')));
  const frozen = [...vf.matchAll(/freeze_start:\s*([\d.]+)[\s\S]*?freeze_duration:\s*([\d.]+)/g)].map((m) => ({ s: +m[1], d: +m[2] })).filter((f) => f.d > 1.6 && !(f.s + f.d >= dur - 0.2 && f.d < 2.6));
  checks.push(!frozen.length ? chk('freeze', 'Video keeps moving', 'pass', 'no frozen segments') : chk('freeze', 'Video keeps moving', 'warn', frozen.map((f) => `${f.s.toFixed(1)} s for ${f.d.toFixed(1)} s`).join(', ')));
  // 5. every planned shot is actually visible: sample the middle of its solo part (and each transition midpoint) and compare
  const mids: number[] = []; t.shots.forEach((s) => { const vis = Math.max(0.1, s.cutAt - s.start); mids.push(s.start + Math.min(vis * 0.5, vis - 0.05)); });
  const trans = t.shots.slice(0, -1).map((s) => s.cutAt); mids.push(...trans);
  let samples: { t: number; ok: boolean; mean: number; std: number }[] = [];
  try { samples = JSON.parse((await run(PY(), [SCRIPT('auto_qc.py')], { input: JSON.stringify({ file, times: mids.map((x) => Math.min(Math.max(0, x), Math.max(0, dur - 0.1))) }), timeoutMs: 90_000, nice: true })).stdout).samples; } catch { /* reported below */ }
  if (!samples.length) checks.push(chk('scenes', 'Every scene is present', 'warn', 'frame sampling was not available'));
  else {
    const n = t.shots.length; const missing = samples.slice(0, n).map((s, i) => ({ s, i })).filter(({ s, i }) => !s.ok || (s.mean < 6 && s.std < 3 && !(i === n - 1 && t.shots[i].transitionOut === null && false))).map(({ i }) => `shot ${i + 1}`);
    checks.push(!missing.length ? chk('scenes', 'Every scene is present', 'pass', `${n} of ${n} shots visible at their planned time`) : chk('scenes', 'Every scene is present', 'fail', `blank or unreadable: ${missing.join(', ')}`));
    const tr = samples.slice(n); const tBad = tr.map((s, i) => ({ s, i })).filter(({ s, i }) => !s.ok || (s.mean < 3 && t.shots[i].transitionOut?.type !== 'fadeblack' && t.shots[i].transitionOut?.type !== 'fade'));
    checks.push(!tBad.length ? chk('transitions', 'Transitions render cleanly', 'pass', `${tr.length} transition midpoint(s) decoded with picture`) : chk('transitions', 'Transitions render cleanly', 'fail', `transition ${tBad.map((x) => x.i + 1).join(', ')} is blank`));
  }
  // 6. text safe area, from the renderer's own text boxes
  const metas: SceneMeta[] = sceneMetaFiles.filter((x): x is string => !!x && fs.existsSync(x)).map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as SceneMeta; } catch { return null; } }).filter((x): x is SceneMeta => !!x);
  const sceneShots = t.shots.filter((s) => s.kind === 'scene').length;
  if (!sceneShots) checks.push(chk('safe', 'Text inside safe areas', 'skipped', 'no generated text scenes'));
  else if (metas.length < sceneShots) checks.push(chk('safe', 'Text inside safe areas', 'warn', `text boxes known for ${metas.length} of ${sceneShots} scenes (older cached scenes have no box data; re-render to check)`));
  const viol = metas.flatMap((m, i) => textViolations(m, m.w, m.h).map((x) => `scene ${i + 1} ${x}`));
  if (metas.length && metas.length >= sceneShots) checks.push(!viol.length ? chk('safe', 'Text inside safe areas', 'pass', `${metas.reduce((n, m) => n + m.boxes.length, 0)} text boxes inside the ${t.h > t.w * 1.2 ? '6% / 12% bottom' : '6%'} margins`) : chk('safe', 'Text inside safe areas', 'warn', `outside the safe area: ${viol.slice(0, 4).join('; ')}`));
  stats.fontsUsed = [...new Set(metas.flatMap((m) => m.fonts))].join(', ') || null; stats.peakSceneRssMB = metas.length ? Math.max(...metas.map((m) => m.peakRssMB ?? 0)) : null;
  // 7. assets present
  const missingAssets = t.shots.filter((s) => s.kind !== 'scene' && !project.assets.some((x) => x.id === s.assetId)).length;
  checks.push(!missingAssets ? chk('assets', 'No missing assets', 'pass', 'every referenced file was found') : chk('assets', 'No missing assets', 'fail', `${missingAssets} shot(s) reference a file that no longer exists`));
  return finish(base);
}
function finish(r: QcReport): QcReport { r.verdict = r.checks.some((c) => c.status === 'fail') ? 'fail' : r.checks.some((c) => c.status === 'warn') ? 'warn' : 'pass'; return r; }
