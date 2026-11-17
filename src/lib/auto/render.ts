import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildAss } from '../editor/ass.ts';
import { CAPTION_LOOKS } from '../studio/styles.ts';
import { toTimedWords, type TimedWord } from '../editor/captions.ts';
import { composeAss, type OverlaySpec } from '../studio/overlay.ts';
import { applyAudioDesign } from '../studio/mix.ts';
import { GRADE_FILTERS, hasAudioWork, type AudioDesignSpec } from '../studio/audio-spec.ts';
import { PY, SCRIPT, run } from './media.ts';
import { assetPath, assetsDir, renderDir, AUTO_DIR } from './store.ts';
import type { AutoAsset, AutoProject, Shot, Timeline } from './types.ts';
import type { Intent, StyleProfile } from './profiles.ts';
import type { Soundtrack } from './soundtrack.ts';
import { STUDIO_DIR } from '../studio/settings.ts';
import { logoFile } from '../studio/logo-store.ts';
import { getIdentity } from '../studio/identity-store.ts';
import { creativeFile, getCreative } from './creative-assets.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const AMP = { subtle: 0.6, medium: 1, strong: 1.35 } as const;
const sha = (x: unknown) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 14);

export type StageFn = (id: string, patch: { status?: 'running' | 'done' | 'skipped' | 'error'; detail?: string; progress?: number }) => void;
export interface RenderOptions { project: AutoProject; timeline: Timeline; soundtrack: Soundtrack; intent: Intent; profile: StyleProfile; stage: StageFn; transcribe?: (asset: AutoAsset) => Promise<{ segments: unknown[] } | null>; signal?: { cancelled: boolean } }
export interface RenderResult { file: string; seconds: number; applied: string[]; skipped: string[]; cached: { shots: number; join: boolean } }

/** Run ffmpeg at low priority, parsing `-progress` for a REAL percentage of `totalSec` of output. */
function ffmpegProgress(args: string[], totalSec: number, onPct: (p: number) => void, signal?: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', FFMPEG, '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-threads', '3', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; const poll = setInterval(() => { if (signal?.cancelled) p.kill('SIGKILL'); }, 500);
    p.stdout.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { const m = /^out_time_us=(\d+)/.exec(l); if (m) onPct(Math.max(0, Math.min(99, (Number(m[1]) / 1e6 / Math.max(0.1, totalSec)) * 100))); } });
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', (e) => { clearInterval(poll); reject(e); });
    p.on('close', (c) => { clearInterval(poll); if (signal?.cancelled) return reject(new Error('Cancelled')); c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}: ${err.slice(-400)}`)); });
  });
}
const f3 = (n: number) => n.toFixed(3);

/** Video-shot framing filter graph: crop around the detected face, or keep the whole frame over a blurred fill. */
export function videoShotGraph(s: Shot, W: number, H: number, fps: number, hasAudio: boolean): string {
  const A = (W / H).toFixed(5), bw = Math.max(2, Math.round(W / 16) * 2), bh = Math.max(2, Math.round(H / 16) * 2);
  const v = s.videoFraming === 'blur'
    ? `[0:v]split[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=3:1,scale=${W}:${H},setsar=1[bg];[b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p[v]`
    : `[0:v]crop=w='min(iw,ih*${A})':h='min(ih,iw/${A})':x='max(0,min(iw-ow,${(s.videoCenterX ?? 0.5).toFixed(4)}*iw-ow/2))':y='(ih-oh)/2',scale=${W}:${H}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[v]`;
  return `${v};${hasAudio ? '[0:a]' : '[1:a]'}aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a]`;
}

const sceneExt = (s: Shot) => (s.kind === 'video' ? 'mkv' : 'mp4');
/** Resolve the creative-library file a scene uses as its background (image or video), if any. */
function sceneAsset(s: Shot): { file: string; kind: 'image' | 'video' | 'model' } | null {
  const id = s.scene?.creativeAssetId; if (!id) return null; const a = getCreative(id); const f = a ? creativeFile(a) : null;
  return a && f && fs.existsSync(f) ? { file: f, kind: a.kind === 'model' ? 'model' : a.kind === 'footage' || /^(mp4|mov|webm)$/.test(a.ext ?? '') ? 'video' : 'image' } : null;
}
/** Content hash of the scene renderer + bundled fonts: changing either invalidates cached scene clips. */
let rv: { t: number; h: string } | null = null;
function rendererVersion(): string {
  const fs_ = ['scene_render.py', 'render3d.py'].map((n) => SCRIPT(n)), t = fs_.reduce((a, f) => a + fs.statSync(f).mtimeMs, 0); if (rv && rv.t === t) return rv.h;
  const h = crypto.createHash('sha1'); for (const f of fs_) h.update(fs.readFileSync(f)); rv = { t, h: h.digest('hex').slice(0, 12) }; return rv.h;
}
let FONT_FILE: string | null = null;
const fontFileOf = () => (FONT_FILE && fs.existsSync(FONT_FILE) ? [FONT_FILE, fs.statSync(FONT_FILE).mtimeMs] : null);
const beatPhase = (s: Shot, i: number, t: Timeline) => (i === 0 ? t.beatOffset : (t.shots[i - 1].transitionOut?.dur ?? 0) / 2);
export function shotKey(s: Shot, a: AutoAsset | undefined, t: Timeline, profile: StyleProfile): string {
  if (s.kind === 'scene') { const sa = sceneAsset(s), i = t.shots.indexOf(s); return sha({ v: 2, r: rendererVersion(), ff: fontFileOf(), sc: s.scene, look: t.look, len: s.len, w: t.w, h: t.h, fps: t.fps, beat: t.beatSeconds, ph: beatPhase(s, i, t), asset: sa && [sa.file, fs.statSync(sa.file).mtimeMs] }); }
  if (!a) throw new Error('missing media for shot');
  return sha({ v: 2, s: { k: s.kind, len: s.len, src: s.srcStart, srcLen: s.srcLen, m: s.motion, lay: s.layout, f: s.focus, vf: s.videoFraming, cx: s.videoCenterX }, a: [a.file, a.bytes], w: t.w, h: t.h, fps: t.fps, amp: profile.motionIntensity });
}

async function renderShots(o: RenderOptions): Promise<number> {
  const { project, timeline: t, profile } = o; const dir = path.join(renderDir(project.id), 'shots'); fs.mkdirSync(dir, { recursive: true });
  let cached = 0; FONT_FILE = null;
  const fid = project.config.fontAssetId; if (fid) { const fa = getCreative(fid); const ff = fa && fa.kind === 'font' ? creativeFile(fa) : null; if (ff) FONT_FILE = ff; }
  for (let i = 0; i < t.shots.length; i++) {
    if (o.signal?.cancelled) throw new Error('Cancelled');
    const s = t.shots[i], a = project.assets.find((x) => x.id === s.assetId) as AutoAsset; const key = shotKey(s, a, t, profile);
    const out = path.join(dir, `${key}.${sceneExt(s)}`); const label = s.kind === 'scene' ? `${s.scene!.kind} scene` : a.name;
    o.stage('shots', { status: 'running', detail: `shot ${i + 1} of ${t.shots.length}: ${label}`, progress: Math.round((i / t.shots.length) * 100) });
    if (fs.existsSync(out)) { cached++; continue; }
    const tmp = out + '.part';
    try {
      if (s.kind === 'scene') {
        const sc = s.scene!, look = t.look!, sa = sceneAsset(s);
        const job = { out: tmp, w: t.w, h: t.h, fps: t.fps, seconds: s.len, beat: t.beatSeconds ?? 0, beatT0: beatPhase(s, i, t), seed: i + 1,
          bg: { type: sa && sa.kind !== 'model' ? 'asset' : sc.bg === 'asset' ? 'aurora' : sc.bg, colors: look.colors, accent: look.accent, speed: look.speed, asset: sa?.kind === 'model' ? undefined : sa?.file, assetKind: sa?.kind === 'model' ? undefined : sa?.kind, dim: look.dim },
          text: { color: look.text, font: look.font, upper: look.upper, anim: look.anim, fontFile: FONT_FILE },
          fx: look.fx, motif: look.motif,
          scene: { kind: sc.kind, composition: sc.composition, steps: sc.steps, three: sc.three && sa?.kind === 'model' ? { ...sc.three, objects: sc.three.objects.map((ob) => (ob.shape === 'glb' ? { ...ob, file: sa.file } : ob)) } : sc.three, scenery: sc.scenery, motion: sc.motion, asset: sa?.kind === 'model' ? undefined : sa?.file, assetKind: sa?.kind === 'model' ? undefined : sa?.kind, title: sc.title, subtitle: sc.subtitle, lines: sc.lines, quote: sc.quote, attribution: sc.attribution, cta: sc.cta, bullets: sc.bullets, stats: sc.stats } };
        await run(PY(), [SCRIPT('scene_render.py')], { input: JSON.stringify(job), timeoutMs: 900_000, nice: true, signal: o.signal,
          onStderr: (c) => { const m = [...c.matchAll(/PROGRESS (\d+) (\d+)/g)].pop(); if (m) o.stage('shots', { status: 'running', detail: `scene ${i + 1} of ${t.shots.length}: ${label}, frame ${m[1]} of ${m[2]}`, progress: Math.round(((i + Number(m[1]) / Number(m[2])) / t.shots.length) * 100) }); } });
        if (fs.existsSync(tmp + '.meta.json')) fs.renameSync(tmp + '.meta.json', out + '.meta.json');
      } else if (s.kind === 'photo') {
        await run(PY(), [SCRIPT('auto_motion.py')], { input: JSON.stringify({ image: assetPath(project, a), out: tmp, w: t.w, h: t.h, fps: t.fps, seconds: s.len, move: s.motion ?? 'zoom_in', focus: s.focus, layout: s.layout, amp: AMP[profile.motionIntensity] }), timeoutMs: 600_000, nice: true });
      } else {
        const src = assetPath(project, a), len = s.len;
        const args = ['-y', '-ss', f3(s.srcStart), '-t', f3(len), '-i', src, ...(a.hasAudio ? [] : ['-f', 'lavfi', '-t', f3(len), '-i', 'anullsrc=r=48000:cl=stereo']),
          '-filter_complex', videoShotGraph(s, t.w, t.h, t.fps, a.hasAudio), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-t', f3(len), '-f', 'matroska', tmp];
        await ffmpegProgress(args, len, () => { /* per-shot sub-progress is folded into the shot counter */ }, o.signal);
      }
      fs.renameSync(tmp, out);
    } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } try { fs.unlinkSync(tmp + '.meta.json'); } catch { /* none */ } if ((e as Error).message === 'Cancelled') throw e; throw new Error(`Shot ${i + 1} (${label}) failed: ${(e as Error).message.slice(-260)}`); }
  }
  o.stage('shots', { status: 'done', detail: `${t.shots.length} shots rendered${cached ? ` (${cached} reused from cache)` : ''}`, progress: 100 });
  return cached;
}

/** Caption words for the speech shots, mapped to timeline time and clipped to the part of the shot that is actually visible. */
export function captionWords(shots: Shot[], wordsByAsset: Map<string, TimedWord[]>): TimedWord[] {
  const out: TimedWord[] = [];
  shots.forEach((s, i) => {
    if (s.kind !== 'video') return; const words = wordsByAsset.get(s.assetId); if (!words) return;
    const visFrom = s.start + (i === 0 ? 0 : (s.transitionOut ? 0 : 0)), visTo = s.cutAt; const prev = shots[i - 1]; const from = prev ? prev.cutAt : 0;
    void visFrom;
    for (const w of words) {
      if (w.end <= s.srcStart || w.start >= s.srcStart + s.srcLen) continue;
      const a = Math.max(from, s.start + (w.start - s.srcStart)), b = Math.min(visTo, s.start + (w.end - s.srcStart));
      if (b - a >= 0.05) out.push({ ...w, start: a, end: b });
    }
  });
  return out;
}

function buildTextAss(o: RenderOptions, words: TimedWord[]): { ass: string | null; notes: string[] } {
  const { timeline: t, profile, project } = o; const notes: string[] = []; const total = t.total;
  let base: string | null = null;
  if (words.length) {
    const look = CAPTION_LOOKS[profile.caption];
    base = buildAss({ words, clipStart: 0, clipEnd: total, style: { ...look, position: 'bottom', fontSize: Math.round(look.fontSize * (project.config.textScale ?? 1)) }, platform: project.config.format === '16:9' ? 'youtube' : 'tiktok', playResX: t.w, playResY: t.h });
  }
  const idn = project.config.identityId ? getIdentity(project.config.identityId) : null;
  const ov: OverlaySpec = { accent: idn?.colors.accent ?? '#F59E0B', text: idn?.colors.text ?? '#FFFFFF', fontFamily: idn?.typography.fontFamily ?? profile.textLook.font, scale: project.config.textScale ?? 1 };
  if (t.text.headline) ov.title = { text: t.text.headline.slice(0, 60), seconds: Math.min(2.8, Math.max(1.2, t.shots[0].cutAt - 0.3)) };
  if (t.text.cta) ov.endCard = { text: t.text.cta.slice(0, 60), seconds: Math.min(2.8, Math.max(1.4, (t.shots[t.shots.length - 1].len) - 0.5)) };
  if (idn && idn.brand.corner !== 'none' && idn.brand.text && !idn.logo) ov.brand = { text: idn.brand.text, corner: idn.brand.corner };
  const ass = (ov.title || ov.endCard || ov.brand) ? composeAss(base, ov, t.w, t.h, total) : base;
  return { ass, notes };
}

function joinGraph(t: Timeline, hasAudioIdx: boolean[], grade: string | null, assPath: string | null, fontsDir: string | null, logo: { idx: number; corner: string } | null): { graph: string; vOut: string } {
  const n = t.shots.length, g: string[] = [];
  const fq = (v: string) => v.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  t.shots.forEach((s, i) => {
    g.push(`[${i}:v]fps=${t.fps},settb=1/${t.fps},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`); // one common timebase: xfade rejects mixed containers otherwise
    g.push(hasAudioIdx[i] ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=0:${f3(s.len)}[a${i}]` : `anullsrc=r=48000:cl=stereo,atrim=0:${f3(s.len)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let v = 'v0', a = 'a0';
  for (let i = 0; i < n - 1; i++) {
    const tr = t.shots[i].transitionOut!, name = tr.type === 'cut' ? 'fade' : tr.type;
    g.push(`[${v}][v${i + 1}]xfade=transition=${name}:duration=${f3(tr.dur)}:offset=${f3(t.shots[i + 1].start)}[x${i + 1}]`);
    g.push(`[${a}][a${i + 1}]acrossfade=d=${f3(tr.dur)}:c1=tri:c2=tri[ax${i + 1}]`);
    v = `x${i + 1}`; a = `ax${i + 1}`;
  }
  let cur = v; const post: string[] = [];
  if (grade) post.push(grade);
  if (logo) {
    const mx = Math.round(t.w * 0.04), my = Math.round(t.h * 0.05), lw = Math.round(t.w * 0.16 / 2) * 2;
    g.push(`[${logo.idx}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=0.92[lg]`);
    if (post.length) { g.push(`[${cur}]${post.join(',')}[gr]`); cur = 'gr'; post.length = 0; }
    g.push(`[${cur}][lg]overlay=${logo.corner.endsWith('l') ? mx : `main_w-overlay_w-${mx}`}:${logo.corner.startsWith('t') ? my : `main_h-overlay_h-${my}`}:shortest=1[lo]`); cur = 'lo';
  }
  if (assPath) post.push(`subtitles='${fq(assPath)}'${fontsDir ? `:fontsdir='${fq(fontsDir)}'` : ''}`);
  g.push(post.length ? `[${cur}]${post.join(',')}[vout]` : `[${cur}]null[vout]`);
  g.push(`[${a}]anull[aout]`);
  return { graph: g.join(';'), vOut: '[vout]' };
}

export async function renderProject(o: RenderOptions): Promise<RenderResult> {
  const { project, timeline: t, profile, soundtrack, intent } = o; const rdir = renderDir(project.id);
  const applied: string[] = [], skipped: string[] = [];
  const cachedShots = await renderShots(o);

  // ---- transcripts for speech shots (optional, honest about failure)
  const wordsByAsset = new Map<string, TimedWord[]>();
  const speechAssets = [...new Set(t.shots.filter((s) => s.kind === 'video').map((s) => s.assetId))].map((id) => project.assets.find((a) => a.id === id)!).filter((a) => a.hasAudio && (a.video?.speechFraction ?? 0) > 0.25);
  if (project.config.captions && speechAssets.length && o.transcribe) {
    for (let i = 0; i < speechAssets.length; i++) {
      o.stage('transcribe', { status: 'running', detail: `transcribing ${speechAssets[i].name} (${i + 1} of ${speechAssets.length}); on a CPU this can take a while`, progress: Math.round((i / speechAssets.length) * 100) });
      try { const tr = await o.transcribe(speechAssets[i]); if (tr) wordsByAsset.set(speechAssets[i].id, toTimedWords(tr.segments as never)); else skipped.push(`captions for ${speechAssets[i].name}: no speech found`); }
      catch (e) { skipped.push(`captions for ${speechAssets[i].name}: ${(e as Error).message.slice(0, 100)}`); }
    }
    o.stage('transcribe', { status: 'done', detail: `${wordsByAsset.size} of ${speechAssets.length} clips transcribed`, progress: 100 });
  } else o.stage('transcribe', { status: 'skipped', detail: !project.config.captions ? 'captions are off' : 'no spoken audio in the chosen shots' });
  const words = captionWords(t.shots, wordsByAsset); if (words.length) applied.push(`captions (${words.length} words)`);

  // ---- join: transitions + grade + text/captions + logo in ONE encode
  const { ass } = buildTextAss(o, words);
  if (t.text.headline) applied.push('opening headline'); if (t.text.cta) applied.push('closing call to action');
  const gradeName = profile.grade; const grade = gradeName !== 'none' ? GRADE_FILTERS[gradeName] : null; if (grade) applied.push(`${gradeName} colour grade`);
  const idn = project.config.identityId ? getIdentity(project.config.identityId) : null; const logoPath = idn?.logo ? logoFile(idn.id) : null;
  const fontsDirP = path.join(process.cwd(), 'storage', 'fonts'); const fontsDir = fs.existsSync(fontsDirP) ? fontsDirP : null;
  const shotFiles = t.shots.map((s) => path.join(rdir, 'shots', `${shotKey(s, project.assets.find((x) => x.id === s.assetId), t, profile)}.${sceneExt(s)}`));
  const joinKey = sha({ v: 2, shots: shotFiles.map((f) => path.basename(f)), tr: t.shots.map((s) => [s.start, s.len, s.transitionOut]), ass, grade, logo: logoPath && fs.statSync(logoPath).mtimeMs });
  const joined = path.join(rdir, `joined_${joinKey}.mp4`); const hadJoin = fs.existsSync(joined);
  if (hadJoin) o.stage('join', { status: 'done', detail: 'reused the previous assembly (only audio changed)', progress: 100 });
  else {
    o.stage('join', { status: 'running', detail: `assembling ${t.shots.length} shots with transitions`, progress: 0 });
    let assPath: string | null = null; if (ass) { assPath = path.join(rdir, `text_${joinKey}.ass`); fs.writeFileSync(assPath, ass, 'utf8'); }
    const inputs = shotFiles.flatMap((f) => ['-i', f]); if (logoPath) inputs.push('-loop', '1', '-i', logoPath);
    const hasA = t.shots.map((s) => s.kind === 'video');
    const { graph, vOut } = joinGraph(t, hasA, grade, assPath, fontsDir, logoPath ? { idx: t.shots.length, corner: idn!.brand.corner === 'none' ? 'tr' : idn!.brand.corner } : null);
    const tmp = joined + '.part.mp4';
    try {
      await ffmpegProgress(['-y', ...inputs, '-filter_complex', graph, '-map', vOut, '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(t.fps), '-c:a', 'aac', '-b:a', '256k', '-t', f3(t.total), '-movflags', '+faststart', tmp], t.total,
        (p) => o.stage('join', { status: 'running', detail: `encoding the assembled video`, progress: Math.round(p) }), o.signal);
      fs.renameSync(tmp, joined);
    } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
    if (assPath) try { fs.unlinkSync(assPath); } catch { /* ignore */ }
    o.stage('join', { status: 'done', detail: `${t.total.toFixed(1)} s assembled`, progress: 100 });
  }
  applied.push(`${t.shots.length} shots, ${t.shots.length - 1} transitions placed on the beat${t.bpm ? ` (${t.bpm.toFixed(0)} BPM)` : ''}`);

  // ---- audio: music (chosen/generated), transition SFX, ducking under speech, loudness, ending
  const wantMusic = soundtrack.source === 'library' || soundtrack.source === 'tray' || soundtrack.source === 'generated';
  const hasSpeech = speechAssets.length > 0;
  const spec: AudioDesignSpec = { mood: soundtrack.mood ?? 'none', intensity: soundtrack.intensity, music: wantMusic, musicVolume: Math.min(1, (hasSpeech ? 0.2 : 0.38) * (project.config.musicGain ?? 1)), soundEffects: project.config.audioMode !== 'original',
    ducking: true, ending: project.config.audioMode === 'original' ? 'none' : (t.text.cta || t.shots.some((s) => s.scene?.cta)) ? 'call_to_action' : profile.id === 'cinematic' || profile.id === 'documentary' ? 'clean_fade' : 'dramatic_resolution',
    seed: soundtrack.seed ?? 1, sfxCues: t.shots.filter((s) => s.transitionOut && s.cutAt > 1.5).map((s) => ({ t: Math.max(0, s.cutAt - (s.transitionOut!.type === 'cut' ? 0 : 0.18)), kind: s.transitionOut!.type === 'cut' ? 'click' as const : profile.transitionSfx })),
    grade: 'none', musicFile: soundtrack.file, cueGap: profile.id === 'social' ? 1.1 : 1.7 };
  const final = path.join(rdir, `final_${sha({ joinKey, spec, v: 3 })}.mp4`);
  if (fs.existsSync(final)) { o.stage('audio', { status: 'done', detail: 'reused the previous mix', progress: 100 }); return { file: final, seconds: t.total, applied: [...applied, `soundtrack: ${soundtrack.label}`], skipped, cached: { shots: cachedShots, join: hadJoin } }; }
  fs.copyFileSync(joined, final + '.work.mp4');
  if (hasAudioWork(spec)) {
    o.stage('audio', { status: 'running', detail: wantMusic ? `mixing "${soundtrack.label}", transition sounds and ducking` : 'adding transition sounds', progress: 30 });
    try {
      const r = await applyAudioDesign(final + '.work.mp4', spec, path.join(STUDIO_DIR, 'audio-cache'));
      applied.push(...r.applied.map((x) => `audio: ${x}`)); skipped.push(...r.skipped.filter((x) => x !== 'nothing to apply'));
      o.stage('audio', { status: 'done', detail: `${r.applied.length} audio steps in ${(r.ms / 1000).toFixed(1)} s`, progress: 100 });
    } catch (e) { skipped.push(`sound design failed (${(e as Error).message.slice(0, 120)}); kept the original audio`); o.stage('audio', { status: 'error', detail: (e as Error).message.slice(0, 160) }); }
  } else o.stage('audio', { status: 'skipped', detail: 'original audio kept as is' });
  fs.renameSync(final + '.work.mp4', final);
  void intent; void assetsDir; void AUTO_DIR;
  return { file: final, seconds: t.total, applied: [...applied, `soundtrack: ${soundtrack.label} (${soundtrack.reason})`], skipped, cached: { shots: cachedShots, join: hadJoin } };
}
