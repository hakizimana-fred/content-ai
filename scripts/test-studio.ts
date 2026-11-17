import assert from 'node:assert/strict';
import { detectHardware, buildProfile, classify, gpuVendor } from '../src/lib/studio/hardware.ts';
import { validatePlan, diffPlan, DEFAULT_PLAN } from '../src/lib/studio/plan.ts';
import { MODEL_CATALOG, ResourceManager, checkFit, type ModelRuntime } from '../src/lib/studio/models.ts';

// --- hardware ---
const lowRaw = { cpu: { model: 'x', cores: 4, avx2: true, avx512: false }, ramMB: { total: 19000, available: 10000 }, gpu: { name: 'Intel', vendor: 'intel' as const, vramMB: null, cuda: false }, diskFreeMB: 19000 };
assert.equal(classify(lowRaw).tier, 'low');
assert.equal(classify({ ...lowRaw, cpu: { ...lowRaw.cpu, cores: 12 }, ramMB: { total: 32000, available: 20000 } }).tier, 'standard');
assert.equal(classify({ ...lowRaw, cpu: { ...lowRaw.cpu, cores: 16 }, ramMB: { total: 32000, available: 20000 }, gpu: { name: 'RTX', vendor: 'nvidia', vramMB: 12000, cuda: true } }).tier, 'high');
const lowP = buildProfile(lowRaw);
assert.equal(lowP.modelRamBudgetMB, Math.min(Math.floor(19000 * 0.35), 10000 - 3072));
assert.equal(lowP.inferenceThreads, 3);
assert.equal(buildProfile({ ...lowRaw, ramMB: { total: 8000, available: 2000 } }).modelRamBudgetMB, 0, 'never negative');
const real = detectHardware(0);
assert(real.cpu.cores >= 1 && real.ramMB.total > 0);
console.log('detected:', real.tier, `${real.cpu.cores} threads`, `${real.ramMB.total}MB RAM`, `budget ${real.modelRamBudgetMB}MB`, real.reasons.join('; '));

// --- plan validation ---
const spec = {
  format: 'vertical_9_16', duration_target: 45, style: 'cinematic_storytelling', framing: 'speaker_tracking',
  captions: { preset: 'bold_dynamic', position: 'center', highlight_keywords: true },
  audio: { mood: 'cinematic', intensity: 'medium', music: true, sound_effects: true, ducking: true },
  ending: { style: 'dramatic_resolution' },
};
const ok = validatePlan(spec);
assert(ok.ok); if (ok.ok) { assert.equal(ok.plan.pacing.speed, 1); assert.equal(ok.plan.ending.style, 'dramatic_resolution'); }
for (const [bad, re] of [
  [{ ...spec, format: 'vertical' }, /format/],
  [{ ...spec, duration_target: 9999 }, /duration_target/],
  [{ ...spec, duration_target: '45' }, /duration_target/],
  [{ ...spec, captions: { preset: 'neon' } }, /captions\.preset/],
  [{ ...spec, audio: { music: true, mood: 'none' } }, /mood is "none"/],
  [{ ...spec, audio: { ...spec.audio, ducking: false, music_volume: 0.6 } }, /requires ducking/],
  [{ ...spec, captions: 'big' }, /captions: must be an object/],
  [[], /JSON object/], [null, /JSON object/], ['str', /JSON object/],
] as [unknown, RegExp][]) {
  const r = validatePlan(bad);
  assert(!r.ok && r.errors.some((e) => re.test(e)), `expected error ${re} for ${JSON.stringify(bad)}`);
}
const unk = validatePlan({ ...spec, rm: '-rf' });
assert(unk.ok && unk.warnings.some((w) => /unknown field "rm"/.test(w)));
// partial refinement merges onto the base plan and only reports changed sections
const base = ok.ok ? ok.plan : DEFAULT_PLAN;
const refined = validatePlan({ audio: { music_volume: 0.08 } }, base);
assert(refined.ok); if (refined.ok) { assert.deepEqual(diffPlan(base, refined.plan), ['audio']); assert.equal(refined.plan.audio.mood, 'cinematic'); }

// --- catalog / fit ---
const by = (id: string) => MODEL_CATALOG.find((m) => m.id === id)!;
assert(checkFit(by('qwen2.5-1.5b-instruct-q4km'), { ...lowP, modelRamBudgetMB: 3000 }).ok);
assert(!checkFit(by('qwen2.5-1.5b-instruct-q4km'), { ...lowP, modelRamBudgetMB: 1000 }).ok);
assert(!checkFit(by('qwen2.5-3b-instruct-q4km'), { ...lowP, modelRamBudgetMB: 9000 }).ok, 'tier gate');
assert(!checkFit(by('qwen2.5-3b-instruct-q4km'), { ...lowP, tier: 'standard', modelRamBudgetMB: 9000 }, { requireCommercial: true }).ok, 'commercial gate');
assert(MODEL_CATALOG.every((m) => m.licenseVerified), 'every catalog licence has been checked against its model card');
assert.deepEqual(MODEL_CATALOG.filter((m) => m.commercialOk).map((m) => m.id), ['qwen2.5-0.5b-instruct-q4km', 'qwen2.5-1.5b-instruct-q4km'], 'only Apache-2.0 models are commercial-OK');
assert(MODEL_CATALOG.filter((m) => m.sourceUrl).every((m) => /^[0-9a-f]{64}$/.test(m.sha256 ?? '')), 'every downloadable model has a SHA-256');

// --- resource manager: one model at a time, serialised ---
const events: string[] = [];
const rt: ModelRuntime = { async load(s) { events.push('load ' + s.id); await new Promise((r) => setTimeout(r, 10)); }, async unload(s) { events.push('unload ' + s.id); } };
const mgr = new ResourceManager(rt, () => ({ ...lowP, tier: 'standard', modelRamBudgetMB: 4000 }), { idleUnloadMs: 30 });
const a = by('qwen2.5-0.5b-instruct-q4km'), b = by('qwen2.5-1.5b-instruct-q4km');
let concurrent = 0, maxConcurrent = 0;
const job = (m: typeof a, n: string) => mgr.run(m, n, async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await new Promise((r) => setTimeout(r, 15)); events.push('ran ' + n); concurrent--; return n; });
const res = await Promise.all([job(a, 'j1'), job(a, 'j2'), job(b, 'j3')]);
assert.deepEqual(res, ['j1', 'j2', 'j3']);
assert.equal(maxConcurrent, 1);
assert.deepEqual(events, ['load ' + a.id, 'ran j1', 'ran j2', 'unload ' + a.id, 'load ' + b.id, 'ran j3']);
await new Promise((r) => setTimeout(r, 80));
assert.equal(mgr.status().loaded, null, 'idle unload');
assert.equal(events.at(-1), 'unload ' + b.id);
await assert.rejects(new ResourceManager(rt, () => ({ ...lowP, modelRamBudgetMB: 100 })).run(b, 'x', async () => 1), /budget/);
await assert.rejects(new ResourceManager({ ...rt, load: async () => { throw new Error('boom'); } }, () => ({ ...lowP, modelRamBudgetMB: 4000 })).run(a, 'x', async () => 1), /boom/);

console.log('studio tests passed');

// ================= Creative Director (rules + hybrid) =================
const { applyRules } = await import('../src/lib/studio/rules.ts');
const { direct, PLAN_JSON_SCHEMA } = await import('../src/lib/studio/director.ts');

// The benchmark prompt the 1.5B model got wrong on its own
const bench = applyRules('Turn this conversation into a 45-second TikTok. Make it feel like a premium documentary with suspenseful music and bold captions.');
assert.equal(bench.plan.format, 'vertical_9_16');
assert.equal(bench.plan.duration_target, 45);
assert.equal(bench.plan.style, 'documentary');
assert.equal(bench.plan.audio.mood, 'suspense');
assert.equal(bench.plan.audio.music, true);
assert.equal(bench.plan.captions.preset, 'bold_dynamic');
assert(bench.plan.audio.ducking, 'ducking forced on with music');

const spec1 = applyRules('Make this video feel like a premium documentary.');
assert.equal(spec1.plan.style, 'documentary');
assert.equal(applyRules('a premium advertising spot').plan.style, 'premium_advertising');
assert.equal(applyRules('make it feel premium').plan.style, 'premium_advertising');
const doc = applyRules('Give it a documentary feel');
assert.equal(doc.plan.style, 'documentary');

const r = (s: string, b = DEFAULT_PLAN) => applyRules(s, b).plan;
assert.equal(r('Create a 2 minute YouTube video').duration_target, 120);
assert.equal(r('Create a 2 minute YouTube video').format, 'landscape_16_9');
assert.equal(r('make it 500 seconds').duration_target, DEFAULT_PLAN.duration_target, 'out-of-range duration ignored');
assert.equal(r('cinematic look with sound effects').audio.music, false, 'mood word without a music word must not enable music');
assert.equal(r('cinematic look with sound effects').audio.sound_effects, true);
assert.equal(r('a premium corporate advertising soundtrack').audio.mood, 'corporate');
assert.equal(r('no music please').audio.music, false);
assert.equal(r('use a modern African electronic instrumental').audio.mood, 'african_fusion');
assert.equal(r('subtitles in the center').captions.position, 'center');
assert.equal(r('put captions at the top').captions.position, 'top');
assert.equal(r('Make the subtitles larger').captions.scale, 1.25);
assert.equal(r('highlight important statements').captions.highlight_keywords, true);
assert.equal(r('remove unnecessary pauses').pacing.remove_silence, true);
assert.equal(r('create a more energetic version').pacing.speed, 1.1);
assert.equal(r('focus on the second speaker').framing, 'speaker_tracking');
assert.equal(r('finish with a memorable ending').ending.style, 'dramatic_resolution');
// relative refinements build on the current plan
const withMusic = r('suspenseful music');
const quieter = r('Reduce the background music', withMusic);
assert(quieter.audio.music_volume < withMusic.audio.music_volume && quieter.audio.music);
assert.equal(quieter.audio.mood, 'suspense', 'refinement keeps unrelated fields');
assert.equal(r('make it louder music', withMusic).audio.ducking, true);
assert.equal(applyRules('hello there').explicit.length, 0, 'no cues -> nothing guessed');

// schema is well formed
assert.deepEqual(PLAN_JSON_SCHEMA.properties.format.enum, [...(await import('../src/lib/studio/plan.ts')).FORMATS]);

// --- hybrid behaviour with a fake model ---
const wrong = JSON.stringify({ format: 'landscape_16_9', duration_target: 45, style: 'premium_advertising', framing: 'center',
  captions: { preset: 'cinematic', position: 'bottom', highlight_keywords: true },
  audio: { mood: 'cinematic', intensity: 'high', music: true, sound_effects: true, ducking: true }, ending: 'dramatic_resolution' });
let calls = 0;
const fake = (out: string) => async () => { calls++; return out; };
const h1 = await direct('Turn this into a 45-second TikTok with suspenseful music and bold captions', { llm: fake(wrong) });
assert.equal(h1.source, 'hybrid');
assert.equal(h1.plan.format, 'vertical_9_16', 'explicit TikTok beats model landscape');
assert.equal(h1.plan.audio.mood, 'suspense', 'explicit mood beats model');
assert.equal(h1.plan.captions.preset, 'bold_dynamic');
assert.equal(h1.plan.ending.style, 'dramatic_resolution', 'string ending repaired');
assert.equal(h1.plan.audio.intensity, 'high', 'model fills what the user did not state');

// invalid model field is dropped alone, rest of model output is kept
const partial = JSON.stringify({ ...JSON.parse(wrong), framing: 'zoomy', ending: { style: 'clean_fade' } });
const h2 = await direct('a TikTok', { llm: fake(partial) });
assert.equal(h2.source, 'hybrid'); assert.equal(h2.plan.framing, DEFAULT_PLAN.framing);
assert.equal(h2.plan.ending.style, 'clean_fade'); assert(h2.warnings.some((w) => /framing/.test(w)));

// garbage / throwing model -> rules fallback, never an exception
const h3 = await direct('a 30 second TikTok', { llm: fake('not json {{') });
assert.equal(h3.source, 'rules'); assert.equal(h3.plan.duration_target, 30);
const h4 = await direct('a 30 second TikTok', { llm: async () => { throw new Error('connection refused'); } });
assert.equal(h4.source, 'rules'); assert(h4.warnings.some((w) => /unavailable/.test(w)));
const h5 = await direct('a 30 second TikTok'); // no model at all
assert.equal(h5.source, 'rules'); assert.equal(h5.llmMs, null);
await assert.rejects(direct('   '), /empty/);

// refinements: rules hit -> model NOT called; no rule hit -> model called
calls = 0;
const cur = h5.plan;
const ref1 = await direct('Make the subtitles larger and remove the pauses', { base: cur, llm: fake(wrong) });
assert.equal(calls, 0, 'explicit refinement needs no model');
assert.deepEqual(ref1.changedSections.sort(), ['captions', 'pacing']);
const ref2 = await direct('make it feel more like a thriller trailer', { base: cur, llm: fake(wrong) });
assert.equal(calls, 1, 'vague refinement asks the model');
assert(ref2.changedSections.length > 0);
console.log('director tests passed');

// regression: adjectives must sit next to the music word
const sfx = applyRules('add a premium advertising-style soundtrack, introduce subtle sound effects');
assert.equal(sfx.plan.audio.music_volume, DEFAULT_PLAN.audio.music_volume, '"subtle sound effects" must not lower the music');
assert.equal(applyRules('make the music more subtle').plan.audio.music_volume < DEFAULT_PLAN.audio.music_volume, true);
assert.equal(applyRules('Generate a suspenseful documentary background with atmospheric percussion').plan.audio.mood, 'suspense');
assert.equal(applyRules('blur the background').plan.audio.music, false);
const noop = await direct('hello there', { base: DEFAULT_PLAN });
assert(noop.warnings.some((w) => /no changes/.test(w)));
console.log('regression tests passed');

assert.equal(gpuVendor('00:02.0 VGA compatible controller: Intel Corporation Skylake GT2 [HD Graphics 520]'), 'intel');
assert.equal(gpuVendor('01:00.0 VGA compatible controller: NVIDIA Corporation GA106 [GeForce RTX 3060]'), 'nvidia');
assert.equal(gpuVendor('03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 23'), 'amd');
console.log('gpu vendor tests passed');

// ---- pruned schema: the model is only asked for what the rules did not decide ----
const { buildPlanSchema } = await import('../src/lib/studio/director.ts');
const full = buildPlanSchema([])!; assert.equal(full.required.length, 7);
const pr = applyRules('Turn this into a 45-second TikTok with suspenseful music and bold captions');
const sch = buildPlanSchema(pr.explicit)!;
assert(!('format' in sch.properties) && !('duration_target' in sch.properties), 'decided scalars are not requested');
assert(!('mood' in (sch.properties.audio as { properties: object }).properties) && !('preset' in (sch.properties.captions as { properties: object }).properties), 'decided sub-fields are not requested');
assert('framing' in sch.properties && 'position' in (sch.properties.captions as { properties: object }).properties, 'undecided fields remain');
assert.equal(buildPlanSchema(['format', 'duration_target', 'style', 'framing', 'captions.preset', 'captions.position', 'captions.highlight_keywords', 'audio.mood', 'audio.intensity', 'audio.music', 'audio.sound_effects', 'audio.ducking', 'ending.style']), null);
let seenSchema: unknown = null; calls = 0;
await direct('Turn this into a 45-second TikTok with suspenseful music and bold captions', { llm: async (rq) => { calls++; seenSchema = rq.schema; return JSON.stringify({ framing: 'wide', captions: { position: 'top', highlight_keywords: false }, audio: { intensity: 'high', sound_effects: true, ducking: true }, ending: { style: 'clean_fade' } }); } });
assert.equal(calls, 1); assert(!('format' in (seenSchema as { properties: object }).properties));
const allSaid = 'a 30 second TikTok, documentary, speaker tracking, minimal captions at the bottom, highlight keywords, suspenseful music, intense, no sound effects, fade out ending';
const allExplicit = applyRules(allSaid).explicit; calls = 0;
const skipped = await direct(allSaid, { llm: async () => { calls++; return '{}'; } });
console.log('left for the model when almost everything is stated:', JSON.stringify(buildPlanSchema(allExplicit)?.required ?? 'nothing'));
assert(calls === 0 || buildPlanSchema(allExplicit) !== null, 'no model call when nothing is left to decide');
void skipped;
console.log('pruned schema tests passed');
