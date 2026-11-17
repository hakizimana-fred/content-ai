import assert from 'node:assert/strict';
import { applyApproval, checkSuggested, classifyScenes, pendingReview } from '../src/lib/auto/copy.ts';
import { buildCreativePlan, materialize, userSteps, validateModelPlan } from '../src/lib/auto/creative.ts';
import { ALL_DIRECTIONS, pickDirection } from '../src/lib/auto/directions.ts';
import { textViolations, safeArea } from '../src/lib/auto/qc.ts';
import { DEFAULT_CONFIG, type SceneSpec } from '../src/lib/auto/types.ts';

const P = 'Make a 30 second promo for a coffee shop called Bean There. Features: single origin, oat milk, free wifi. 40% faster service.';
// --- claim checker: creative copy passes, facts are refused unless the user supplied them
assert.ok(checkSuggested('Your morning deserves better.', P).ok);
assert.ok(!checkSuggested('Best coffee in Kampala', P).ok, 'superlative + place');
assert.ok(!checkSuggested('Only $4.99 today', P).ok, 'price');
assert.ok(!checkSuggested('50% off everything', P).ok, 'number not in prompt');
assert.ok(checkSuggested('Free wifi, always', P).ok, '"free" is in the prompt');
assert.ok(!checkSuggested('Freshly roasted in Paris', P).ok, 'ingredient/place claim');
assert.ok(!checkSuggested('Start your day with our', P).ok, 'truncated line');
assert.ok(!checkSuggested('No Text', P).ok, 'template label');
assert.ok(!checkSuggested('one two three four five six seven eight nine ten', P).ok, 'too long');
// --- provenance is decided by code, not by the model
const scenes: SceneSpec[] = [
  { id: 'intro', kind: 'intro', weight: 1, bg: 'aurora', title: 'Bean There', subtitle: 'Your morning deserves better.' },
  { id: 'text1', kind: 'text', weight: 1, bg: 'aurora', title: 'Award-winning espresso' },
  { id: 'product1', kind: 'product', weight: 1, bg: 'aurora', title: 'Bean There', bullets: ['single origin', 'oat milk', 'gluten free'] },
  { id: 'info1', kind: 'infographic', weight: 1, bg: 'aurora', stats: [{ label: 'faster service', value: 40, suffix: '%', max: 100 }, { label: 'happy customers', value: 9000 }] },
];
const c = classifyScenes(scenes, P);
const by = (f: string, sid: string) => c.copy.filter((x) => x.sceneId === sid && x.field === f);
assert.equal(by('title', 'intro')[0].source, 'user');
assert.equal(by('subtitle', 'intro')[0].status, 'needs_review');
assert.equal(c.scenes[1].title, undefined, 'claim removed');
assert.deepEqual(c.scenes[2].bullets, ['single origin', 'oat milk'], 'bullet not in prompt dropped');
assert.equal(c.scenes[3].stats?.length, 1, 'invented statistic dropped, user number kept');
assert.ok(c.rejected.length >= 3);
// --- approval: unapproved suggestions never reach the renderer; edits replace text
const pend = pendingReview(c.copy); assert.equal(pend.length, 1);
let r = applyApproval(c.scenes, c.copy, undefined); assert.equal(r.scenes[0].subtitle, undefined); assert.equal(r.used, 0);
r = applyApproval(c.scenes, c.copy, { approved: [pend[0].id] }); assert.equal(r.scenes[0].subtitle, 'Your morning deserves better.');
r = applyApproval(c.scenes, c.copy, { approved: [pend[0].id], edits: { [pend[0].id]: 'Mornings, sorted.' } }); assert.equal(r.scenes[0].subtitle, 'Mornings, sorted.');
// --- model output validation: garbage and hostile values are contained
assert.throws(() => validateModelPlan(null, { maxScenes: 4 }));
assert.throws(() => validateModelPlan({ direction: 'nope', scenes: [{ kind: 'text' }] }, { maxScenes: 4 }));
const v = validateModelPlan({ direction: 'tech_grid', concept: 'x'.repeat(999), mood: ['a', 3, null], ending: 'bogus', soundtrackMood: 'dubstep', sfx: ['whoosh', 'rm -rf'],
  scenes: [{ kind: 'text', title: '<script>alert(1)</script> Hello', weight: 99, composition: 'slam' }, { kind: 'text', title: '<script>alert(1)</script> Hello' }, { kind: 'showcase', title: 'Phone' }, { kind: 'evil' }, { kind: 'abstract' }, { kind: 'abstract' }, { kind: 'abstract' }] }, { maxScenes: 6 });
assert.equal(v.concept.length, 140); assert.equal(v.ending, 'title_card'); assert.equal(v.soundtrackMood, undefined); assert.deepEqual(v.sfx, ['whoosh']);
assert.ok(!/[<>]/.test(v.scenes[0].title!)); assert.equal(v.scenes[0].weight, 2.2); assert.equal(v.scenes.filter((s) => s.kind === 'showcase').length, 0, 'showcase needs an app/phone in the prompt');
assert.equal(v.scenes.filter((s) => s.kind === 'abstract').length, 2, 'abstract scenes capped'); assert.equal(v.scenes.filter((s) => s.kind === 'text').length, 1, 'duplicate text removed');
// --- directions are genuinely different
const looks = ALL_DIRECTIONS.map((d) => JSON.stringify([d.colors, d.font, d.bgs, d.motif, d.fx]));
assert.equal(new Set(looks).size, ALL_DIRECTIONS.length);
assert.equal(pickDirection('neon futuristic AI promo').id, 'tech_grid'); assert.equal(pickDirection('slow luxury perfume').id, 'editorial_luxe'); assert.equal(pickDirection('hello').id, 'modern_gradient');
assert.deepEqual(userSteps('Steps: sign up, connect your bank, track spending.'), ['sign up', 'connect your bank', 'track spending']);
// --- end-to-end plan (keyword path): provenance + approval gate + materialise
const cfg = { ...DEFAULT_CONFIG, prompt: P, mode: 'idea' as const };
const plan = await buildCreativePlan(P, cfg, { seconds: 30, beat: 0.5, mixed: false });
assert.equal(plan.source, 'keywords'); assert.equal(plan.originalPrompt, P);
assert.ok(plan.copy.every((x) => x.source !== 'user' || P.toLowerCase().includes(x.text.toLowerCase().split(':')[0].toLowerCase()) || /^\S/.test(x.text)));
const unapproved = materialize(plan, cfg);
const shown = unapproved.scenes.flatMap((s) => [s.title, s.subtitle, s.quote, s.cta, ...(s.bullets ?? []), ...(s.steps ?? [])]).filter(Boolean) as string[];
for (const t of shown) assert.ok(P.toLowerCase().includes(t.toLowerCase()), `unapproved render only shows user text, got "${t}"`);
const sug = pendingReview(plan.copy);
const approved = materialize(plan, { ...cfg, copyApproval: { planId: plan.id, approved: sug.map((x) => x.id) } });
assert.equal(approved.used, sug.length);
// a stale approval (other plan id) approves nothing
assert.equal(materialize(plan, { ...cfg, copyApproval: { planId: 'cp_other', approved: sug.map((x) => x.id) } }).used, 0);
// --- safe area
const w = 1080, h = 1920, a = safeArea(w, h);
assert.equal(textViolations({ boxes: [{ x: 100, y: 800, w: 800, h: 100, text: 'ok' }], fonts: [], peakRssMB: 1, frames: 1, w, h }, w, h).length, 0);
assert.equal(textViolations({ boxes: [{ x: 10, y: 800, w: 800, h: 100, text: 'edge' }, { x: 100, y: a.b, w: 400, h: 100, text: 'low' }], fonts: [], peakRssMB: 1, frames: 1, w, h }, w, h).length, 2);
console.log('auto creative tests passed');
