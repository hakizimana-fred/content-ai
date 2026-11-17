import assert from 'node:assert/strict';
import { renderMusic, renderSfx, renderSignature, parseSoundPrompt, RECIPES, SFX_KINDS, SOUND_CATEGORIES } from '../src/lib/studio/sonic.ts';
import { encodeWav, peak, rms, SR, type Stereo } from '../src/lib/studio/dsp.ts';
import { AUDIO_MOODS } from '../src/lib/studio/plan.ts';

const sane = (s: Stereo, label: string, minRms = 0.005) => {
  for (const ch of [s.l, s.r]) for (let i = 0; i < ch.length; i += 97) assert(Number.isFinite(ch[i]), `${label}: NaN/Inf at ${i}`);
  assert(peak(s.l) <= 1.0001 && peak(s.r) <= 1.0001, `${label}: clipping ${peak(s.l)}`);
  assert(rms(s.l) > minRms, `${label}: silent (rms ${rms(s.l)})`);
};

// every category in the sound library has a recipe, and every mood in the plan schema is covered
assert.deepEqual(SOUND_CATEGORIES.map((c) => c.id).sort(), AUDIO_MOODS.filter((m) => m !== 'none').sort());
assert.deepEqual(Object.keys(RECIPES).sort(), SOUND_CATEGORIES.map((c) => c.id).sort());

// all 16 moods render clean audio of the right length (short clips keep the laptop cool)
const t0 = Date.now();
for (const c of SOUND_CATEGORIES) {
  const s = await renderMusic({ mood: c.id as never, intensity: 'medium', seconds: 5, seed: 1 });
  assert.equal(s.l.length, 5 * SR, `${c.id} length`); sane(s, c.id);
}
console.log(`16 moods x 5s rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// determinism + variation
const a = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 4, seed: 3 });
const b = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 4, seed: 3 });
const c = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 4, seed: 4 });
assert.deepEqual(Buffer.from(a.l.buffer), Buffer.from(b.l.buffer), 'same seed -> identical');
assert.notDeepEqual(Buffer.from(a.l.buffer), Buffer.from(c.l.buffer), 'different seed -> different');
// intensity actually changes the sound
const lo = await renderMusic({ mood: 'electronic', intensity: 'low', seconds: 4, seed: 1 });
const hi = await renderMusic({ mood: 'electronic', intensity: 'high', seconds: 4, seed: 1 });
assert.notDeepEqual(Buffer.from(lo.l.buffer), Buffer.from(hi.l.buffer));
// moods are audibly distinct (not the same signal)
const sus = await renderMusic({ mood: 'suspense', intensity: 'medium', seconds: 4, seed: 1 });
const com = await renderMusic({ mood: 'comedy', intensity: 'medium', seconds: 4, seed: 1 });
let diff = 0; for (let i = 0; i < sus.l.length; i += 50) diff += Math.abs(sus.l[i] - com.l[i]); assert(diff > 10, 'suspense and comedy differ');

// SFX
for (const k of SFX_KINDS) { const s = renderSfx(k, 1); sane(s, k, 0.002); assert.deepEqual(Buffer.from(renderSfx(k, 1).l.buffer), Buffer.from(s.l.buffer), `${k} deterministic`); }
const sig1 = renderSignature(5, 'cinematic'), sig2 = renderSignature(5, 'cinematic'), sig3 = renderSignature(6, 'cinematic');
sane(sig1, 'signature'); assert.deepEqual(Buffer.from(sig1.l.buffer), Buffer.from(sig2.l.buffer)); assert.notDeepEqual(Buffer.from(sig1.l.buffer), Buffer.from(sig3.l.buffer));

// WAV container
const wav = encodeWav(sig1);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
assert.equal(wav.readUInt32LE(24), SR); assert.equal(wav.readUInt16LE(22), 2); assert.equal(wav.length, 44 + sig1.l.length * 4);

// natural-language sound requests (spec examples)
const p1 = parseSoundPrompt('Create a premium corporate advertising soundtrack with deep bass, subtle electronic textures, elegant piano and a gradual build-up.');
assert.equal(p1.mood, 'luxury'); // "premium"/"elegant" is matched before "corporate"; documented precedence
assert(p1.overrides.piano && p1.overrides.bass === 'sub' && p1.overrides.build && p1.overrides.arp);
assert.equal(p1.intensity, 'low');
const p2 = parseSoundPrompt('Generate a suspenseful documentary background with atmospheric percussion and a dark cinematic feeling.');
assert.equal(p2.mood, 'suspense'); assert.equal(p2.overrides.perc, 'cinematic');
const p3 = parseSoundPrompt('Create a modern African electronic instrumental with contemporary percussion and sophisticated electronic production.');
assert.equal(p3.mood, 'african_fusion'); assert.equal(p3.overrides.perc, 'afro');
assert.equal(parseSoundPrompt('something 90 bpm').overrides.bpm, 90);
assert(parseSoundPrompt('xyz').matched[0].includes('default'));

console.log('sonic tests passed');
