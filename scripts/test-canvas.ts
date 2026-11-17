import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { cutVideoSegment, probeVideo } from '../src/lib/ffmpeg.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-')); const src = path.join(dir, 'src.mp4');
assert.equal(spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]).status, 0);
const sizes: [string, { w: number; h: number } | undefined, 'portrait_blur' | 'portrait_crop'][] = [
  ['default 9:16 crop', undefined, 'portrait_crop'], ['default 9:16 blur', undefined, 'portrait_blur'],
  ['1:1 crop', { w: 1080, h: 1080 }, 'portrait_crop'], ['1:1 blur', { w: 1080, h: 1080 }, 'portrait_blur'],
  ['4:5 crop', { w: 1080, h: 1350 }, 'portrait_crop'], ['4:5 blur', { w: 1080, h: 1350 }, 'portrait_blur'],
];
for (const [name, canvas, aspectRatio] of sizes) {
  const out = path.join(dir, `${name.replace(/\W/g, '_')}.mp4`);
  await cutVideoSegment({ inputPath: src, outputPath: out, startTime: 0, endTime: 2, aspectRatio, canvas, crop: aspectRatio === 'portrait_crop' ? { zoom: 1, centerExpr: '0.5' } : undefined });
  const m = await probeVideo(out); const w = canvas?.w ?? 1080, h = canvas?.h ?? 1920;
  assert.equal(`${m.width}x${m.height}`, `${w}x${h}`, name); console.log('ok', name, `${m.width}x${m.height}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('canvas tests passed');
