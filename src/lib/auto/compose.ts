import { rng } from '../studio/dsp.ts';
import { dimsFor, type AutoAsset, type AutoConfig, type MotionType, type Shot, type Timeline } from './types.ts';
import type { Intent, StyleProfile } from './profiles.ts';

export interface BeatGrid { bpm: number | null; beatOffset: number; mood: string | null; seed: number | null }
export interface ComposeInput { assets: AutoAsset[]; config: AutoConfig; profile: StyleProfile; intent: Intent; grid: BeatGrid; seed: number }

const FPS = 30;
const hamming = (a: string, b: string) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } } return n; };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface Unit {
  assetId: string; kind: 'photo' | 'video'; score: number; hash?: string; bright: number; order: number;
  srcStart: number; maxLen: number; speaking: boolean; faceX: number | null; face: boolean; why: string[];
}

/** Candidate units: every photo, plus the best chunks of every scene of every video. */
export function buildUnits(assets: AutoAsset[], profile: StyleProfile, captions: boolean): { units: Unit[]; dropped: { assetId: string; why: string }[] } {
  const units: Unit[] = [], dropped: { assetId: string; why: string }[] = [];
  assets.filter((a) => a.kind !== 'audio').forEach((a, idx) => {
    if (a.kind === 'photo' && a.photo) {
      units.push({ assetId: a.id, kind: 'photo', score: a.photo.quality + (a.photo.faces.length ? 0.1 : 0), hash: a.photo.hash, bright: a.photo.brightness, order: idx, srcStart: 0, maxLen: Infinity, speaking: false, faceX: a.photo.faces[0] ? a.photo.faces[0].x + a.photo.faces[0].w / 2 : null, face: a.photo.faces.length > 0,
        why: [a.photo.faces.length ? 'face detected' : a.photo.subject.confidence > 0.6 ? 'clear subject' : 'no strong subject', `quality ${a.photo.quality.toFixed(2)}`] });
    } else if (a.kind === 'video') {
      const scenes = a.video?.scenes?.length ? a.video.scenes : [{ start: 0, end: a.duration, score: 0.4, sharpness: 0, brightness: 120, motion: 0, faceFraction: 0, faceCenterX: null, speaking: false, speechFraction: a.hasAudio ? 0.5 : 0 }];
      let made = 0;
      for (const s of scenes) {
        const len = s.end - s.start; if (len < 1.2) continue;
        const speech = captions && (s.speaking || s.speechFraction > 0.65) && a.hasAudio;
        const chunkMax = speech ? Math.max(profile.videoMax, 8) : profile.videoMax;
        // start where speech resumes after a silence, so a chunk never opens mid-pause
        const silEnd = (a.video?.silences ?? []).filter((q) => q.end > s.start && q.end < s.end - 1).map((q) => q.end);
        const starts = [s.start, ...(speech ? silEnd : [])];
        for (let st = s.start + chunkMax; st < s.end - 1.5; st += chunkMax) starts.push(st);   // long scenes yield several non-overlapping chunks
        for (const st of starts) {
          const room = Math.min(s.end - st, chunkMax); if (room < 1.2) continue;
          units.push({ assetId: a.id, kind: 'video', score: s.score + (a.video ? 0 : 0), bright: s.brightness, order: idx + st / 1000, srcStart: st, maxLen: room, speaking: speech, faceX: s.faceCenterX, face: s.faceFraction > 0.3,
            why: [speech ? 'speech scene' : 'visual scene', `scene score ${s.score.toFixed(2)}`, `${st.toFixed(1)}s-${(st + room).toFixed(1)}s`] });
          made++; if (made >= 6) break;
        }
        if (made >= 6) break;
      }
      if (!made) dropped.push({ assetId: a.id, why: 'no scene long enough to use (all under 1.2 s)' });
    }
  });
  return { units, dropped };
}

function arrange(chosen: Unit[], keepOrder: boolean, rand: () => number): Unit[] {
  if (keepOrder || chosen.length <= 2) return [...chosen].sort((a, b) => a.order - b.order);
  const pool = [...chosen]; const hero = pool.reduce((b, u) => (u.score + (u.face ? 0.08 : 0) + (u.kind === 'photo' ? 0.02 : 0) > b.score + (b.face ? 0.08 : 0) + (b.kind === 'photo' ? 0.02 : 0) ? u : b));
  pool.splice(pool.indexOf(hero), 1);
  const closing = pool.length ? pool.reduce((b, u) => (u.score > b.score ? u : b)) : null; if (closing) pool.splice(pool.indexOf(closing), 1);
  const seq = [hero]; let last = hero;
  while (pool.length) {
    let best = pool[0], bv = -Infinity;
    for (const u of pool) {
      let v = u.score * 0.6 - Math.abs(u.bright - last.bright) / 255 * 0.5 - Math.abs(u.order - last.order) * 0.01 + rand() * 0.04;
      if (u.kind !== last.kind) v += 0.25;                                       // alternate photo / video for rhythm
      if (u.assetId === last.assetId) v -= 0.6;                                  // no back-to-back jump cuts of the same clip
      if (u.hash && last.hash && hamming(u.hash, last.hash) <= 10) v -= 0.5;     // similar pictures should not sit together
      if (v > bv) { bv = v; best = u; }
    }
    pool.splice(pool.indexOf(best), 1); seq.push(best); last = best;
  }
  if (closing) seq.push(closing);
  return seq;
}

export function compose(inp: ComposeInput): Timeline {
  const { assets, config, profile, intent, grid } = inp; const rand = rng((inp.seed + (inp.config.variation ?? 0) * 7919) * 104729 + 7);
  const { w, h } = dimsFor(config); const A = w / h; const feel = config.transitionFeel ?? 'auto';
  const notes: string[] = []; const beat = grid.bpm ? 60 / grid.bpm : 0.5; const offset = grid.bpm ? grid.beatOffset % beat : 0;
  const paceMul = intent.pace === 'fast' ? 0.8 : intent.pace === 'slow' ? 1.25 : 1;
  const [pMin, pMax] = profile.photoRange.map((x) => x * paceMul) as [number, number];
  const T = clamp(config.durationSec, 5, 180);
  const built = buildUnits(assets, profile, config.captions); const dropped = built.dropped;
  const excluded = new Set(config.excludeUnits ?? []);
  const units = built.units.filter((u) => !excluded.has(`${u.assetId}@${u.srcStart.toFixed(1)}`));
  if (excluded.size && units.length < built.units.length) notes.push(`${built.units.length - units.length} shot(s) removed at your request`);
  if (!units.length) throw new Error('Nothing to build a video from: add at least one photo or video.');

  const Mtotal = Math.max(2, Math.floor((T - offset) / beat));
  const kPref = clamp(Math.round(((pMin + pMax) / 2) / beat), 1, 16), kMin = Math.max(1, Math.ceil((pMin * 0.8) / beat));
  const kMaxPhoto = Math.max(kMin, Math.floor((pMax * 2.0) / beat));
  const targetN = Math.max(1, Math.round(Mtotal / kPref));

  // ---- selection: best units first; near-duplicate photos and unusable media are dropped with a stated reason
  const bad = (u: Unit) => u.kind === 'photo' && u.score < 0.14;
  const ranked = [...units].sort((a, b) => b.score - a.score);
  const chosen: Unit[] = [], usedAsset = new Map<string, number>();
  const wantMax = Math.ceil(Mtotal / kMin);                                       // never plan more shots than the minimum length allows
  for (const u of ranked) {
    if (chosen.length >= Math.min(targetN, wantMax)) break;
    if (bad(u) && ranked.some((o) => !bad(o) && !chosen.includes(o))) { dropped.push({ assetId: u.assetId, why: 'very blurry or badly exposed; better material was available' }); continue; }
    if (u.hash) { const twin = chosen.find((c) => c.hash && hamming(c.hash, u.hash!) <= 6); if (twin) { dropped.push({ assetId: u.assetId, why: 'near-duplicate of a better photo' }); continue; } }
    if (u.kind === 'video' && (usedAsset.get(u.assetId) ?? 0) >= Math.max(2, Math.ceil(targetN / Math.max(1, assets.filter((a) => a.kind === 'video').length)))) continue;
    chosen.push(u); usedAsset.set(u.assetId, (usedAsset.get(u.assetId) ?? 0) + 1);
  }
  const usedIds = new Set(chosen.map((c) => c.assetId));
  for (const a of assets) if (a.kind !== 'audio' && !usedIds.has(a.id) && !dropped.some((d) => d.assetId === a.id)) dropped.push({ assetId: a.id, why: 'not needed: lower-scoring than the shots that fit in the duration' });

  const seq = arrange(chosen, config.keepOrder, rand);
  if (config.keepOrder) notes.push('kept your media order');

  // ---- durations in whole beats; videos are limited by the footage they have
  const kLo = seq.map(() => kMin);
  const kHi = seq.map((u) => (u.kind === 'photo' ? kMaxPhoto : Math.max(1, Math.floor((Math.min(u.maxLen, u.speaking ? 14 : profile.videoMax * 1.5) - 0.9) / beat))));
  const k = seq.map((u, i) => clamp(u.speaking ? Math.max(kPref, Math.round(Math.min(u.maxLen, 8) / beat)) : kPref, Math.min(kLo[i], kHi[i]), kHi[i]));
  for (let i = 0; i < k.length; i++) kLo[i] = Math.min(kLo[i], kHi[i]);
  if (config.openingBoost && seq.length > 1) { kHi[0] = Math.max(1, Math.min(kHi[0], Math.round(1.6 / beat))); kLo[0] = Math.min(kLo[0], kHi[0]); k[0] = Math.min(k[0], kHi[0]); notes.push('opening tightened to hook the viewer sooner'); }
  let diff = Mtotal - k.reduce((a, b) => a + b, 0), guard = 0;
  while (diff !== 0 && guard++ < 500) {
    const idx = seq.map((_, i) => i).filter((i) => (diff > 0 ? k[i] < kHi[i] : k[i] > kLo[i]));
    if (!idx.length) break;
    idx.sort((a, b) => diff > 0 ? (seq[b].score - seq[a].score) || (kHi[b] - k[b]) - (kHi[a] - k[a]) : (seq[a].score - seq[b].score) || (k[b] - kLo[b]) - (k[a] - kLo[a]));
    k[idx[0]] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1;
  }
  const beats = k.reduce((a, b) => a + b, 0);
  if (beats < Mtotal) notes.push(`built ${(offset + beats * beat).toFixed(1)}s instead of ${T}s: only ${seq.length} usable shots and the longest comfortable length is reached. Add more media for a longer video.`);

  // ---- transitions (midpoint of each transition sits on a beat)
  const nT = Math.max(0, seq.length - 1); const span = k.map((x) => x * beat);
  const tList = profile.transitions; let tIdx = Math.floor(rand() * tList.length); let lastType = '';
  const trans: ({ type: string; dur: number } | null)[] = [];
  for (let i = 0; i < nT; i++) {
    const SMOOTH = ['fade', 'dissolve', 'smoothleft', 'smoothright', 'fadeblack'], PUNCHY = ['zoomin', 'slideleft', 'wipeleft', 'slideright', 'circleopen'];
    const tl2 = feel === 'smooth' ? SMOOTH : feel === 'punchy' ? PUNCHY : tList;
    const pick = () => tl2[tIdx++ % tl2.length];
    const cut = rand() < (feel === 'smooth' ? 0 : profile.cutRatio) && lastType !== 'cut';                   // never two hard cuts in a row
    let type = cut ? 'cut' : pick(); if (type === lastType) type = pick(); lastType = type;
    const isCut = type === 'cut';
    const base = (isCut ? 2 / FPS : profile.transitionSeconds * (feel === 'smooth' ? 1.5 : feel === 'punchy' ? 0.7 : 1)) * (intent.pace === 'slow' ? 1.2 : intent.pace === 'fast' ? 0.85 : 1);
    trans.push({ type, dur: +clamp(base, 2 / FPS, 0.42 * Math.min(span[i], span[i + 1])).toFixed(3) }); // 'cut' is rendered as a two-frame crossfade
  }
  const cutsAt: number[] = []; let acc = offset; k.forEach((x) => { acc += x * beat; cutsAt.push(+acc.toFixed(4)); });
  const total = cutsAt[cutsAt.length - 1];

  // ---- shots
  const shots: Shot[] = []; const motionOrder: MotionType[] = []; let mi = Math.floor(rand() * profile.motions.length);
  seq.forEach((u, i) => {
    const prevB = i === 0 ? 0 : cutsAt[i - 1], dPrev = i === 0 ? 0 : trans[i - 1]!.dur, dNext = i < nT ? trans[i]!.dur : 0;
    const len = +(cutsAt[i] - prevB + dPrev / 2 + dNext / 2).toFixed(4), start = +(prevB - dPrev / 2).toFixed(4);
    const role: Shot['role'] = i === 0 ? 'opening' : i === seq.length - 1 && seq.length > 1 ? 'closing' : 'body';
    const a = assets.find((x) => x.id === u.assetId)!; const why = [...u.why, `${k[i]} beat${k[i] > 1 ? 's' : ''} (${(k[i] * beat).toFixed(2)} s)`]; if (role === 'opening') why.unshift('opening: strongest shot'); if (role === 'closing') why.unshift('closing shot');
    const shot: Shot = { id: `sh_${i}`, assetId: u.assetId, kind: u.kind, start, len, cutAt: cutsAt[i], srcStart: 0, srcLen: len, layout: 'fill', focus: null, transitionOut: i < nT ? trans[i] : null, role, why: why.join('; ') };
    if (u.kind === 'photo' && a.photo) {
      const R = a.width / a.height, wf = R >= A ? A / R : 1, hf = R >= A ? 1 : R / A; const sb = a.photo.subject;
      const fits = sb.w * 1.12 <= wf && sb.h * 1.12 <= hf;
      shot.layout = fits && (wf >= 0.42 || a.photo.faces.length > 0 || sb.confidence >= 0.5) ? 'fill' : 'layered'; // a narrow crop is only worth it when there is a clear subject to frame shot.focus = { cx: sb.cx, cy: sb.cy, w: sb.w, h: sb.h };
      if (shot.layout === 'layered') shot.why += '; whole photo kept in frame over a blurred fill (cropping would cut the subject)';
      const slackX = 1 - wf, slackY = 1 - hf; let m: MotionType;
      if (role === 'opening' && (a.photo.faces.length || sb.confidence > 0.6)) m = 'subject_focus'; else if (role === 'closing') m = 'zoom_out';
      else { m = profile.motions[mi++ % profile.motions.length]; for (let g = 0; g < 8 && (m === motionOrder[motionOrder.length - 1] || ((m === 'pan_left' || m === 'pan_right') && slackX < 0.14) || ((m === 'pan_up' || m === 'pan_down') && slackY < 0.14)); g++) m = profile.motions[mi++ % profile.motions.length]; }
      shot.motion = m; motionOrder.push(m);
    } else {
      shot.srcStart = u.srcStart; shot.srcLen = len;
      const av = a.video; const src = a.width / a.height;
      shot.videoFraming = (src > A * 1.15 && !(u.face && u.faceX !== null)) ? 'blur' : 'crop'; shot.videoCenterX = u.faceX ?? 0.5;
      if (src < A / 1.15 && A > 1) shot.videoFraming = 'blur';
      void av;
    }
    shots.push(shot);
  });
  // a video shot must never run past its source
  for (const s of shots) if (s.kind === 'video') { const a = assets.find((x) => x.id === s.assetId)!; if (s.srcStart + s.srcLen > a.duration) s.srcStart = Math.max(0, a.duration - s.srcLen); if (s.srcLen > a.duration) { s.srcLen = a.duration; notes.push(`video "${a.name}" is shorter than its slot; its last frame is held`); } }
  return { shots, total: +total.toFixed(3), fps: config.fps ?? FPS, w, h, bpm: grid.bpm, beatOffset: offset, beatSeconds: grid.bpm ? beat : null, musicMood: grid.mood, musicSeed: grid.seed,
    dropped, notes, text: { headline: config.headline?.trim() || undefined, cta: config.cta?.trim() || undefined } };
}
