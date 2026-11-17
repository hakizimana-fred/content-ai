import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodeWav } from './dsp.ts';
import { MIN_STRUCTURED_SECONDS, renderMusic, renderSfx, renderSignature, type SfxKind } from './sonic.ts';
import { GRADE_FILTERS, hasAudioWork, type AudioDesignSpec } from './audio-spec.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(bin: string, args: string[], wantStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', bin, ...args]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`${bin} spawn failed: ${e.message}`)));
    p.on('close', (c) => (c === 0 ? resolve(wantStderr ? err : out) : reject(new Error(`${bin} exited ${c}: ${err.slice(-400)}`))));
  });
}

export async function probeMedia(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const j = JSON.parse(await run(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]));
  return { duration: Number(j.format?.duration) || 0, hasAudio: (j.streams ?? []).some((s: { codec_type?: string }) => s.codec_type === 'audio') };
}

const SFX_GAIN: Record<SfxKind, number> = { whoosh: 0.4, riser: 0.42, impact: 0.6, bass_impact: 0.55, click: 0.28, stinger: 0.45, notification: 0.4, electronic_accent: 0.35, ambient_texture: 0.25, transition: 0.4 };
const INTENSITY_GAIN = { low: 0.8, medium: 1, high: 1.2 } as const;

export interface PlacedSfx { t: number; kind: SfxKind | 'signature'; gain: number }

/** Where sound effects go, derived from the spec. Pure (no I/O) so it is unit-testable. */
export function planSfx(spec: AudioDesignSpec, duration: number): PlacedSfx[] {
  const out: PlacedSfx[] = [];
  if (spec.soundEffects && duration > 8) out.push({ t: 0, kind: 'whoosh', gain: SFX_GAIN.whoosh });
  let last = -10;
  for (const c of [...spec.sfxCues].sort((a, b) => a.t - b.t)) {
    if (c.t < 1.5 || c.t > duration - 3.5 || c.t - last < (spec.cueGap ?? 2.5) || !spec.soundEffects) continue; // never crowd the intro/outro or each other
    out.push({ t: c.t, kind: c.kind, gain: SFX_GAIN[c.kind] }); last = c.t;
  }
  const end = duration;
  switch (spec.ending) {
    case 'dramatic_resolution': if (end > 6) { out.push({ t: Math.max(0, end - 2.9), kind: 'riser', gain: SFX_GAIN.riser }, { t: Math.max(0, end - 0.3), kind: 'impact', gain: SFX_GAIN.impact }); } break;
    case 'logo_sting': out.push({ t: Math.max(0, end - 2.2), kind: 'signature', gain: 0.5 }); break;
    case 'call_to_action': out.push({ t: Math.max(0, end - 1.4), kind: 'notification', gain: SFX_GAIN.notification }); break;
    default: break;
  }
  return out;
}

export interface ApplyResult { applied: string[]; skipped: string[]; musicSeconds: number; ms: number }

/**
 * Post-pass on a rendered clip: designs the soundtrack (music bed, SFX, ducking, fades, loudness) and optionally
 * a colour grade. Video is stream-copied unless a grade is requested, so the common case is fast and light.
 * Replaces `videoPath` in place on success; on failure the original is left untouched.
 */
export async function applyAudioDesign(videoPath: string, spec: AudioDesignSpec, cacheDir: string): Promise<ApplyResult> {
  const t0 = Date.now(), applied: string[] = [], skipped: string[] = [];
  if (!hasAudioWork(spec)) return { applied, skipped: ['nothing to apply'], musicSeconds: 0, ms: 0 };
  fs.mkdirSync(cacheDir, { recursive: true });
  const { duration, hasAudio } = await probeMedia(videoPath);
  if (duration <= 0) throw new Error('Could not read clip duration.');
  const D = +duration.toFixed(3);

  const files: string[] = []; // extra inputs after the video
  const wav = (key: string, make: () => Promise<Buffer> | Buffer): Promise<string> => (async () => {
    const f = path.join(cacheDir, `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.wav`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await make());
    return f;
  })();

  let musicIdx = -1, musicSeconds = 0;
  if (spec.music && spec.musicFile) {
    if (!fs.existsSync(spec.musicFile)) throw new Error('The chosen music file is missing from disk.');
    files.push(spec.musicFile); musicIdx = files.length; musicSeconds = Math.ceil(D); applied.push('music: chosen track (looped/trimmed to fit)');
  } else if (spec.music && spec.mood !== 'none') {
    musicSeconds = Math.ceil(D) + 1;
    const mood = spec.mood;
    const structure = spec.musicStructure !== false && musicSeconds >= MIN_STRUCTURED_SECONDS;
    const f = await wav(`music|v2|${mood}|${spec.intensity}|${musicSeconds}|${spec.seed}|${structure}|${JSON.stringify(spec.overrides ?? {})}`, async () => encodeWav(await renderMusic({ mood, intensity: spec.intensity, seconds: musicSeconds, seed: spec.seed, overrides: spec.overrides, structure })));
    files.push(f); musicIdx = files.length; applied.push(`music bed (${mood}, ${spec.intensity})`);
  } else if (spec.music) skipped.push('music requested but mood is "none"');

  const placed = planSfx(spec, D); const sfxInputs: { idx: number; p: PlacedSfx }[] = [];
  for (const p of placed) {
    const f = p.kind === 'signature'
      ? await wav(`sig|${spec.signatureSeed ?? spec.seed}|${spec.mood}`, () => encodeWav(renderSignature(spec.signatureSeed ?? spec.seed, spec.mood)))
      
      : await wav(`sfx|${p.kind}|${spec.seed}`, () => encodeWav(renderSfx(p.kind as SfxKind, spec.seed)));
    files.push(f); sfxInputs.push({ idx: files.length, p });
  }
  if (sfxInputs.length) applied.push(`${sfxInputs.length} sound effect${sfxInputs.length > 1 ? 's' : ''}: ${[...new Set(sfxInputs.map((s) => s.p.kind))].join(', ')}`);

  const hasAudioOut = musicIdx > 0 || sfxInputs.length > 0;
  const g: string[] = []; const mixIn: string[] = [];
  if (hasAudioOut) {
    const fo = spec.ending === 'clean_fade' ? 2.2 : 1.2;
    const useDuck = musicIdx > 0 && spec.ducking && hasAudio;
    if (hasAudio) g.push(useDuck ? '[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[sp][sc]' : '[0:a]aresample=48000,aformat=channel_layouts=stereo[sp]');
    else { g.push(`anullsrc=r=48000:cl=stereo,atrim=0:${D}[sp]`); skipped.push('clip has no speech track; nothing to duck'); }
    mixIn.push('[sp]');
    if (musicIdx > 0) {
      const vol = Math.max(0, Math.min(1, spec.musicVolume)) * INTENSITY_GAIN[spec.intensity];
      g.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,${spec.musicFile ? 'aloop=loop=-1:size=2147483647,' : ''}atrim=0:${D},volume=${vol.toFixed(4)},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, D - fo).toFixed(2)}:d=${fo}[m0]`);
      if (useDuck) { g.push('[m0][sc]sidechaincompress=threshold=0.015:ratio=12:attack=12:release=450:makeup=1[m1]'); mixIn.push('[m1]'); applied.push('speech-aware ducking'); }
      else mixIn.push('[m0]');
    }
    for (const { idx, p } of sfxInputs) {
      const ms = Math.round(p.t * 1000);
      g.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${(p.gain * (spec.intensity === 'low' ? 0.8 : 1)).toFixed(3)}[s${idx}]`); mixIn.push(`[s${idx}]`);
    }
    g.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:duration=first:normalize=0:dropout_transition=0,atrim=0:${D}[mixed]`);
  }

  const vf = spec.grade !== 'none' ? GRADE_FILTERS[spec.grade] : null;
  if (vf) applied.push(`colour grade: ${spec.grade}`);
  if (!hasAudioOut && !vf) return { applied, skipped: [...skipped, 'nothing to apply'], musicSeconds, ms: Date.now() - t0 };

  let normFilter = '[mixed]alimiter=limit=0.89[aout]';
  if (hasAudioOut) {
    // Two-pass, LINEAR loudness normalisation: measure the finished mix, then apply one static gain. Single-pass loudnorm is
    // adaptive and would lift the quiet gaps (music only) toward the target, making music surge between sentences.
    try {
      const probe = await run(FFMPEG, ['-hide_banner', '-i', videoPath, ...files.flatMap((f) => ['-i', f]), '-filter_complex',
        `${g.join(';')};[mixed]loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json[o]`, '-map', '[o]', '-vn', '-f', 'null', '-'], true);
      const j = /\{[^{}]*"input_i"[^{}]*\}/.exec(probe);
      const m = j ? (JSON.parse(j[0]) as Record<string, string>) : null;
      if (m && Number.isFinite(Number(m.input_i))) {
        normFilter = `[mixed]loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_LRA=${m.input_lra}:measured_TP=${m.input_tp}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true[aout]`;
        applied.push(`loudness normalised to -16 LUFS (measured ${Number(m.input_i).toFixed(1)}, static gain)`);
      } else skipped.push('loudness measurement unavailable; applied a peak limiter only');
    } catch { skipped.push('loudness measurement failed; applied a peak limiter only'); }
    g.push(normFilter);
  }

  const tmp = videoPath.replace(/\.mp4$/i, '') + '.designed.mp4';
  const args = ['-v', 'error', '-i', videoPath, ...files.flatMap((f) => ['-i', f])];
  if (hasAudioOut) args.push('-filter_complex', g.join(';'), '-map', '0:v:0', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy');
  if (vf) args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
  else args.push('-c:v', 'copy');
  args.push('-t', String(D), '-movflags', '+faststart', '-y', tmp);
  try { await run(FFMPEG, args); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
  fs.renameSync(tmp, videoPath);
  return { applied, skipped, musicSeconds, ms: Date.now() - t0 };
}
