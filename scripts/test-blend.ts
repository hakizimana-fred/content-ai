// Soundtrack blending: the arrangement rules, and that variations are genuinely different rendered audio (measured, not assumed).
import assert from 'node:assert/strict';
import { blendStyles, variationPlan, STYLES, type StyleId } from '../src/lib/studio/blend.ts';
import { renderMusic } from '../src/lib/studio/sonic.ts';

const sel: StyleId[] = ['cinematic', 'corporate', 'luxury'];
const plan = variationPlan(4); assert.deepEqual(plan, ['dramatic', 'elegant', 'modern', 'minimal']);
const bl = plan.map((c, i) => blendStyles(sel, c, i));
assert.equal(new Set(bl.map((b) => JSON.stringify(b.recipe))).size, 4, 'four different recipes');
assert.equal(new Set(bl.map((b) => b.label)).size, 4);
assert(bl[0].recipe.build && bl[0].recipe.percLevel >= 0.9, 'dramatic is heavy'); assert(bl[1].recipe.arp === null && bl[1].recipe.piano, 'elegant has piano and no arp'); assert(bl[2].recipe.arp && bl[2].recipe.bass === 'pulse', 'modern has groove');
assert(bl[3].recipe.perc !== 'cinematic' && bl[3].recipe.bassLevel <= 0.3, 'minimal is sparse');
for (const b of bl) { assert(b.recipe.bpm >= 56 && b.recipe.bpm <= 132); assert(Object.keys(b.contributions).length === 3, 'every selected style is accounted for'); }
assert.equal(bl[0].leader, 'cinematic'); assert.equal(bl[1].leader, 'luxury'); assert.equal(bl[2].leader, 'corporate');

// incompatible ingredients become influences, with a stated reason; unrelated tempi are not forced together
const clash = blendStyles(['ambient', 'electronic'], 'elegant'); assert(clash.notes.some((n) => /influence/.test(n)), clash.notes.join('|'));
assert(Object.values(clash.contributions).some((c) => /reduced level/.test(c)));
const tempo = blendStyles(['luxury', 'electronic'], 'minimal'); assert(tempo.notes.some((n) => /BPM/.test(n)) || tempo.recipe.bpm <= 84);
for (const s of STYLES) for (const c of plan) { const r = blendStyles([s], c).recipe; assert(Number.isFinite(r.bpm) && r.pad.level > 0, `${s}/${c}`); }
assert.throws(() => blendStyles([], 'modern'));

// real audio: render 10 s of each variation and measure
const feat = (l: Float32Array, sr = 44100) => {
  let sum = 0, zc = 0, peak = 0, bad = 0; for (let i = 0; i < l.length; i++) { const v = l[i]; if (!Number.isFinite(v)) bad++; sum += v * v; peak = Math.max(peak, Math.abs(v)); if (i && (v >= 0) !== (l[i - 1] >= 0)) zc++; }
  const fr = Math.floor(sr * 0.02), env: number[] = []; for (let i = 0; i + fr < l.length; i += fr) { let e = 0; for (let k = 0; k < fr; k++) e += l[i + k] * l[i + k]; env.push(Math.sqrt(e / fr)); }
  const mean = env.reduce((a, b) => a + b, 0) / env.length; let onsets = 0; for (let i = 1; i < env.length; i++) if (env[i] > mean * 1.8 && env[i] > env[i - 1] * 1.5) onsets++;
  const q = (a: number, b: number) => { const s = env.slice(Math.floor(env.length * a), Math.floor(env.length * b)); return s.reduce((x, y) => x + y, 0) / Math.max(1, s.length); };
  return { rms: Math.sqrt(sum / l.length), zcr: zc / (l.length / sr), onsets: onsets / (l.length / sr), peak, bad, head: q(0, 0.02), body: q(0.4, 0.6), tail: q(0.97, 1) };
};
const SR = 44100, F: ReturnType<typeof feat>[] = [];
for (let i = 0; i < 4; i++) { const a = await renderMusic({ mood: bl[i].leader as never, intensity: 'medium', seconds: 10, seed: 11 + i * 7, overrides: bl[i].recipe }); assert.equal(a.l.length, Math.round(10 * SR)); F.push(feat(a.l)); }
for (const f of F) { assert.equal(f.bad, 0, 'no NaN'); assert(f.peak <= 1.0001 && f.peak > 0.2, 'normalised, not silent'); assert(f.tail < f.body * 0.6, 'the ending fades out'); assert(f.head < f.body, 'the start fades in'); }
const dist = (a: typeof F[0], b: typeof F[0]) => Math.abs(Math.log(a.zcr / b.zcr)) + Math.abs(a.onsets - b.onsets) / 4 + Math.abs(Math.log((a.rms + 1e-6) / (b.rms + 1e-6)));
let minD = 9; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) minD = Math.min(minD, dist(F[i], F[j]));
console.log('variation features', F.map((f) => `rms ${f.rms.toFixed(3)} zcr ${f.zcr.toFixed(0)} onsets/s ${f.onsets.toFixed(2)}`).join(' | '), 'min pairwise distance', minD.toFixed(2));
assert(minD > 0.12, 'every pair of variations is measurably different audio: ' + minD);
console.log('blend tests passed');
