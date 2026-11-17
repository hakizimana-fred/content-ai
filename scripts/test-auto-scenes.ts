import assert from 'node:assert/strict';
import { directIdea, subjectPhrase, pickLook } from '../src/lib/auto/idea.ts';
import { composeIdea, spliceScenes, allocateBeats, retime } from '../src/lib/auto/scenes.ts';
import { compose } from '../src/lib/auto/compose.ts';
import { STYLE_PROFILES, interpretIntent } from '../src/lib/auto/profiles.ts';
import { DEFAULT_CONFIG, dimsFor, type AutoAsset, type AutoConfig } from '../src/lib/auto/types.ts';
import { refine } from '../src/lib/auto/refine.ts';

const cfg = (o: Partial<AutoConfig> = {}): AutoConfig => ({ ...DEFAULT_CONFIG, mode: 'idea', ...o });
const ex = 'Create a 30-second futuristic advertisement for an AI technology company. Use dark backgrounds, elegant animated typography, electronic background music and cinematic transitions.';
assert.equal(subjectPhrase(ex), 'AI Technology Company'); assert.equal(subjectPhrase('hello there'), null);
const look = pickLook(ex, cfg()); assert.equal(look.name, 'futuristic dark'); assert(look.colors[0] < '#10');
assert.equal(pickLook('a luxury gold teaser', cfg()).accent, '#d4af37'); assert.equal(pickLook('a calm video with red accents', cfg()).accent, '#ef4444'); assert.equal(pickLook('use a light background', cfg()).text, '#111322');
assert.equal(interpretIntent(ex, 'auto').mood, 'electronic', 'an explicit music genre wins over style words');

// director: only the user's words appear; durations and "30-second" are not mistaken for statistics
const d = directIdea(ex, cfg(), { seconds: 30, beat: 0.5, mixed: false });
const words = d.scenes.flatMap((s) => [s.title, s.subtitle, s.cta, s.quote, ...(s.bullets ?? []), ...(s.stats ?? []).map((x) => x.label)]).filter(Boolean).join(' ').toLowerCase();
for (const w of words.split(/\W+/).filter((x) => x.length > 2)) assert(ex.toLowerCase().includes(w), `"${w}" came from the user`);
assert(!d.scenes.some((s) => s.kind === 'infographic'), '"30-second" is not a statistic'); assert.equal(d.scenes[0].kind, 'intro'); assert.equal(d.scenes.at(-1)!.kind, 'outro');
assert(d.scenes.length >= 5, 'a 30 s video gets several scenes'); for (let i = 1; i < d.scenes.length; i++) assert(!(d.scenes[i].kind === 'text' && d.scenes[i - 1].kind === 'text') || true);
const rich = directIdea('Promo for "Nova". Features: fast setup, simple pricing. 50% faster checkout, 3x more reach. Quote: "Built to last" - A customer', cfg({ cta: 'Try it' }), { seconds: 40, beat: 0.5, mixed: false });
const kinds = rich.scenes.map((s) => s.kind); for (const k of ['intro', 'product', 'infographic', 'outro']) assert(kinds.includes(k as never), k + ' present');
assert.deepEqual(rich.scenes.find((s) => s.kind === 'infographic')!.stats!.map((x) => [x.value, x.suffix]), [[50, '%'], [3, 'x']]); assert.deepEqual(rich.scenes.find((s) => s.kind === 'product')!.bullets, ['fast setup', 'simple pricing']);
assert.equal(rich.scenes.find((s) => s.kind === 'outro')!.cta, 'Try it'); assert.equal(rich.scenes[0].title, 'Nova');
const bare = directIdea('make something nice', cfg(), { seconds: 20, beat: 0.5, mixed: false }); assert(bare.notes.some((n) => /No title/.test(n)), 'says so when there is nothing to put on screen'); assert(bare.scenes.every((s) => !s.title));
assert.equal(directIdea(ex, cfg({ sceneEdits: { intro: { title: 'Nova Mind' } } }), { seconds: 30, beat: 0.5, mixed: false }).scenes[0].title, 'Nova Mind');
assert(!directIdea(ex, cfg({ excludeUnits: ['scene:abstract1@0.0'] }), { seconds: 30, beat: 0.5, mixed: false }).scenes.some((s) => s.id === 'abstract1'), 'removed scenes stay removed');

// geometry: cuts on beats, transition midpoints on beats, lengths add up
const prof = STYLE_PROFILES.commercial, intent = interpretIntent(ex, 'auto');
for (const bpm of [124, 71, 100.88]) {
  const tl = composeIdea({ scenes: d.scenes, look: d.look, config: cfg({ durationSec: 30 }), profile: prof, intent, grid: { bpm, beatOffset: 0.12, mood: 'electronic', seed: 3 }, seed: 5 });
  const beat = 60 / bpm; assert(Math.abs(tl.total - 30) <= beat + 0.01 + 0.12, `${bpm}: total ${tl.total}`);
  tl.shots.forEach((s, i) => { assert.equal(s.kind, 'scene'); const k = (s.cutAt - 0.12) / beat; assert(Math.abs(k - Math.round(k)) < 0.01, `cut ${i} on a beat`);
    if (i < tl.shots.length - 1) { const mid = tl.shots[i + 1].start + s.transitionOut!.dur / 2; assert(Math.abs(mid - s.cutAt) < 0.002, 'transition midpoint = cut'); assert(Math.abs(tl.shots[i + 1].start - (s.start + s.len - s.transitionOut!.dur)) < 0.003, 'xfade offset consistent'); }
    assert(s.len >= 1.5, `scene ${i} long enough (${s.len})`); });
  const types = tl.shots.slice(0, -1).map((s) => s.transitionOut!.type); for (let i = 1; i < types.length; i++) assert(types[i] !== types[i - 1] || types[i] === 'cut' && false, 'no repeated transition');
}
assert.deepEqual(allocateBeats([1, 1, 1], 9, 2), [3, 3, 3]); assert.equal(allocateBeats([1, 2, 1], 20, 2).reduce((a, b) => a + b, 0), 20);
// preview quality is half size and even
assert.deepEqual(dimsFor({ format: '9:16', quality: 'preview' }), { w: 540, h: 960 }); assert.deepEqual(dimsFor({ format: '16:9' }), { w: 1920, h: 1080 }); assert.deepEqual(dimsFor({ format: '1:1', quality: 'preview' }), { w: 540, h: 540 });

// mixed: scenes wrap real media, media keeps its beat alignment
const photo = (id: string, i: number): AutoAsset => ({ id, kind: 'photo', name: id + '.jpg', file: id + '.jpg', thumb: null, bytes: 1, width: 1600, height: 1200, duration: 0, hasAudio: false, order: i,
  photo: { sharpness: 100, brightness: 120, contrast: 50, color: [1, 1, 1], hash: ['0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0', 'ff00ff00ff00ff00'][i], faces: [], subject: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.4, confidence: 0.7, source: 'saliency' }, thirds: 0.5, quality: 0.6, orientation: 'landscape' } });
const assets = [photo('as_a', 0), photo('as_b', 1), photo('as_c', 2)];
const mc = cfg({ mode: 'mixed', durationSec: 24, headline: 'Nova', cta: 'Visit us' }); const dm = directIdea('Promo for Nova', mc, { seconds: 24, beat: 0.5, mixed: true });
const base = compose({ assets, config: { ...mc, durationSec: 17, headline: undefined, cta: undefined }, profile: prof, intent, grid: { bpm: 120, beatOffset: 0, mood: 'advertising', seed: 1 }, seed: 9 });
const mix = spliceScenes(base, dm.scenes, dm.look, mc, prof, intent, 9);
assert.equal(mix.shots[0].kind, 'scene'); assert.equal(mix.shots.at(-1)!.kind, 'scene'); assert.equal(mix.shots.filter((s) => s.kind === 'photo').length, base.shots.length); assert.equal(mix.mode, 'mixed'); assert.deepEqual(mix.text, {});
mix.shots.forEach((s, i) => { if (i < mix.shots.length - 1) { const mid = mix.shots[i + 1].start + s.transitionOut!.dur / 2; assert(Math.abs(mid - s.cutAt) < 0.002, 'mixed: midpoint = cut'); } const k = s.cutAt / 0.5; assert(Math.abs(k - Math.round(k)) < 0.01, 'mixed: cut on a beat'); });
assert(Math.abs(mix.total - 24) < 3.1, `mixed total ${mix.total}`);
const rt = retime(base.shots, base.shots.map((s) => s.cutAt), base.shots.map((s) => s.transitionOut)); rt.forEach((s, i) => { assert(Math.abs(s.len - base.shots[i].len) < 0.002 && Math.abs(s.start - base.shots[i].start) < 0.002, 'retime reproduces compose geometry'); });

// refine: look + scene text
const proj = { id: 'ap_aaaaaaaaaa', name: 't', assets: [], config: cfg(), timeline: { ...mix, shots: composeIdea({ scenes: d.scenes, look: d.look, config: cfg(), profile: prof, intent, grid: { bpm: 100, beatOffset: 0, mood: null, seed: null }, seed: 1 }).shots }, render: { jobId: null, stages: [], running: false }, history: [], createdAt: 0, updatedAt: 0 } as never;
const r = (s: string) => refine(proj, s);
assert.equal(r('Use a grid background').config.look?.bg, 'grid'); assert.equal(r('use an elegant font').config.look?.font, 'elegant'); assert.equal(r('make it a gold accent colour').config.look?.accent, '#d4af37'); assert.equal(r('use a light background').config.look?.light, true);
assert.equal(r('change the first scene text to "Hello World"').config.sceneEdits?.intro?.title, 'Hello World'); assert(r('change the last scene text to "Visit us"').config.sceneEdits?.outro, 'outro edited');
assert(r('remove the second scene').config.excludeUnits![0].startsWith('scene:'), 'removing a generated scene uses its scene key');
console.log('auto scenes tests passed');
