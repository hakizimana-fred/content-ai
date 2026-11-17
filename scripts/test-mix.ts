import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyAudioDesign, planSfx, probeMedia } from '../src/lib/studio/mix.ts';
import type { AudioDesignSpec } from '../src/lib/studio/audio-spec.ts';

const base: AudioDesignSpec = { mood: 'cinematic', intensity: 'medium', music: true, musicVolume: 0.15, soundEffects: true, ducking: true, ending: 'dramatic_resolution', seed: 1, sfxCues: [], grade: 'none' };

// ---- pure placement logic ----
const p = planSfx(base, 30);
assert.equal(p[0].kind, 'whoosh'); assert.equal(p[0].t, 0);
assert.deepEqual(p.slice(-2).map((x) => x.kind), ['riser', 'impact']);
assert(p.at(-1)!.t > 29 && p.at(-1)!.t < 30, 'impact lands just before the end');
assert.equal(planSfx({ ...base, soundEffects: false, ending: 'none' }, 30).length, 0, 'no SFX when disabled');
assert.equal(planSfx({ ...base, soundEffects: true, ending: 'none' }, 5).length, 0, 'short clips get no intro whoosh');
const cues = planSfx({ ...base, ending: 'none', sfxCues: [{ t: 0.5, kind: 'click' }, { t: 5, kind: 'transition' }, { t: 6, kind: 'click' }, { t: 12, kind: 'whoosh' }, { t: 29, kind: 'click' }] }, 30);
assert.deepEqual(cues.map((c) => c.t), [0, 5, 12], 'cues too close to start/end or to each other are dropped');
assert.equal(planSfx({ ...base, ending: 'call_to_action' }, 30).at(-1)!.kind, 'notification');
assert.equal(planSfx({ ...base, ending: 'logo_sting' }, 30).at(-1)!.kind, 'signature');

// ---- real ffmpeg round trip ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtest-')), cache = path.join(dir, 'cache');
const clip = path.join(dir, 'clip.mp4');
// 12s test clip: "speech" (1 kHz + 1.5 kHz tones, far above the 60-200 Hz band used to observe the music) at 0-4s and 8-12s, silence 4-8s, small 320x180 to stay light
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=12', '-f', 'lavfi', '-i', 'sine=f=1000:r=48000:duration=12',
  '-f', 'lavfi', '-i', 'sine=f=1500:r=48000:duration=12', '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0,volume=\'if(between(t,4,8),0,0.5)\':eval=frame[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', clip]);
const meanVol = (f: string, ss: number, t: number, band = false): number => {
  const o = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', f, '-af', (band ? 'highpass=f=60,lowpass=f=200,' : '') + 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf-8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(o.stderr); return m ? Number(m[1]) : -91;
};

const before = await probeMedia(clip); assert(before.hasAudio && Math.abs(before.duration - 12) < 0.3);

const mk = async (name: string, spec: AudioDesignSpec) => { const f = path.join(dir, name + '.mp4'); fs.copyFileSync(clip, f); const r = await applyAudioDesign(f, spec, cache); return { f, r }; };
const duck = await mk('duck', { ...base, ending: 'none', soundEffects: false, ducking: true });
const flat = await mk('flat', { ...base, ending: 'none', soundEffects: false, ducking: false });
for (const x of [duck, flat]) { const m = await probeMedia(x.f); assert(m.hasAudio); assert(Math.abs(m.duration - 12) < 0.4, `duration kept (${m.duration})`); }
assert(duck.r.applied.some((a) => /ducking/.test(a)) && !flat.r.applied.some((a) => /ducking/.test(a)));
// video stream must be copied, not re-encoded
const vcodec = (f: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf-8' }).trim();
assert.equal(vcodec(duck.f), 'h264');
// the gap has music only; it must be audible in both
const gapDuck = meanVol(duck.f, 5, 2), gapFlat = meanVol(flat.f, 5, 2);
assert(gapDuck > -60 && gapFlat > -60, `music audible in speech gap (${gapDuck}, ${gapFlat})`);
// Observe the music alone in the 60-200 Hz band (speech tones are at 1-1.5 kHz). Ducking must pull it down under speech and
// let it return in the gap; without ducking it must stay put.
const dropDuck = meanVol(duck.f, 0.8, 2.5, true) - meanVol(duck.f, 5, 2, true);
const dropFlat = meanVol(flat.f, 0.8, 2.5, true) - meanVol(flat.f, 5, 2, true);
console.log(`music level under speech vs gap (60-200 Hz): ducked ${dropDuck.toFixed(1)} dB, flat ${dropFlat.toFixed(1)} dB`);
assert(dropDuck < -6, `ducking should cut the music by >6 dB under speech (got ${dropDuck.toFixed(1)})`);
assert(Math.abs(dropFlat) < 3, `without ducking the music level must not change (got ${dropFlat.toFixed(1)})`);

// sfx + ending + grade in one pass; unchanged clip when nothing requested
const full = await mk('full', { ...base, ending: 'logo_sting', grade: 'cinematic', sfxCues: [{ t: 6, kind: 'transition' }] });
assert(full.r.applied.some((a) => /colour grade/.test(a)) && full.r.applied.some((a) => /sound effect/.test(a)));
const m = await probeMedia(full.f); assert(Math.abs(m.duration - 12) < 0.4);
const none = await mk('none', { ...base, music: false, soundEffects: false, ending: 'none' });
assert.deepEqual(none.r.applied, []); assert.equal(fs.statSync(none.f).size, fs.statSync(clip).size, 'untouched when nothing to do');
// silent clip: music still added, ducking reported as skipped
const silent = path.join(dir, 'silent.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=6', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', silent]);
const rs = await applyAudioDesign(silent, { ...base, ending: 'none', soundEffects: false }, cache);
assert((await probeMedia(silent)).hasAudio); assert(rs.skipped.some((s) => /no speech/.test(s)));
// bad input leaves the original alone
const bad = path.join(dir, 'bad.mp4'); fs.writeFileSync(bad, 'not a video');
await assert.rejects(applyAudioDesign(bad, base, cache)); assert.equal(fs.readFileSync(bad, 'utf-8'), 'not a video');
fs.rmSync(dir, { recursive: true, force: true });
console.log('mix tests passed');
