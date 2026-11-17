// End-to-end: real ffmpeg + libass + sound design on a temporary clip (never touches storage/). Slow-ish; run: npm run test:studio:e2e
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { composeAss } from '../src/lib/studio/overlay.ts';
import { applyAudioDesign } from '../src/lib/studio/mix.ts';
import { IDENTITY_TEMPLATES } from '../src/lib/studio/identity.ts';
import { applyRules } from '../src/lib/studio/rules.ts';
import { applyIdentityToPlan } from '../src/lib/studio/identity.ts';
import { productionFromPlan } from '../src/lib/studio/produce.ts';
import { probeMedia } from '../src/lib/studio/mix.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-')); const fq = (v: string) => v.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
const ff = (...a: string[]) => execFileSync('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', ...a]);
const src = path.join(dir, 'src.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15:duration=10', '-f', 'lavfi', '-i', 'sine=f=1000:r=48000:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src);

// plan from words -> identity -> production (the real pipeline, minus HTTP)
const r = applyRules('Make a 10 second TikTok with suspenseful music, sound effects and a memorable ending');
const africa = { ...IDENTITY_TEMPLATES.africa_unfiltered, id: 'i', createdAt: 0, updatedAt: 0 };
const plan = applyIdentityToPlan(r.plan, africa, r.explicit);
const prod = productionFromPlan(plan, { identity: africa, title: 'The big reveal', hasTranscript: true, seed: 5, sceneTimesInClip: [4] });
assert(prod.production.studio?.overlays?.title && prod.production.studio.audioDesign?.music);

// captions + overlays in one ASS, exactly as the cut route does it (caption ASS here has the same structure buildAss emits)
const caps = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H5A000000,-1,0,0,0,100,100,0,0,1,9,4,5,65,65,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:02.00,0:00:08.00,Cap,,0,0,0,,{\\an5\\pos(540,1500)}THIS IS THE PART WHERE EVERYTHING CHANGES
`;
const ass = composeAss(caps, prod.production.studio!.overlays!, 1080, 1920, 10);
const assPath = path.join(dir, 'c.ass'); fs.writeFileSync(assPath, ass);
const plainAss = path.join(dir, 'plain.ass'); fs.writeFileSync(plainAss, caps);

const render = (out: string, ap: string) => ff('-i', src, '-t', '10', '-vf', `crop=w='ih/1*9/16':h='ih/1':x='max(0,min(iw-ow,(0.5)*iw-ow/2))':y='(ih-oh)/2',scale=1080:1920:flags=lanczos,subtitles='${fq(ap)}'`, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out);
const withOv = path.join(dir, 'ov.mp4'), without = path.join(dir, 'plain.mp4');
render(withOv, assPath); render(without, plainAss);
const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', withOv], { encoding: 'utf-8' }).trim();
assert.equal(dims, '1080,1920');

// overlays really appear: frame differs from the caption-only render at title time and end-card time, and NOT in the middle
const frame = (f: string, t: number, o: string) => ff('-ss', String(t), '-i', f, '-frames:v', '1', o);
const psnr = (a: string, b: string) => { const o = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf-8' }); const m = /average:(\S+)/.exec(o.stderr); return m ? (m[1] === 'inf' ? 999 : Number(m[1])) : NaN; };
const cmp = (t: number) => { const a = path.join(dir, `a${t}.png`), b = path.join(dir, `b${t}.png`); frame(withOv, t, a); frame(without, t, b); return psnr(a, b); };
const title = cmp(1), mid = cmp(5), end = cmp(9.2);
console.log(`PSNR vs caption-only render: title(1s)=${title.toFixed(1)} dB  middle(5s)=${mid > 900 ? 'identical' : mid.toFixed(1)}  endcard(9.2s)=${end.toFixed(1)} dB`);
assert(title < 45, 'title card is visible at 1s');
assert(end < 45, 'end card is visible near the end');
assert(title < mid && end < mid, 'title and end-card frames differ more from the caption-only render than a mid-clip frame (which only has the small brand mark)');

// sound design on the rendered clip: music + sfx + ending + grade, then verify it is still a valid 10s clip with audio
const before = fs.statSync(withOv).size;
const res = await applyAudioDesign(withOv, prod.production.studio!.audioDesign!, path.join(dir, 'cache'));
console.log('applied:', res.applied.join(' | '), `| ${(res.ms / 1000).toFixed(1)}s`); if (res.skipped.length) console.log('skipped:', res.skipped.join(' | '));
const m = await probeMedia(withOv); assert(m.hasAudio && Math.abs(m.duration - 10) < 0.5, `valid output (${m.duration}s)`);
assert(res.applied.some((a) => /music bed \(suspense/.test(a)) && res.applied.some((a) => /ducking/.test(a)) && res.applied.some((a) => /colour grade/.test(a)));
assert(fs.statSync(withOv).size !== before, 'file was rewritten');
const dims2 = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', withOv], { encoding: 'utf-8' }).trim();
assert.equal(dims2, '1080,1920', 'grade pass keeps resolution');
fs.rmSync(dir, { recursive: true, force: true });
console.log('studio e2e passed');
