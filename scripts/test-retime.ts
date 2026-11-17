import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { detectSilences, retimeSegment, planRetime } from '../src/lib/studio/retime.ts';
import { probeMedia } from '../src/lib/studio/mix.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retime-')); const src = path.join(dir, 'src.mp4');
// 12s: 0-1 silence | 1-4 tone | 4-6.5 silence | 6.5-10 tone | 10-12 silence ; video is a counter-style testsrc
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=12', '-f', 'lavfi', '-i',
  "aevalsrc='if(between(t,1,4)+between(t,6.5,10),0.5*sin(2*PI*440*t),0)':s=44100:d=12", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
assert.equal(r.status, 0, String(r.stderr));
const sil = await detectSilences(src, 0, 12);
console.log('detected', sil.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(' '));
assert.equal(sil.length, 3, 'three silences found'); assert(Math.abs(sil[1].start - 4) < 0.15 && Math.abs(sil[1].end - 6.5) < 0.15);

const { map } = await planRetime(src, 0, 12, { removeSilence: true, speed: 1 });
const out = path.join(dir, 'out.mp4'); const t0 = Date.now();
await retimeSegment(src, out, 0, 12, map);
const m = await probeMedia(out);
console.log(`planned ${map.outDuration.toFixed(2)}s, actual ${m.duration.toFixed(2)}s (${Date.now() - t0} ms)`);
assert(Math.abs(m.duration - map.outDuration) < 0.25, 'output length matches the time map'); assert(m.hasAudio);
assert(m.duration < 12 - 4, 'at least 4s of dead air removed');

const sp = await planRetime(src, 2, 10, { removeSilence: false, speed: 1.25 }); const out2 = path.join(dir, 'fast.mp4');
await retimeSegment(src, out2, 2, 10, sp.map); const m2 = await probeMedia(out2);
assert(Math.abs(m2.duration - 8 / 1.25) < 0.25, `speed 1.25: ${m2.duration}`);

// video-only input (no audio track) must not crash
const vo = path.join(dir, 'vo.mp4'); spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-an', '-c:v', 'copy', vo]);
const p3 = await planRetime(vo, 0, 12, { removeSilence: false, speed: 1.1 }); await retimeSegment(vo, path.join(dir, 'vo2.mp4'), 0, 12, p3.map);
assert(!(await probeMedia(path.join(dir, 'vo2.mp4'))).hasAudio);
fs.rmSync(dir, { recursive: true, force: true });
console.log('retime tests passed');
