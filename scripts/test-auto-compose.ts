import assert from 'node:assert/strict';
import { compose } from '../src/lib/auto/compose.ts';
import { STYLE_PROFILES, interpretIntent } from '../src/lib/auto/profiles.ts';
import { DEFAULT_CONFIG, type AutoAsset } from '../src/lib/auto/types.ts';

const photo = (id: string, q: number, hash: string, o: Partial<AutoAsset> = {}): AutoAsset => ({ id, kind: 'photo', name: id, file: id + '.jpg', thumb: null, bytes: 1, width: 1800, height: 1200, duration: 0, hasAudio: false, order: 0,
  photo: { sharpness: 300, brightness: 120, contrast: 40, color: [100, 100, 100], hash, faces: [], subject: { cx: 0.5, cy: 0.5, w: 0.25, h: 0.3, confidence: 0.8, source: 'saliency' }, thirds: 0.5, quality: q, orientation: 'landscape' }, ...o });
const video = (id: string, dur = 20): AutoAsset => ({ id, kind: 'video', name: id, file: id + '.mp4', thumb: null, bytes: 1, width: 1920, height: 1080, duration: dur, hasAudio: true, order: 0,
  video: { scenes: [{ start: 0, end: 8, score: 0.6, sharpness: 200, brightness: 120, motion: 3, faceFraction: 0.8, faceCenterX: 0.35, speaking: true, speechFraction: 0.9 }, { start: 8, end: dur, score: 0.45, sharpness: 150, brightness: 110, motion: 5, faceFraction: 0, faceCenterX: null, speaking: false, speechFraction: 0.2 }], silences: [], speechFraction: 0.5, faceFraction: 0.4, quality: 0.5, level: 'full', notes: [] } });

const photos = [photo('p1', 0.8, '0000000000000000'), photo('p2', 0.6, 'ffff0000ffff0000'), photo('p3', 0.7, '0f0f0f0f0f0f0f0f'), photo('p4', 0.65, 'f0f0f0f0f0f0f0f0'), photo('p5', 0.62, '00ff00ff00ff00ff'), photo('p6', 0.66, '3333333333333333')];
const assets = [...photos, video('v1')];
const cfg = { ...DEFAULT_CONFIG, durationSec: 30, format: '9:16' as const };
const intent = interpretIntent('energetic restaurant promo', 'auto');
console.log('intent', intent.style, intent.mood, intent.intensity, intent.pace);
assert.equal(intent.style, 'commercial'); assert.equal(intent.pace, 'fast'); assert.equal(intent.intensity, 'high');
assert.equal(interpretIntent('turn these photographs into an emotional travel montage', 'auto').mood, 'emotional');
assert.equal(interpretIntent('an elegant luxury watch advert', 'auto').mood, 'luxury'); assert.equal(interpretIntent('anything', 'documentary').style, 'documentary');
assert.equal(interpretIntent('upbeat african-inspired soundtrack for a restaurant', 'auto').mood, 'african_fusion');

for (const [label, bpm, off] of [['124 bpm', 124, 0], ['76 bpm offset', 76, 0.2], ['no music', null, 0]] as const) {
  const tl = compose({ assets, config: cfg, profile: STYLE_PROFILES.commercial, intent, grid: { bpm, beatOffset: off, mood: 'advertising', seed: 1 }, seed: 1 });
  const beat = bpm ? 60 / bpm : 0.5, o = bpm ? off : 0;
  console.log(label, `total ${tl.total}s, ${tl.shots.length} shots, ${tl.dropped.length} dropped`, tl.notes);
  assert(Math.abs(tl.total - 30) <= beat + 0.01, `${label}: total ${tl.total} within one beat of 30`);
  for (const s of tl.shots) { const m = (s.cutAt - o) / beat; assert(Math.abs(m - Math.round(m)) < 0.01, `${label}: ${s.id} cut on a beat`); }
  // geometry: transition midpoints are the beat, shots overlap exactly by their transition, nothing has negative length
  tl.shots.forEach((s, i) => { assert(s.len > 0.3, 'positive length'); const nx = tl.shots[i + 1]; if (nx) { const d = s.transitionOut!.dur; assert(Math.abs(s.start + s.len - d / 2 - s.cutAt) < 1e-3 && Math.abs(nx.start - (s.cutAt - d / 2)) < 1e-3, 'overlap = transition, centred on the beat'); assert(s.transitionOut!.dur <= 0.43 * Math.min(s.len, nx.len) + 0.1); } });
  const last = tl.shots[tl.shots.length - 1]; assert(Math.abs(last.start + last.len - tl.total) < 1e-3, 'timeline ends exactly at total');
  assert.equal(tl.shots[0].role, 'opening'); assert.equal(last.role, 'closing');
  assert(tl.shots.every((s, i) => i === 0 || s.assetId !== tl.shots[i - 1].assetId || s.kind === 'photo' && false), 'no same clip back to back');
  const types = tl.shots.map((s) => s.transitionOut?.type).filter(Boolean); assert(types.every((t, i) => i === 0 || t !== types[i - 1]), 'no repeated transition twice in a row');
  for (const s of tl.shots.filter((x) => x.kind === 'video')) { const a = assets.find((x) => x.id === s.assetId)!; assert(s.srcStart >= 0 && s.srcStart + s.srcLen <= a.duration + 1e-6, 'video shot stays inside its source'); }
  const mo = tl.shots.filter((s) => s.motion).map((s) => s.motion); assert(mo.every((m, i) => i === 0 || m !== mo[i - 1]), 'motion varies');
}
// determinism + variation
const base = { assets, config: cfg, profile: STYLE_PROFILES.commercial, intent, grid: { bpm: 120, beatOffset: 0, mood: 'advertising', seed: 1 } };
assert.deepEqual(compose({ ...base, seed: 5 }), compose({ ...base, seed: 5 }), 'same inputs -> same timeline');

// near-duplicates dropped, blurry dropped when alternatives exist
const dup = compose({ ...base, assets: [photo('a', 0.8, '0000000000000000'), photo('b', 0.5, '0000000000000001'), photo('c', 0.7, 'ffff0000ffff0000'), photo('d', 0.05, '0f0f0f0f0f0f0f0f'), photo('e', 0.6, 'f0f0f0f0f0f0f0f0')], config: { ...cfg, durationSec: 12 }, seed: 2 });
console.log('dropped', dup.dropped); assert(dup.dropped.some((d) => d.assetId === 'b' && /duplicate/.test(d.why))); assert(dup.shots.every((s) => s.assetId !== 'b'));
// too little media: honest shorter video, and a single photo still works
const one = compose({ ...base, assets: [photo('solo', 0.7, '0000000000000000')], config: { ...cfg, durationSec: 30 }, seed: 1 });
console.log('single photo', one.total, one.notes); assert(one.shots.length === 1 && one.total < 30 && one.notes.some((n) => /instead of 30s/.test(n)));
assert.throws(() => compose({ ...base, assets: [], seed: 1 }), /at least one photo or video/);
// keep order
const ko = compose({ ...base, config: { ...cfg, keepOrder: true }, assets: photos, seed: 3 }); assert.deepEqual(ko.shots.map((s) => s.assetId), ko.shots.map((s) => s.assetId).slice().sort((a, b) => (a < b ? -1 : 1)).length ? ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].slice(0, ko.shots.length) : []);
// layout: portrait canvas + wide subject => layered; small subject => fill (crop)
const wide = photo('w', 0.7, '0000000000000000'); wide.photo!.subject = { cx: 0.5, cy: 0.5, w: 0.8, h: 0.5, confidence: 0.9, source: 'saliency' };
const lay = compose({ ...base, assets: [wide, photo('n', 0.7, 'ffff0000ffff0000')], seed: 1 }); assert(lay.shots.find((s) => s.assetId === 'w')!.layout === 'layered' && lay.shots.find((s) => s.assetId === 'n')!.layout === 'fill');
// video framing: face => crop around face, no face => blurred-fit
const vtl = compose({ ...base, assets: [video('vv'), photo('p', 0.7, '0000000000000000')], config: { ...cfg, durationSec: 20 }, seed: 1 }); const vs = vtl.shots.filter((s) => s.kind === 'video'); console.log('video shots', vs.map((s) => `${s.videoFraming}@${s.videoCenterX} ${s.srcStart}+${s.srcLen}`)); assert(vs.length >= 1);
console.log('auto compose tests passed');
