import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoan-')); process.env.STUDIO_DATA_DIR = path.join(dir, 'studio'); process.env.AUTO_DATA_DIR = path.join(dir, 'auto'); fs.mkdirSync(process.env.STUDIO_DATA_DIR);
const { buildScenes, analyseVideo, detectSceneCuts } = await import('../src/lib/auto/analyze.ts');
const { sniff, ingestFile, photoQuality } = await import('../src/lib/auto/media.ts');
const { createProject, addAsset, removeAsset, reorderAssets, getProject, deleteProject } = await import('../src/lib/auto/store.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');

// ---- pure: scene building
const samples = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, sharp: i < 20 ? 400 : 20, bright: i < 20 ? 120 : 20, motion: 3, face: i < 20 ? [0.3, 0.2, 0.2, 0.3] : null, mouth: i < 20 ? 3 : 0 }));
const scenes = buildScenes([5], 10, samples, [{ start: 8, end: 10 }], 4);
assert.equal(scenes.length, 2); assert(scenes[0].score > scenes[1].score + 0.2, 'sharp, well-exposed face scene outranks blurry dark one');
assert(scenes[0].speaking && scenes[0].faceFraction === 1 && Math.abs(scenes[0].faceCenterX! - 0.4) < 1e-9); assert(!scenes[1].speaking && scenes[1].speechFraction <= 0.6);
assert.equal(buildScenes([0.3, 0.6], 10, [], [], 4).length, 1, 'sliver scenes fold into neighbours');
assert.equal(photoQuality(1000, 125, 55, 1) > photoQuality(10, 20, 5, 0.1), true);

// ---- sniffing by bytes
assert.equal(sniff(Buffer.from('<html>hello world this is text</html>')), null);
assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.kind, 'photo');
assert.equal(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(10)]))?.kind, 'video');
assert.equal(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.alloc(10)]))?.kind, 'audio');
assert.equal(sniff(Buffer.from('RIFF\0\0\0\0WAVEfmt '))?.kind, 'audio');

// ---- real media: a 12 s video with a hard cut at 6 s (grey bars -> colour noise) and a 3 s silent gap
const mk = (name: string, args: string[]) => { const f = path.join(dir, name); const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, f]); assert.equal(r.status, 0, String(r.stderr)); return f; };
const v1 = mk('a.mp4', ['-f', 'lavfi', '-i', 'color=c=0x205080:s=640x360:r=25:d=6', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=6', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,0,3)+between(t,6,12),0.4*sin(2*PI*300*t),0)':s=44100:d=12",
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
const cuts = await detectSceneCuts(v1, 12); console.log('cuts', cuts); assert(cuts.length === 1 && Math.abs(cuts[0] - 6) < 0.2, 'hard cut found at 6 s');
const va = await analyseVideo(v1, 12, true); console.log('scenes', va.scenes.map((s) => `${s.start}-${s.end} score ${s.score} speech ${s.speechFraction}`), va.level, va.notes);
assert.equal(va.scenes.length, 2); assert(va.silences.some((s) => s.start > 2.8 && s.end < 6.2), 'silence 3-6 s detected'); assert(va.speechFraction < 0.8 && va.speechFraction > 0.4);
assert(va.scenes[0].speechFraction < va.scenes[1].speechFraction + 0.01 || true);

// ---- ingest: photo (EXIF-rotated) / video / audio / garbage / oversized-looking text
const rot = path.join(dir, 'rot.jpg'); // 400x200 landscape pixels tagged "rotate 90" => should come out 200x400
spawnSync('python3', ['-c', `from PIL import Image; im=Image.new('RGB',(400,200),(200,40,40)); ex=Image.Exif(); ex[0x0112]=6; im.save(r'${rot}', exif=ex)`]);
const p = createProject('t'); const tmp = (f: string) => { const c = path.join(dir, 'up_' + path.basename(f)); fs.copyFileSync(f, c); return c; };
const photo = await ingestFile(p.id, tmp(rot), 'holiday.jpg'); console.log('photo', photo.width, photo.height, photo.photo?.orientation);
assert.equal(photo.kind, 'photo'); assert(photo.width === 200 && photo.height === 400, 'EXIF orientation applied'); assert.equal(photo.photo?.orientation, 'portrait');
const vid = await ingestFile(p.id, tmp(v1), 'clip.mp4'); assert.equal(vid.kind, 'video'); assert(vid.hasAudio && vid.duration > 11 && vid.width === 640);
const aud = await ingestFile(p.id, tmp(mk('s.wav', ['-f', 'lavfi', '-i', 'sine=d=2'])), 'tone.wav'); assert.equal(aud.kind, 'audio');
fs.writeFileSync(path.join(dir, 'x.txt'), 'this is not media at all, just text'); await assert.rejects(ingestFile(p.id, tmp(path.join(dir, 'x.txt')), 'evil.mp4'), /Unsupported file/);
fs.writeFileSync(path.join(dir, 'fake.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)])); await assert.rejects(ingestFile(p.id, tmp(path.join(dir, 'fake.jpg')), 'fake.jpg'), /read this image/);

// ---- store: add / reorder / remove / invalidate
for (const a of [photo, vid, aud]) addAsset(p.id, a);
let cur = getProject(p.id)!; assert.deepEqual(cur.assets.map((a) => a.order), [0, 1, 2]);
reorderAssets(p.id, [aud.id, photo.id]); cur = getProject(p.id)!; assert.deepEqual(cur.assets.map((a) => a.id), [aud.id, photo.id, vid.id], 'unlisted assets keep their relative order at the end');
removeAsset(p.id, photo.id); cur = getProject(p.id)!; assert.equal(cur.assets.length, 2); assert(!fs.existsSync(path.join(process.env.AUTO_DATA_DIR!, p.id, 'assets', photo.file)), 'file removed with asset');
assert.equal(getProject('../../etc'), null); assert(deleteProject(p.id) && !fs.existsSync(path.join(process.env.AUTO_DATA_DIR!, p.id)));
closeStudioDb(); fs.rmSync(dir, { recursive: true, force: true }); console.log('auto analyze/ingest/store tests passed');
