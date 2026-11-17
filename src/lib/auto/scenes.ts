import { rng } from '../studio/dsp.ts';
import { dimsFor, type AutoConfig, type SceneLook, type SceneSpec, type Shot, type Timeline } from './types.ts';
import type { Intent, StyleProfile } from './profiles.ts';
import type { BeatGrid } from './compose.ts';

const FPS = 30;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
type Trans = { type: string; dur: number };

/** Transitions between `n` neighbouring items; the same rules as photo/video compose (no repeats, never two hard cuts in a row). */
export function pickTransitions(n: number, spans: number[], profile: StyleProfile, intent: Intent, feel: string, rand: () => number): Trans[] {
  const SMOOTH = ['fade', 'dissolve', 'smoothleft', 'smoothright', 'fadeblack'], PUNCHY = ['zoomin', 'slideleft', 'wipeleft', 'slideright', 'circleopen'];
  const list = feel === 'smooth' ? SMOOTH : feel === 'punchy' ? PUNCHY : profile.transitions; let idx = Math.floor(rand() * list.length), last = '';
  const out: Trans[] = [];
  for (let i = 0; i < n; i++) {
    const pick = () => list[idx++ % list.length]; const cut = rand() < (feel === 'smooth' ? 0 : profile.cutRatio) && last !== 'cut';
    let type = cut ? 'cut' : pick(); if (type === last) type = pick(); last = type;
    const base = (type === 'cut' ? 2 / FPS : profile.transitionSeconds * (feel === 'smooth' ? 1.5 : feel === 'punchy' ? 0.7 : 1)) * (intent.pace === 'slow' ? 1.2 : intent.pace === 'fast' ? 0.85 : 1);
    out.push({ type, dur: +clamp(base, 2 / FPS, 0.42 * Math.min(spans[i] ?? 9, spans[i + 1] ?? 9)).toFixed(3) });
  }
  return out;
}

/** Recompute every shot's visible window from its end boundary and the transitions around it (same geometry as compose). */
export function retime(shots: Shot[], cuts: number[], trans: (Trans | null)[]): Shot[] {
  return shots.map((s, i) => {
    const prevB = i === 0 ? 0 : cuts[i - 1], dPrev = i === 0 ? 0 : trans[i - 1]?.dur ?? 0, dNext = trans[i]?.dur ?? 0;
    const start = +(prevB - dPrev / 2).toFixed(4), len = +(cuts[i] - prevB + dPrev / 2 + dNext / 2).toFixed(4);
    return { ...s, start, len, cutAt: cuts[i], srcLen: len, transitionOut: trans[i] ?? null };
  });
}

/** Distribute `beats` over weighted items, at least `kMin` each, whole beats only. */
export function allocateBeats(weights: number[], beats: number, kMin: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1; const k = weights.map((w) => Math.max(kMin, Math.round((w / sum) * beats)));
  let diff = beats - k.reduce((a, b) => a + b, 0), guard = 0;
  while (diff !== 0 && guard++ < 400) {
    const idx = k.map((_, i) => i).filter((i) => (diff > 0 ? true : k[i] > kMin)); if (!idx.length) break;
    idx.sort((a, b) => (diff > 0 ? weights[b] / k[b] - weights[a] / k[a] : k[b] / weights[b] - k[a] / weights[a]));
    k[idx[0]] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1;
  }
  return k;
}

const sceneShot = (sc: SceneSpec, i: number): Shot => ({ id: `sh_${i}`, assetId: `scene:${sc.id}`, kind: 'scene', scene: sc, start: 0, len: 1, cutAt: 1, srcStart: 0, srcLen: 1, layout: 'fill', focus: null, transitionOut: null, role: 'body', why: '' });
const WHY: Record<string, string> = { intro: 'opening title scene', outro: 'closing scene', text: 'text scene with animated typography', quote: 'quote scene', product: 'product presentation scene', infographic: 'animated infographic from your numbers', abstract: 'text-free animated motion scene', image: 'image scene from your creative library', footage: 'footage scene from your creative library', product3d: 'real 3D object scene (meshes, camera, lighting)', title3d: 'real 3D extruded title', journey3d: 'real 3D terrain flyover', scenery25: 'layered 2.5D parallax scenery (simulated depth, not 3D)', photo25d: 'photo as a 2.5D floating card with parallax layers (simulated depth, not 3D)', diagram: 'animated diagram of your steps', showcase: 'perspective phone mockup (2.5D)', logo3d: 'stylised 3D extrusion of your logo (opt-in)' };

export interface IdeaComposeInput { scenes: SceneSpec[]; look: SceneLook; config: AutoConfig; profile: StyleProfile; intent: Intent; grid: BeatGrid; seed: number; notes?: string[] }

/** Idea-to-Video timeline: only generated scenes, durations in whole beats, transitions midpoint-aligned to beats. */
export function composeIdea(inp: IdeaComposeInput): Timeline {
  const { scenes, config, profile, intent, grid } = inp; const { w, h } = dimsFor(config); const rand = rng((inp.seed + (config.variation ?? 0) * 7919) * 104729 + 11);
  const beat = grid.bpm ? 60 / grid.bpm : 0.5, offset = grid.bpm ? grid.beatOffset % beat : 0, T = clamp(config.durationSec, 5, 180);
  if (!scenes.length) throw new Error('No scenes left: restore a removed scene or change the instruction.');
  const M = Math.max(scenes.length, Math.floor((T - offset) / beat)), kMin = Math.max(1, Math.ceil(1.8 / beat));
  const k = allocateBeats(scenes.map((s) => s.weight), M, Math.min(kMin, Math.floor(M / scenes.length) || 1));
  const cuts: number[] = []; let acc = offset; k.forEach((x) => { acc += x * beat; cuts.push(+acc.toFixed(4)); });
  const trans = pickTransitions(scenes.length - 1, k.map((x) => x * beat), profile, intent, config.transitionFeel ?? 'auto', rand);
  const shots = retime(scenes.map((s, i) => ({ ...sceneShot(s, i), role: (i === 0 ? 'opening' : i === scenes.length - 1 && scenes.length > 1 ? 'closing' : 'body') as Shot['role'],
    why: `${WHY[s.kind]}; ${k[i]} beats (${(k[i] * beat).toFixed(2)} s)` })), cuts, [...trans, null]);
  return { shots, total: +cuts[cuts.length - 1].toFixed(3), fps: config.fps ?? FPS, w, h, bpm: grid.bpm, beatOffset: offset, beatSeconds: grid.bpm ? beat : null, musicMood: grid.mood, musicSeed: grid.seed,
    dropped: [], notes: [...(inp.notes ?? [])], text: {}, mode: 'idea', look: inp.look };
}

/** Mixed media: wrap an already composed photo/video timeline with generated intro/outro/interlude scenes (shifting by whole beats). */
export function spliceScenes(tl: Timeline, scenes: SceneSpec[], look: SceneLook, config: AutoConfig, profile: StyleProfile, intent: Intent, seed: number): Timeline {
  const rand = rng((seed + 5) * 104729 + 3), beat = tl.beatSeconds ?? 0.5; const intro = scenes.find((s) => s.kind === 'intro'), outro = scenes.find((s) => s.kind === 'outro'), mid = scenes.filter((s) => s !== intro && s !== outro);
  const kk = (sc: SceneSpec) => Math.max(Math.ceil(1.8 / beat), Math.round((sc.weight * 2.2) / beat));
  const pre = intro ? [intro] : [], post = [...mid, ...(outro ? [outro] : [])];
  const kPre = pre.map(kk), kPost = post.map(kk), shift = kPre.reduce((a, b) => a + b, 0) * beat;
  const mediaCuts = tl.shots.map((s) => +(s.cutAt + shift).toFixed(4)); const lastMedia = mediaCuts[mediaCuts.length - 1];
  const cuts: number[] = []; let c = tl.beatOffset;
  for (const x of kPre) { c += x * beat; cuts.push(+c.toFixed(4)); }
  cuts.push(...mediaCuts); c = lastMedia; for (const x of kPost) { c += x * beat; cuts.push(+c.toFixed(4)); }
  const all: Shot[] = [...pre.map((s, i) => sceneShot(s, i)), ...tl.shots, ...post.map((s, i) => sceneShot(s, 100 + i))].map((s, i) => ({ ...s, id: `sh_${i}`, why: s.kind === 'scene' ? `${WHY[s.scene!.kind]}` : s.why }));
  const spans = cuts.map((x, i) => x - (i ? cuts[i - 1] : 0)); const tr = pickTransitions(all.length - 1, spans, profile, intent, config.transitionFeel ?? 'auto', rand);
  const old = tl.shots.map((s) => s.transitionOut); const trans: (Trans | null)[] = [];
  for (let i = 0; i < all.length - 1; i++) { const mi = i - pre.length; trans.push(mi >= 0 && mi < tl.shots.length - 1 && old[mi] ? old[mi]! : tr[i]); }
  trans.push(null);
  const shots = retime(all, cuts, trans).map((s, i, a) => ({ ...s, role: (i === 0 ? 'opening' : i === a.length - 1 ? 'closing' : 'body') as Shot['role'] }));
  return { ...tl, shots, total: +cuts[cuts.length - 1].toFixed(3), text: {}, mode: 'mixed', look, notes: [...tl.notes, `${pre.length + post.length} generated scene(s) added around your media`] };
}
