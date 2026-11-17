import assert from 'node:assert/strict';
import { refine } from '../src/lib/auto/refine.ts';
import { DEFAULT_CONFIG, type AutoProject, type Shot } from '../src/lib/auto/types.ts';
const shot = (i: number): Shot => ({ id: 's' + i, assetId: 'as_' + i, kind: 'photo', start: i * 3, len: 3, cutAt: i * 3 + 3, srcStart: 0, srcLen: 3, layout: 'fill', focus: null, transitionOut: null, role: 'body', why: '' });
const P = (cfg = {}): AutoProject => ({ id: 'ap_aaaaaaaaaa', name: 't', assets: [], config: { ...DEFAULT_CONFIG, prompt: 'a restaurant promo', durationSec: 30, ...cfg }, timeline: { shots: [0, 1, 2, 3].map(shot), total: 12, fps: 30, w: 1080, h: 1920, bpm: 100, beatOffset: 0, beatSeconds: 0.6, musicMood: null, musicSeed: null, dropped: [], notes: [], text: {} }, render: { jobId: null, stages: [], running: false }, history: [], createdAt: 0, updatedAt: 0 });
const r = (s: string, cfg = {}) => refine(P(cfg), s);
const spec: [string, (x: ReturnType<typeof refine>) => void][] = [
  ['Make the video more cinematic.', (x) => { assert.equal(x.config.style, 'cinematic'); assert(x.dirty.includes('composition')); }],
  ['Change the soundtrack.', (x) => { assert.equal(x.config.musicVariation, 1); assert.equal(x.config.soundtrackId, undefined); assert.deepEqual(x.dirty.sort(), ['audio', 'composition']); }],
  ['Remove the second scene.', (x) => { assert.deepEqual(x.config.excludeUnits, ['as_1@0.0']); }],
  ['please delete the last shot', (x) => { assert.deepEqual(x.config.excludeUnits, ['as_3@0.0']); }],
  ['Make the transitions smoother.', (x) => assert.equal(x.config.transitionFeel, 'smooth')],
  ['Make the transitions punchier', (x) => assert.equal(x.config.transitionFeel, 'punchy')],
  ['Increase the text size.', (x) => { assert(x.config.textScale! > 1.2); assert.deepEqual(x.dirty, ['text']); }],
  ['Make the captions smaller', (x) => assert(x.config.textScale! < 0.9)],
  ['Make the opening more engaging.', (x) => assert.equal(x.config.openingBoost, true)],
  ['Use a more energetic soundtrack.', (x) => { assert(/energetic/i.test(x.config.prompt)); assert.equal(x.config.musicVariation, 1); assert(!x.changes.some((c) => /lowered/.test(c))); }],
  ['Reduce the background music.', (x) => { assert(x.config.musicGain! < 0.7); assert.deepEqual(x.dirty, ['audio']); }],
  ['make the music louder', (x) => assert(x.config.musicGain! > 1.3)],
  ['make it 20 seconds', (x) => assert.equal(x.config.durationSec, 20)],
  ['make it shorter', (x) => assert.equal(x.config.durationSec, 23)],
  ['change the headline to "Fresh Every Day"', (x) => assert.equal(x.config.headline, 'Fresh Every Day')],
  ['set the closing message to "Visit us this weekend"', (x) => assert.equal(x.config.cta, 'Visit us this weekend')],
  ['turn off the captions', (x) => assert.equal(x.config.captions, false)],
  ['no background music please', (x) => assert.equal(x.config.audioMode, 'none')],
  ['export it as a square video', (x) => assert.equal(x.config.format, '1:1')],
  ['try another version', (x) => assert.equal(x.config.variation, 1)],
  ['make it more luxurious', (x) => assert(/luxur/i.test(x.config.prompt))],
];
for (const [text, check] of spec) { const x = r(text); assert(!x.unrecognised, `understood: "${text}" -> ${x.notes.join(' ')}`); check(x); console.log('ok', text.padEnd(44), '->', x.changes.join(' | ')); }
// no false positives
for (const s of ['it looks great, thanks', 'hello', 'the soundtrack is nice', 'I love the transitions']) assert(r(s).unrecognised, `nothing to do for "${s}"`);
assert(r('Remove the tenth scene').notes[0].includes('no scene 10'), 'out-of-range is explained');
assert(refine({ ...P(), timeline: undefined }, 'remove the second scene').notes[0].includes('first version'), 'needs a first version');
assert(refine({ ...P(), timeline: { ...P().timeline!, shots: [shot(0)] } }, 'remove the first scene').notes[0].includes('only scene'));
const before = P(); refine(before, 'change the soundtrack'); assert.equal(before.config.musicVariation, undefined, 'does not mutate the project');
console.log('auto refine tests passed');
