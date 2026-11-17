import { spawn } from 'node:child_process';
import { parseSilences, planKeep, buildTimeMap, type TimeMap, type Silence } from './pacing.ts';
import { probeMedia } from './mix.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    p.stderr.on('data', (d) => { err += d; if (err.length > 400_000) err = err.slice(-200_000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${c}: ${err.slice(-400)}`)); });
  });
}

/** Silences inside [start, end) of the source, as CLIP-relative times. Audio only, so it is cheap. */
export async function detectSilences(input: string, start: number, end: number, noiseDb = -32, minSec = 0.5): Promise<Silence[]> {
  const dur = end - start;
  const err = await run(['-nostdin', '-hide_banner', '-ss', String(start), '-t', String(dur), '-i', input, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-'], 120_000);
  return parseSilences(err, dur);
}

/** Re-encode [start, end) keeping only the map's segments, optionally sped up. Quality is high because the real encode follows. */
export async function retimeSegment(input: string, output: string, start: number, end: number, map: TimeMap): Promise<{ hasAudio: boolean }> {
  const { hasAudio } = await probeMedia(input);
  const n = map.segs.length, parts: string[] = [];
  map.segs.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.src0.toFixed(3)}:end=${s.src1.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[0:a]atrim=start=${s.src0.toFixed(3)}:end=${s.src1.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const ins = map.segs.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('');
  const sp = map.speed !== 1;
  parts.push(`${ins}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? '[ca]' : ''}`);
  if (sp) { parts.push(`[cv]setpts=PTS/${map.speed}[v]`); if (hasAudio) parts.push(`[ca]atempo=${map.speed}[a]`); }
  const vOut = sp ? '[v]' : '[cv]', aOut = sp ? '[a]' : '[ca]';
  await run(['-nostdin', '-y', '-hide_banner', '-ss', String(start), '-t', String(end - start), '-i', input,
    '-filter_complex', parts.join(';'), '-map', vOut, ...(hasAudio ? ['-map', aOut] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []), output], 15 * 60_000);
  return { hasAudio };
}

export async function planRetime(input: string, start: number, end: number, opts: { removeSilence: boolean; speed: number }) {
  const dur = end - start;
  const silences = opts.removeSilence ? await detectSilences(input, start, end) : [];
  const map = buildTimeMap(opts.removeSilence ? planKeep(silences, dur) : [[0, dur]], opts.speed, dur);
  return { map, silences };
}
