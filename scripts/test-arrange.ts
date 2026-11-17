// Duration-aware composition: the engine must write a complete piece for the requested length (never loop a short track),
// with opening, development, build, climax and a resolving ending. Structure is verified on the plan (pure), audio on real renders.
import assert from 'node:assert/strict';
import { SR } from '../src/lib/studio/dsp.ts';
import { RECIPES, planMusic, describePlan, renderMusic, MIN_STRUCTURED_SECONDS, type Mood } from '../src/lib/studio/sonic.ts';
import { barSignature, type SectionKind } from '../src/lib/studio/arrange.ts';
import { blendStyles, STYLES, type StyleId } from '../src/lib/studio/blend.ts';

type M = Exclude<Mood, 'none'>;
const kinds = (mood: M, seconds: number, seed = 5, extra: object = {}) => planMusic({ mood, intensity: 'medium', seconds, seed, ...extra });
const seq = (p: ReturnType<typeof kinds>) => p.plan.sections.map((s) => s.kind);

// ---------- 1. every duration gets a complete form that exactly fills the requested length
for (const mood of ['cinematic', 'inspirational', 'electronic', 'luxury', 'african_fusion', 'corporate'] as M[]) {
  for (const secs of [12, 15, 30, 37, 45, 60, 90, 120]) {
    const { plan } = kinds(mood, secs);
    assert.equal(plan.sections[0].kind, 'intro', `${mood} ${secs}s opens with an intro`);
    assert.equal(plan.sections[plan.sections.length - 1].kind, 'resolution', `${mood} ${secs}s ends with a resolution`);
    let at = 0; for (const s of plan.sections) { assert.equal(s.start, at, 'sections are contiguous'); assert(s.bars >= 1); at += s.bars; }
    assert.equal(at, plan.bars, 'sections cover every bar');
    assert(Math.abs(plan.bars * plan.bar + plan.tail - secs) < 1e-6, `${mood} ${secs}s: whole bars plus a ring-out tail equal the duration`);
    assert(plan.tail >= 0.6 && plan.tail < plan.bar + 1.5, `${mood} ${secs}s: tail ${plan.tail.toFixed(2)}s is a natural ring-out`);
  }
}
// longer duration => more musical material, not the same material longer
const k30 = seq(kinds('inspirational', 30)), k60 = seq(kinds('inspirational', 60)), k90 = seq(kinds('inspirational', 90));
for (const k of [k30, k60, k90]) { assert(k.includes('build') && k.includes('climax'), `build and climax present: ${k}`); }
assert(!k30.includes('variation') || k30.length < k60.length, '30 s is a shorter form than 60 s');
assert(k60.includes('breakdown'), '60 s has a breakdown'); assert(k90.filter((k) => k === 'variation').length >= 2 && k90.includes('breakdown'), '90 s has breakdown and two variation sections');
assert(k90.length > k60.length && k60.length > seq(kinds('inspirational', 15)).length, 'the form grows with the duration');
// moods that should not build (luxury, minimal) get a gentle arc instead of a forced climax
assert(!seq(kinds('luxury', 60)).includes('climax') && !seq(kinds('minimal', 60)).includes('climax'), 'gentle moods do not force a climax');
// below the threshold the engine keeps stings (no arc)
assert.equal(MIN_STRUCTURED_SECONDS, 12);

// ---------- 2. harmony: a real cadence, a half cadence before the climax, different progressions per section
for (const mood of ['cinematic', 'corporate', 'african_fusion', 'minimal'] as M[]) {
  const { plan, traits } = kinds(mood, 60), dom = traits.scaleLen >= 7 ? 4 : Math.min(3, traits.scaleLen - 1), pb = plan.perBar;
  assert.equal(pb[pb.length - 1].chord, 0, `${mood}: lands on the tonic`);
  assert.equal(pb[pb.length - 2].chord, dom, `${mood}: dominant before the final tonic (authentic cadence)`);
  assert.equal(pb[pb.length - 1].cadence, 'final');
  for (const s of plan.sections) if (s.kind === 'build' && s.bars >= 2) assert.equal(pb[s.start + s.bars - 1].chord, dom, `${mood}: build ends on the dominant`);
}
{
  const { plan } = kinds('inspirational', 90), chordsOf = (k: SectionKind, i = 0) => { const s = plan.sections.filter((x) => x.kind === k)[i]; return plan.perBar.slice(s.start, s.start + 4).map((b) => b.chord).join(''); };
  assert.notEqual(chordsOf('development', 0), chordsOf('variation', 0), 'the variation section changes the harmony');
  assert.notEqual(chordsOf('development', 0), chordsOf('build', 0), 'the build has its own progression');
  const brk = plan.sections.find((s) => s.kind === 'breakdown')!; const pcs = plan.perBar.slice(brk.start, brk.start + brk.bars).map((b) => b.chord);
  assert(pcs[0] === pcs[1], 'breakdown moves at half the harmonic rhythm (a chord lasts two bars)');
  assert(plan.perBar.some((b) => b.keyShift !== 0) && plan.perBar[plan.bars - 1].keyShift === plan.perBar.find((b) => b.keyShift !== 0)!.keyShift, 'a major-key long piece lifts the key for the final climax and ends there');
}

// ---------- 3. energy: opening < development < climax, a rising build, a falling resolution; layers enter progressively
for (const mood of ['cinematic', 'electronic', 'corporate'] as M[]) {
  const { plan } = kinds(mood, 60), avg = (k: SectionKind) => { const s = plan.sections.filter((x) => x.kind === k); const bs = s.flatMap((x) => plan.perBar.slice(x.start, x.start + x.bars)); return bs.reduce((a, b) => a + b.energy, 0) / bs.length; };
  assert(avg('intro') < avg('development') && avg('development') < avg('climax'), `${mood}: energy grows opening -> development -> climax`);
  assert(avg('breakdown') < avg('development'), `${mood}: the breakdown pulls back`);
  const build = plan.sections.find((s) => s.kind === 'build')!, bb = plan.perBar.slice(build.start, build.start + build.bars);
  assert(bb[bb.length - 1].energy > bb[0].energy, `${mood}: the build rises`);
  const res = plan.sections.find((s) => s.kind === 'resolution')!, rb = plan.perBar.slice(res.start, res.start + res.bars);
  assert(rb[rb.length - 1].energy < avg('climax') * 0.6, `${mood}: the ending settles well below the climax`);
  assert(plan.perBar[0].layers.perc === 0 && plan.perBar[0].layers.arp === 0, `${mood}: the opening has no drums or arpeggio`);
  assert(plan.perBar.some((b) => b.section === 'development' && b.layers.perc > 0), `${mood}: drums enter in the development`);
  assert(plan.perBar.filter((b) => b.section === 'breakdown').every((b) => b.layers.perc === 0), `${mood}: no drums in the breakdown`);
  assert(plan.perBar.some((b) => b.riser) && plan.perBar.some((b) => b.impact) && plan.perBar.some((b) => b.fill) && plan.perBar.some((b) => b.gap), `${mood}: riser, impact, fill and pre-drop gap are all scheduled`);
}

// ---------- 4. melody: evolves, is not looped, and resolves
for (const [mood, secs] of [['cinematic', 60], ['inspirational', 90], ['electronic', 45]] as [M, number][]) {
  const { plan, melody, traits } = kinds(mood, secs), sigs = melody.map(barSignature).filter(Boolean);
  const unique = new Set(sigs).size;
  assert(unique / sigs.length >= 0.6, `${mood} ${secs}s: ${unique}/${sigs.length} distinct melodic bars (not a loop)`);
  let run = 1, maxRun = 1; for (let i = 1; i < melody.length; i++) { run = melody[i].length && barSignature(melody[i]) === barSignature(melody[i - 1]) ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  assert(maxRun <= 1, `${mood}: the same bar is never repeated back to back`);
  // no 2-bar unit occurs more than twice (a deliberate hook restatement is allowed, a loop is not)
  const units = new Map<string, number>(); for (let i = 0; i + 1 < melody.length; i += 2) { const k = barSignature(melody[i]) + '/' + barSignature(melody[i + 1]); if (k.length > 2) units.set(k, (units.get(k) ?? 0) + 1); }
  assert(Math.max(0, ...units.values()) <= 2, `${mood}: no melodic phrase is repeated more than twice`);
  const last = melody[plan.bars - 1]; assert.equal(last.length, 1, 'one final note'); assert.equal(last[0].deg, traits.scaleLen, 'the last melody note is the tonic'); assert(last[0].d >= 16, 'held to the end');
  assert(melody.some((b, i) => b.length && plan.perBar[i].section === 'climax'), 'the climax carries the melody');
  assert(plan.perBar.every((b, i) => b.layers.lead > 0 || melody[i].length === 0), 'the melody only plays where the arrangement allows it');
  // melody notes on strong beats are chord tones (harmonic compatibility)
  const L = traits.scaleLen;
  for (const [i, bar] of melody.entries()) { if (i >= plan.bars - 2) continue; for (const e of bar) if (e.s % 8 === 0) { const rel = (((e.deg - plan.perBar[i].chord) % L) + L) % L; assert([0, 2, 4].includes(rel), `${mood} bar ${i}: strong-beat note is a chord tone (rel ${rel})`); } }
}
// different seeds are different compositions (melody, phrase lengths, key)
{
  const a = kinds('cinematic', 60, 1), b = kinds('cinematic', 60, 2);
  assert.notDeepEqual(a.melody.map(barSignature), b.melody.map(barSignature), 'different seed -> different melody');
  assert.deepEqual(kinds('cinematic', 60, 1).melody.map(barSignature), a.melody.map(barSignature), 'same seed -> same composition');
}

// ---------- 5. intro / outro padding keeps the beat grid and adds atmosphere
{
  const base = kinds('corporate', 45), padded = kinds('corporate', 45, 5, { introPadSec: 6, outroPadSec: 6 }), bar = padded.plan.bar;
  assert.equal(padded.plan.bar, base.plan.bar, 'padding does not change the tempo or bar length');
  const n = padded.plan.perBar.filter((b) => b.padOnly).length; assert(n >= 1 && n <= Math.floor(padded.plan.bars * 0.15), `lead-in is at least a bar and at most 15% of the piece (${n} of ${padded.plan.bars} bars)`);
  assert(!padded.plan.perBar[n].padOnly, 'the music starts right after the lead-in');
  for (let i = 0; i < n; i++) { const b = padded.plan.perBar[i]; assert(b.padOnly && b.layers.perc === 0 && b.layers.bass === 0 && b.layers.lead === 0, 'lead-in bars are atmosphere only'); }
  const rb = (p: typeof base) => p.plan.sections.find((s) => s.kind === 'resolution')!.bars;
  assert(rb(padded) > rb(base), 'outro padding lengthens the resolution'); assert.equal(padded.plan.perBar[padded.plan.bars - 1].cadence, 'final', 'still ends on a final cadence');
  assert(describePlan(padded.plan).length >= 5 && /^Intro 0:00/.test(describePlan(padded.plan)[0]), 'the arrangement is describable for the UI');
}

// ---------- 6. blends carry form, shared harmony and feel into the composer
{
  const bl = (s: StyleId[], c: 'dramatic' | 'elegant' | 'modern' | 'minimal') => blendStyles(s, c);
  for (const c of ['dramatic', 'elegant', 'modern', 'minimal'] as const) assert.equal(bl(['cinematic', 'luxury'], c).recipe.form, c, `${c} blend sets the form`);
  assert(bl(['cinematic', 'luxury'], 'elegant').recipe.altProg || bl(['corporate', 'inspirational'], 'modern').recipe.altProg, 'a compatible style lends its progression to the variation section');
  assert(bl(['cinematic', 'electronic', 'corporate'], 'dramatic').notes.length >= 1, 'blend explains its decisions');
  const forms = new Set(['dramatic', 'elegant', 'modern', 'minimal'].map((c) => { const r = bl(['cinematic', 'luxury', 'electronic'], c as never).recipe, p = planMusic({ mood: 'cinematic', intensity: 'medium', seconds: 60, seed: 3, overrides: r }); return p.plan.sections.map((s) => `${s.kind}${s.bars}`).join(','); }));
  assert(forms.size >= 3, `the four characters shape the piece differently (${forms.size} distinct forms)`);
  void STYLES;
}

// ---------- 7. real audio: exact length, a natural beginning and ending, dynamics that follow the form, deterministic
const feat = (a: { l: Float32Array }) => {
  const l = a.l; let bad = 0, peak = 0; for (const x of l) { if (!Number.isFinite(x)) bad++; peak = Math.max(peak, Math.abs(x)); }
  const rms = (s: number, e: number) => { let t = 0, n = 0; for (let i = Math.floor(s * SR); i < Math.min(l.length, Math.floor(e * SR)); i++) { t += l[i] * l[i]; n++; } return Math.sqrt(t / Math.max(1, n)); };
  return { bad, peak, rms };
};
const t0 = Date.now();
for (const [mood, secs] of [['cinematic', 15], ['corporate', 30], ['electronic', 45], ['inspirational', 60], ['african_fusion', 37]] as [M, number][]) {
  const o = { mood, intensity: 'medium' as const, seconds: secs, seed: 7 }, a = await renderMusic(o), f = feat(a), { plan } = planMusic(o);
  assert.equal(a.l.length, Math.round(secs * SR), `${mood} ${secs}s: exact length`); assert.equal(a.r.length, a.l.length);
  assert.equal(f.bad, 0, 'no NaN'); assert(f.peak <= 1.0001 && f.peak > 0.3, `${mood}: normalised and audible (${f.peak.toFixed(2)})`);
  const body = f.rms(secs * 0.3, secs * 0.7);
  assert(f.rms(0, 0.05) < body * 0.3, `${mood} ${secs}s: starts from near-silence (a natural beginning)`);
  assert(f.rms(secs - 0.2, secs) < body * 0.1, `${mood} ${secs}s: ends decayed to silence (${(f.rms(secs - 0.2, secs) / body).toFixed(3)} of body)`);
  assert(f.rms(secs - 2, secs - 1) > f.rms(secs - 1, secs), `${mood} ${secs}s: the last seconds decay smoothly rather than stop`);
  const ph = (k: SectionKind) => { const s = plan.sections.find((x) => x.kind === k); return s ? f.rms(s.start * plan.bar, (s.start + s.bars) * plan.bar) : 0; };
  if (secs >= 30 && ph('climax')) assert(ph('climax') > ph('intro') * 1.4, `${mood} ${secs}s: the climax (${ph('climax').toFixed(3)}) is clearly louder than the opening (${ph('intro').toFixed(3)})`);
  if (ph('climax') && ph('resolution')) assert(ph('resolution') < ph('climax'), `${mood} ${secs}s: the resolution settles below the climax`);
  if (ph('breakdown') && ph('development')) assert(ph('breakdown') < ph('climax'), `${mood}: breakdown is lighter than the climax`);
  console.log(`  ${mood.padEnd(15)} ${String(secs).padStart(3)}s  ${describePlan(plan).map((x) => x.split(' ')[0] + x.match(/\(.*\)/)![0]).join(' > ')}`);
}
console.log(`structured renders (15/30/37/45/60 s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
{
  const a = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 20, seed: 3 }), b = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 20, seed: 3 }), c = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 20, seed: 4 });
  assert.deepEqual(Buffer.from(a.l.buffer), Buffer.from(b.l.buffer), 'same seed -> identical audio'); assert.notDeepEqual(Buffer.from(a.l.buffer), Buffer.from(c.l.buffer), 'different seed -> different audio');
  const sting = await renderMusic({ mood: 'cinematic', intensity: 'medium', seconds: 8, seed: 3 }); assert.equal(sting.l.length, 8 * SR, 'short stings are still exact');
  const padA = await renderMusic({ mood: 'corporate', intensity: 'medium', seconds: 30, seed: 2, introPadSec: 6 }), fp = feat(padA), pp = planMusic({ mood: 'corporate', intensity: 'medium', seconds: 30, seed: 2, introPadSec: 6 }).plan;
  assert.equal(padA.l.length, 30 * SR); const padEnd = pp.perBar.findIndex((b) => !b.padOnly) * pp.bar;
  assert(padEnd >= pp.bar, 'there is a lead-in'); assert(fp.rms(padEnd * 0.2, padEnd * 0.9) < fp.rms(15, 20), 'the lead-in is gentler than the body of the piece');
}
// 8. recipes exist for every mood the composer can lead with (nothing falls back silently)
for (const m of Object.keys(RECIPES) as M[]) { const { plan } = kinds(m, 30); assert(plan.bars >= 3 && plan.perBar.length === plan.bars, `${m} plans`); }
console.log('arrangement tests passed');
