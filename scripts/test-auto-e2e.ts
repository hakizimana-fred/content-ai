import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoe2e-')); process.env.STUDIO_DATA_DIR = path.join(dir, 'studio'); process.env.AUTO_DATA_DIR = path.join(dir, 'auto'); fs.mkdirSync(process.env.STUDIO_DATA_DIR);
const keep = process.env.KEEP === '1';
const { createProject, addAsset, getProject, updateProject } = await import('../src/lib/auto/store.ts');
const { ingestFile } = await import('../src/lib/auto/media.ts');
const { startRender } = await import('../src/lib/auto/pipeline.ts');
const { probeMedia } = await import('../src/lib/studio/mix.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');

const PY = path.join(process.cwd(), '.venv/bin/python3');
const mkPhoto = (name: string, bg: [number, number, number], cx: number) => { const f = path.join(dir, name);
  const r = spawnSync(PY, ['-c', `import cv2,numpy as np
h,w=1200,1800; img=np.zeros((h,w,3),np.uint8); img[:]=${JSON.stringify(bg)}
for y in range(h): img[y,:]=np.clip(np.array(${JSON.stringify(bg)})+ (y/h)*60,0,255)
cv2.circle(img,(${cx},560),150,(30,30,230),-1); cv2.putText(img,'${name}',(60,1100),cv2.FONT_HERSHEY_SIMPLEX,3,(255,255,255),8)
pat=${cx % 3}
if pat==0:
    for x in range(0,w,90): cv2.line(img,(x,0),(x+300,h),(255,255,255),14)
elif pat==1:
    for y in range(0,h,100): cv2.rectangle(img,(0,y),(w,y+40),(20,20,20),-1)
else:
    for k in range(1,12): cv2.circle(img,(w//2,h//2),k*70,(255,230,200),10)
img=cv2.add(img,np.random.RandomState(3).randint(0,30,(h,w,3),np.uint8)); cv2.imwrite(r'${f}',img)`]); assert.equal(r.status, 0, String(r.stderr)); return f; };
const video = path.join(dir, 'clip.mp4');
assert.equal(spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=9', '-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*220*t)*(1+sin(2*PI*3*t))/2':s=44100:d=9", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]).status, 0);

const p = createProject('Acceptance', { prompt: 'Create an energetic, modern promotional video for a restaurant. Use cinematic transitions and an upbeat African-inspired soundtrack.', format: '9:16', durationSec: 15, audioMode: 'auto', captions: true, headline: 'Taste of Kampala', cta: 'Book your table today' });
for (const [n, f] of [['p1.jpg', mkPhoto('p1.jpg', [40, 90, 160], 1251)], ['p2.jpg', mkPhoto('p2.jpg', [60, 140, 90], 700)], ['p3.jpg', mkPhoto('p3.jpg', [150, 80, 60], 902)], ['clip.mp4', video]]) {
  const tmp = path.join(dir, 'up_' + n); fs.copyFileSync(f, tmp); addAsset(p.id, await ingestFile(p.id, tmp, n));
}
const t0 = Date.now(); const r = startRender(p.id); assert(r.ok, JSON.stringify(r));
assert.equal((startRender(p.id) as { ok: boolean }).ok, false, 'a second render of the same project is refused while one runs');
const seen = new Set<string>(); let last = '';
while (getProject(p.id)!.render.running) {
  const st = getProject(p.id)!.render.stages.filter((s) => s.status === 'running').map((s) => `${s.id}:${s.progress ?? ''}`).join(','); if (st && st !== last) { last = st; seen.add(st); }
  await new Promise((r) => setTimeout(r, 500));
}
const done = getProject(p.id)!; const ms = Date.now() - t0;
console.log(`finished in ${(ms / 1000).toFixed(1)}s`, done.render.error ?? '');
for (const s of done.render.stages) console.log(`  ${s.status.padEnd(8)} ${s.id.padEnd(11)} ${(s.ms ?? 0) + 'ms'.padEnd(2)} ${s.detail ?? ''}`);
assert(!done.render.error, `render error: ${done.render.error}`);
assert(done.render.stages.every((s) => s.status === 'done' || s.status === 'skipped'), 'every stage finished');
const tl = done.timeline!; console.log('timeline', tl.shots.map((s) => `${s.kind}${s.motion ? ':' + s.motion : ''}${s.layout === 'layered' ? '(layered)' : ''}/${s.len.toFixed(1)}s/${s.transitionOut?.type ?? 'end'}`).join('  '), 'bpm', tl.bpm);
const out = path.join(process.env.AUTO_DATA_DIR!, p.id, 'render', done.render.outputFile!); assert(fs.existsSync(out));
const m = await probeMedia(out); const dim = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim();
console.log('output', m.duration.toFixed(2), 's', dim, 'audio', m.hasAudio, 'planned', tl.total);
assert(Math.abs(m.duration - tl.total) < 0.25, 'output length matches the timeline'); assert(dim.startsWith('1080,1920,30'), 'TikTok 1080x1920 @30'); assert(m.hasAudio);
assert(Math.abs(tl.total - 15) <= 1, 'close to the requested 15 s');
assert(done.render.applied!.some((a) => /music|soundtrack/i.test(a)) && done.render.applied!.some((a) => /transitions placed on the beat/.test(a)), 'report lists what was applied');
// loudness sanity: not silent, not clipped
const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vol)![1]), maxv = Number(/max_volume: (-?[\d.]+)/.exec(vol)![1]);
console.log('audio mean', mean, 'max', maxv); assert(mean > -40 && maxv <= 0, 'audible, unclipped');
// frames for the human eye
const frames = path.join(dir, 'frames.png'); spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', out, '-vf', `select='eq(n,10)+eq(n,100)+eq(n,200)+eq(n,330)+eq(n,430)',scale=270:-1,tile=5x1`, '-frames:v', '1', frames]);
if (keep) { fs.copyFileSync(frames, '/tmp/claude-1000/-home-fred-Development-side-projects-content-ai/989875af-0eef-454b-a314-d07a3c18513e/scratchpad/auto/e2e_frames.png'); fs.copyFileSync(out, '/tmp/claude-1000/-home-fred-Development-side-projects-content-ai/989875af-0eef-454b-a314-d07a3c18513e/scratchpad/auto/e2e_out.mp4'); }
closeStudioDb(); fs.rmSync(dir, { recursive: true, force: true }); console.log('auto e2e passed');
