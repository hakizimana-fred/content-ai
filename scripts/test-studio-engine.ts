import assert from 'node:assert/strict';
import { IDENTITY_TEMPLATES, validateIdentity, applyIdentityToPlan, type Identity } from '../src/lib/studio/identity.ts';
import { buildOverlay, composeAss } from '../src/lib/studio/overlay.ts';
import { productionFromPlan } from '../src/lib/studio/produce.ts';
import { chooseMoment } from '../src/lib/studio/moment.ts';
import { applyRules } from '../src/lib/studio/rules.ts';
import { DEFAULT_PLAN, validatePlan } from '../src/lib/studio/plan.ts';
import { hasAudioWork } from '../src/lib/studio/audio-spec.ts';

const africa = { ...IDENTITY_TEMPLATES.africa_unfiltered, id: 'idn_test', createdAt: 0, updatedAt: 0 } as Identity;

// ---- identity validation ----
for (const [k, t] of Object.entries(IDENTITY_TEMPLATES)) assert(validateIdentity(t).ok, `template ${k} valid`);
const badId = validateIdentity({ ...IDENTITY_TEMPLATES.africa_unfiltered, colors: { primary: 'red', accent: '#12345', text: '#FFF' }, typography: { fontFamily: 'Comic Sans', fontWeight: 5000 }, name: '' });
assert(!badId.ok && badId.errors.length >= 5, 'bad identity rejected with every problem listed');
assert(!validateIdentity(null).ok);

// ---- identity inheritance: brand fills gaps, user words win ----
const ruled = applyRules('Make a 45 second TikTok with suspenseful music and bold captions');
const inherited = applyIdentityToPlan(ruled.plan, africa, ruled.explicit);
assert.equal(inherited.audio.mood, 'suspense', 'explicit mood wins over identity');
assert.equal(inherited.style, 'african_contemporary', 'unstated style comes from identity');
assert.equal(inherited.framing, 'speaker_tracking');
assert.equal(inherited.captions.preset, 'bold_dynamic');
assert.equal(inherited.captions.position, 'center');
assert.equal(inherited.ending.style, 'logo_sting');
assert(validatePlan(inherited).ok, 'inherited plan still validates');
const noMusic = applyIdentityToPlan(applyRules('a short clip').plan, africa);
assert.equal(noMusic.audio.music, false, 'identity does not force music on');
const unstated = applyIdentityToPlan(applyRules('add some music').plan, africa, ['audio.music']);
assert.equal(unstated.audio.mood, 'african_fusion', 'identity supplies its signature mood when none stated');
assert.notEqual(DEFAULT_PLAN.style, inherited.style); // base plan not mutated
assert.equal(DEFAULT_PLAN.audio.mood, 'none');

// ---- overlays (ASS) ----
const ov = buildOverlay({ title: { text: 'The big reveal', seconds: 2 }, endCard: { text: 'Africa Unfiltered', seconds: 2.4 }, brand: { text: 'AU', corner: 'tl' }, accent: '#F59E0B', text: '#FFFFFF', fontFamily: 'Anton' }, 1080, 1920, 30);
assert(/Dialogue: 5,0:00:00\.15,0:00:02\.15,OvTitle/.test(ov.events) && /THE BIG REVEAL/.test(ov.events));
assert(/OvEnd/.test(ov.events) && /0:00:27\.60/.test(ov.events), 'end card in the last 2.4s');
assert(ov.styles.includes('&H000B9EF5'), 'accent colour converted to ASS BGR');
assert(!buildOverlay({ title: { text: 'x{\\evil}', seconds: 2 }, accent: '#000000', text: '#ffffff', fontFamily: 'Inter' }, 1080, 1920, 20).events.includes('{\\evil}'), 'override tags stripped from user text');
const base = '[Script Info]\nPlayResX: 1080\n\n[V4+ Styles]\nFormat: x\nStyle: Cap,Poppins,64\n\n[Events]\nFormat: y\nDialogue: 0,0:00:01.00,0:00:02.00,Cap,,0,0,0,,hello\n';
const merged = composeAss(base, { title: { text: 'T', seconds: 2 }, accent: '#111111', text: '#ffffff', fontFamily: 'Inter' }, 1080, 1920, 20);
assert(merged.indexOf('Style: OvTitle') > merged.indexOf('Style: Cap') && merged.indexOf('Style: OvTitle') < merged.indexOf('[Events]'), 'styles merged inside the styles block');
assert(merged.includes('hello') && merged.includes('OvTitle,,'), 'caption and overlay events both present');
const standalone = composeAss(null, { title: { text: 'T', seconds: 2 }, accent: '#111111', text: '#ffffff', fontFamily: 'Inter' }, 1080, 1920, 20);
assert(standalone.includes('[Script Info]') && standalone.includes('[Events]') && standalone.includes('Dialogue:'), 'works with no transcript');
assert.equal(composeAss(base, { accent: '#000000', text: '#fff', fontFamily: 'Inter' }, 1080, 1920, 20), base, 'no overlays -> unchanged');

// ---- plan -> production ----
const plan = validatePlan({ ...applyRules('45 second TikTok, documentary, suspenseful music, sound effects, memorable ending').plan }); assert(plan.ok);
const r = productionFromPlan(plan.ok ? plan.plan : DEFAULT_PLAN, { title: 'Hook', hasTranscript: true, seed: 7, sceneTimesInClip: [3, 9, 14] });
assert.equal(r.production.platform, 'tiktok'); assert(r.production.captions); assert.equal(r.production.studio?.audioDesign?.mood, 'suspense');
assert.equal(r.production.studio?.audioDesign?.grade, 'documentary'); assert.equal(r.production.studio?.audioDesign?.sfxCues.length, 3);
assert(r.skipped.some((s) => /speaker tracking/.test(s)), 'tracking without a track is reported, not faked');
assert.equal(r.production.framing.mode, 'center');
const withTrack = productionFromPlan(plan.ok ? plan.plan : DEFAULT_PLAN, { title: 'Hook', hasTranscript: false, seed: 1, track: [{ t: 1, x: 0.4 }] });
assert.equal(withTrack.production.framing.mode, 'auto'); assert.equal(withTrack.production.captions, null); assert(withTrack.skipped.some((s) => /transcript/.test(s)));
const idr = productionFromPlan(inherited, { identity: africa, title: 'The big reveal', hasTranscript: true, seed: 1 });
assert(idr.production.studio?.overlays?.title && idr.production.studio.overlays.endCard && idr.production.studio.overlays.brand);
assert.equal(idr.captionStyle.fontFamily, 'Anton'); assert.equal(idr.production.studio?.audioDesign?.signatureSeed, 2024);
const noId = productionFromPlan(inherited, { title: 'x', hasTranscript: true, seed: 1 });
assert.equal(noId.production.studio?.overlays, undefined, 'no identity -> no overlays');
const square = productionFromPlan({ ...DEFAULT_PLAN, format: 'square_1_1' }, { title: 'x', hasTranscript: false, seed: 1 });
assert(square.applied.some((s) => /1:1 square/.test(s)) && square.production.studio?.canvas === 'square', 'square is now rendered');
assert.equal(productionFromPlan({ ...DEFAULT_PLAN, format: 'portrait_4_5' }, { title: 'x', hasTranscript: false, seed: 1 }).production.studio?.canvas, 'four_five');
const paced = productionFromPlan({ ...DEFAULT_PLAN, pacing: { remove_silence: true, speed: 1.1 } }, { title: 'x', hasTranscript: false, seed: 1 });
assert(paced.applied.some((a) => /silence removal/.test(a)) && paced.applied.some((a) => /speed 1.1/.test(a)), 'pacing is now applied');
assert.deepEqual(paced.production.studio?.pacing, { removeSilence: true, speed: 1.1 });
assert.equal(productionFromPlan(DEFAULT_PLAN, { title: 'x', hasTranscript: false, seed: 1 }).production.studio?.pacing, undefined, 'default plan does no retiming');
assert(!hasAudioWork(productionFromPlan(DEFAULT_PLAN, { title: 'x', hasTranscript: false, seed: 1 }).production.studio!.audioDesign!), 'default plan = no audio work, clip stays untouched');

// ---- moment choice ----
const c = (id: string, d: number, score: number) => ({ id, startTime: 100, endTime: 100 + d, duration: d, score });
const pick = chooseMoment([c('a', 30, 70), c('b', 46, 72), c('c', 120, 90)], 45)!;
assert.equal(pick.moment.id, 'b'); assert(!pick.trimmed);
const trim = chooseMoment([c('long', 80, 95), c('weak', 45, 40)], 45)!; assert.equal(trim.moment.id, 'long'); assert(trim.trimmed); assert.equal(trim.end, 145);
assert.equal(chooseMoment([], 45), null);
console.log('studio engine tests passed');
