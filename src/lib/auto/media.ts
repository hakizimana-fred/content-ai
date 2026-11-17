import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assetsDir, newAssetId } from './store.ts';
import type { AssetKind, AutoAsset, PhotoAnalysis } from './types.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg', FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
export const PY = () => path.join(process.cwd(), '.venv', 'bin', 'python3');
export const SCRIPT = (n: string) => path.join(process.cwd(), 'src', 'lib', 'auto', n);
export const MAX_BYTES: Record<AssetKind, number> = { photo: 40 * 1024 * 1024, video: 1024 * 1024 * 1024, audio: 150 * 1024 * 1024 };
export const MAX_ASSETS = 40;

export function run(bin: string, args: string[], opts: { input?: string; timeoutMs?: number; nice?: boolean } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = opts.nice ? spawn('nice', ['-n', '10', bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(bin)} timed out`)); }, opts.timeoutMs ?? 120_000);
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; if (err.length > 300_000) err = err.slice(-150_000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(`${path.basename(bin)} exited ${c}: ${err.slice(-300)}`)); });
    p.stdin.on('error', () => { /* child closed early */ }); p.stdin.end(opts.input ?? '');
  });
}
export const venvReady = () => fs.existsSync(PY());

/** Decide the type from the file's own bytes. Never trust the filename or the browser's content-type. */
export function sniff(head: Buffer): { kind: AssetKind; ext: string } | null {
  const h = head;
  if (h.length > 4 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: 'photo', ext: 'jpg' };
  if (h.length > 8 && h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'photo', ext: 'png' };
  if (h.length > 12 && h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') return { kind: 'photo', ext: 'webp' };
  if (h.length > 12 && h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WAVE') return { kind: 'audio', ext: 'wav' };
  if (h.length > 12 && h.toString('ascii', 4, 8) === 'ftyp') return { kind: /^(M4A |M4B )/.test(h.toString('ascii', 8, 12)) ? 'audio' : 'video', ext: /^qt/.test(h.toString('ascii', 8, 12)) ? 'mov' : /^(M4A |M4B )/.test(h.toString('ascii', 8, 12)) ? 'm4a' : 'mp4' };
  if (h.length > 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: 'video', ext: 'webm' };
  if (h.length > 3 && (h.toString('ascii', 0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0))) return { kind: 'audio', ext: 'mp3' };
  if (h.length > 4 && (h.toString('ascii', 0, 4) === 'OggS' || h.toString('ascii', 0, 4) === 'fLaC')) return { kind: 'audio', ext: h.toString('ascii', 0, 4) === 'OggS' ? 'ogg' : 'flac' };
  return null;
}

export interface Probe { width: number; height: number; duration: number; hasAudio: boolean; hasVideo: boolean }
export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout); const v = (j.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video');
  let w = Number(v?.width) || 0, h = Number(v?.height) || 0;
  const rot = Number((v?.side_data_list ?? []).find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w]; // phone videos are often stored sideways with a rotation flag
  return { width: w, height: h, duration: Number(j.format?.duration) || 0, hasAudio: (j.streams ?? []).some((s: { codec_type?: string }) => s.codec_type === 'audio'), hasVideo: !!v };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function photoQuality(sharp: number, bright: number, contrast: number, thirds: number): number {
  const sh = clamp01((Math.log10(Math.max(1, sharp)) - 1.2) / 2.2);       // ~16 (blurry) .. ~1600 (crisp)
  const ex = clamp01(1 - Math.abs(bright - 125) / 125) * 0.7 + clamp01(contrast / 55) * 0.3;
  return +(sh * 0.5 + ex * 0.35 + thirds * 0.15).toFixed(3);
}

/** Validate + store one uploaded file (already written to `tmpPath`). Photos are analysed immediately (fast); video/audio analysis runs in the Analyse stage. */
export async function ingestFile(projectId: string, tmpPath: string, originalName: string): Promise<AutoAsset> {
  const fd = fs.openSync(tmpPath, 'r'); const head = Buffer.alloc(32); fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd);
  const kind = sniff(head); const size = fs.statSync(tmpPath).size;
  if (!kind) throw Object.assign(new Error('Unsupported file. Use MP4, MOV, WebM, JPEG, PNG, WebP, MP3, WAV, M4A, OGG or FLAC.'), { status: 415 });
  if (size > MAX_BYTES[kind.kind]) throw Object.assign(new Error(`${kind.kind} files must be under ${Math.round(MAX_BYTES[kind.kind] / 1048576)} MB.`), { status: 413 });
  const id = newAssetId(), dir = assetsDir(projectId), name = path.basename(originalName).slice(0, 120);
  const base: AutoAsset = { id, kind: kind.kind, name, file: '', thumb: null, bytes: size, width: 0, height: 0, duration: 0, hasAudio: false, order: 0 };

  if (kind.kind === 'photo') {
    if (!venvReady()) throw Object.assign(new Error('Photo analysis needs OpenCV: python3 -m venv .venv && .venv/bin/pip install opencv-python-headless numpy'), { status: 501 });
    const out = path.join(dir, `${id}.jpg`), thumb = path.join(dir, `${id}_t.jpg`);
    const { stdout } = await run(PY(), [SCRIPT('auto_analyze.py'), 'image', '--input', tmpPath, '--out', out], { timeoutMs: 60_000 }).catch((e) => { throw Object.assign(new Error(`Could not read this image: ${(e as Error).message.slice(0, 120)}`), { status: 422 }); });
    const a = JSON.parse(stdout);
    await run(FFMPEG, ['-v', 'error', '-y', '-i', out, '-vf', 'scale=360:-2', '-frames:v', '1', thumb]);
    const photo: PhotoAnalysis = { sharpness: a.sharpness, brightness: a.brightness, contrast: a.contrast, color: a.color, hash: a.hash, faces: a.faces, subject: a.subject, thirds: a.thirds,
      quality: photoQuality(a.sharpness, a.brightness, a.contrast, a.thirds), orientation: Math.abs(a.width / a.height - 1) < 0.08 ? 'square' : a.width > a.height ? 'landscape' : 'portrait' };
    return { ...base, file: `${id}.jpg`, thumb: `${id}_t.jpg`, width: a.width, height: a.height, bytes: fs.statSync(out).size, photo };
  }

  const file = `${id}.${kind.ext}`, dest = path.join(dir, file);
  fs.renameSync(tmpPath, dest);
  try {
    const p = await probe(dest);
    if (kind.kind === 'video') {
      if (!p.hasVideo || p.duration <= 0.2) throw Object.assign(new Error('This is not a playable video.'), { status: 422 });
      const thumb = path.join(dir, `${id}_t.jpg`);
      await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(Math.min(1, p.duration / 3)), '-i', dest, '-vf', 'scale=360:-2', '-frames:v', '1', thumb]).catch(() => null);
      return { ...base, file, thumb: fs.existsSync(thumb) ? `${id}_t.jpg` : null, width: p.width, height: p.height, duration: p.duration, hasAudio: p.hasAudio };
    }
    if (!p.hasAudio || p.duration <= 0.5) throw Object.assign(new Error('This is not a playable audio file.'), { status: 422 });
    return { ...base, file, duration: p.duration, hasAudio: true };
  } catch (e) { try { fs.unlinkSync(dest); } catch { /* gone */ } throw e; }
}
