// Musical form for the Sonic Engine. Given a duration and a recipe's traits, this plans a complete piece: opening, development, breakdown,
// build-up, climax, variation and resolution, with a harmonic progression per section, an energy curve, which layers play when, the
// transitions between sections (fills, risers, impacts, drop-out gaps) and an evolving melody derived from ONE motif.
// Pure and deterministic (seeded): no audio here, so the whole structure is unit-testable. sonic.ts renders what this plans.
import { rng } from './dsp.ts';

export type SectionKind = 'intro' | 'development' | 'breakdown' | 'build' | 'climax' | 'variation' | 'resolution';
export type Form = 'dramatic' | 'elegant' | 'modern' | 'minimal' | 'steady';

/** What a recipe can actually play. The planner only schedules layers the recipe has. */
export interface Traits {
  build: boolean; drive: boolean; perc: boolean; bass: boolean; arp: boolean; piano: boolean;
  scaleLen: number; progLen: number; form: Form; liftable: boolean;
  altProg?: number[];
}
export interface Layers { pad: number; bass: number; perc: number; arp: number; piano: number; lead: number; bell: number; tex: number }
export interface BarPlan {
  bar: number; section: SectionKind; idx: number; len: number; energy: number;
  /** scale degree of this bar's chord (0 = tonic) and key shift in semitones */
  chord: number; keyShift: number;
  layers: Layers;
  fill: boolean; riser: boolean; sweepDown: boolean; impact: boolean; gap: boolean; first: boolean; last: boolean; padOnly: boolean;
  cadence: 'none' | 'half' | 'final'; busy: boolean;
}
export interface Section { kind: SectionKind; start: number; bars: number }
export interface Plan { bar: number; bars: number; tail: number; seconds: number; sections: Section[]; perBar: BarPlan[]; form: Form }

export interface PlanInput { seconds: number; bpm: number; seed: number; traits: Traits; introPadSec?: number; outroPadSec?: number }

const WEIGHT: Record<SectionKind, number> = { intro: 1, development: 1.8, breakdown: 0.8, build: 1.2, climax: 1.6, variation: 1.4, resolution: 1 };
const ENERGY: Record<SectionKind, [number, number]> = {
  intro: [0.25, 0.4], development: [0.5, 0.62], breakdown: [0.2, 0.26], build: [0.55, 0.92], climax: [0.95, 1], variation: [0.7, 0.78], resolution: [0.45, 0.12],
};
const DYN: Record<Form, number> = { dramatic: 1.1, modern: 1, steady: 0.75, elegant: 0.65, minimal: 0.45 };

function template(seconds: number, cap: boolean, mainBars: number): SectionKind[] {
  if (mainBars < 6) return ['intro', cap ? 'build' : 'development', 'resolution'];
  if (seconds < 24) return cap ? ['intro', 'development', 'build', 'climax', 'resolution'] : ['intro', 'development', 'variation', 'resolution'];
  if (seconds < 50) {
    const br = seconds >= 38;
    return cap ? (br ? ['intro', 'development', 'breakdown', 'build', 'climax', 'resolution'] : ['intro', 'development', 'build', 'climax', 'resolution'])
      : (br ? ['intro', 'development', 'breakdown', 'variation', 'resolution'] : ['intro', 'development', 'variation', 'resolution']);
  }
  if (seconds < 75) return cap ? ['intro', 'development', 'breakdown', 'build', 'climax', 'resolution'] : ['intro', 'development', 'breakdown', 'variation', 'resolution'];
  return cap ? ['intro', 'development', 'variation', 'breakdown', 'build', 'climax', 'variation', 'resolution']
    : ['intro', 'development', 'breakdown', 'variation', 'development', 'variation', 'resolution'];
}

/** Whole-bar allocation: proportional to weight, snapped to phrases (2 bars) when there is room, always summing to the bar budget. */
function allocate(kinds: SectionKind[], total: number, weights: number[]): number[] {
  const unit = total >= 20 ? 2 : 1, sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.max(unit, Math.round((w / sum) * total / unit) * unit));
  let diff = total - out.reduce((a, b) => a + b, 0), guard = 0;
  const order = kinds.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  while (diff !== 0 && guard++ < 200) {
    for (const i of order) {
      if (diff === 0) break;
      if (diff > 0) { out[i] += Math.min(unit, diff); diff -= Math.min(unit, diff); }
      else if (out[i] - unit >= unit) { out[i] -= unit; diff += unit; } else if (out[i] > 1 && unit === 1) { out[i] -= 1; diff += 1; }
    }
  }
  return out;
}

export function planArrangement(inp: PlanInput): Plan {
  const { seconds, bpm, seed, traits: T } = inp, R = rng(seed * 31 + 7);
  const bar = (60 / bpm) * 4, tailTarget = 1.4;
  let bars = Math.max(3, Math.round((seconds - tailTarget) / bar));
  while (bars > 3 && bars * bar > seconds - 0.6) bars--;
  const tail = seconds - bars * bar;
  const cap = T.build && T.form !== 'minimal';
  const maxPad = Math.min(4, Math.floor(bars * 0.15));                 // padding frames the piece; it never squeezes the music itself
  const introPad = Math.max(0, Math.min(maxPad, Math.round((inp.introPadSec ?? 0) / bar))), outroPad = Math.max(0, Math.min(maxPad, Math.round((inp.outroPadSec ?? 0) / bar)));
  const mainBars = Math.max(3, bars - introPad - outroPad);
  const kinds = template(seconds, cap, mainBars);
  const w = kinds.map((k) => {
    let x = WEIGHT[k];
    if (T.form === 'dramatic') x *= k === 'build' ? 1.4 : k === 'intro' ? 1.2 : k === 'climax' ? 1.15 : 1;
    if (T.form === 'modern') x *= k === 'intro' ? 0.7 : k === 'variation' ? 1.15 : 1;
    if (T.form === 'elegant') x *= k === 'intro' ? 1.2 : k === 'resolution' ? 1.3 : k === 'breakdown' ? 1.2 : 1;
    return x * (0.92 + R() * 0.16);                       // each seed phrases the sections a little differently
  });
  const lens = allocate(kinds, mainBars, w);
  const sections: Section[] = []; let at = 0;
  if (introPad) { sections.push({ kind: 'intro', start: 0, bars: introPad }); at = introPad; }
  kinds.forEach((k, i) => { const extra = k === 'resolution' ? outroPad : 0; sections.push({ kind: k, start: at, bars: lens[i] + extra }); at += lens[i] + extra; });
  while (at < bars) { sections[sections.length - 1].bars += 1; at += 1; }

  // ---------- harmony ----------
  const perBar: BarPlan[] = [];
  const dyn = DYN[T.form] * (T.build ? 1 : 0.75);
  const lastClimax = [...sections].reverse().find((s) => s.kind === 'climax') ?? [...sections].reverse().find((s) => s.kind === 'variation' && s.start > bars * 0.5);
  const lift = T.liftable && seconds >= 60 && !!lastClimax;
  for (const [si, s] of sections.entries()) {
    const next = sections[si + 1];
    for (let j = 0; j < s.bars; j++) {
      const b = s.start + j, [e0, e1] = ENERGY[s.kind], e = Math.max(0.05, Math.min(1, 0.5 + (e0 + (e1 - e0) * ((j + 0.5) / s.bars) - 0.5) * dyn));
      const isLast = b === bars - 1, padOnly = si === 0 && introPad > 0 && j < introPad;
      const lastOfSection = j === s.bars - 1;
      const L = layersFor(s.kind, j, s.bars, T);
      if (padOnly) { L.bass = 0; L.perc = 0; L.arp = 0; L.piano = 0; L.lead = 0; L.bell = 0; }
      const nextHot = !!next && (next.kind === 'build' || next.kind === 'climax' || next.kind === 'variation') && ENERGY[next.kind][0] > e + 0.05;
      const keyShift = lift && lastClimax && s.start >= lastClimax.start ? 2 : 0;
      perBar.push({
        bar: b, section: s.kind, idx: j, len: s.bars, energy: e, chord: 0, keyShift, layers: L,
        fill: lastOfSection && !isLast && nextHot && T.perc && s.bars >= 2,
        riser: s.kind === 'build' && T.build && j >= s.bars - 2 && s.bars >= 3,
        sweepDown: s.kind === 'breakdown' && j === 0,
        impact: (s.kind === 'climax' || (s.kind === 'variation' && s.start > 0 && sections[si - 1]?.kind === 'breakdown')) && j === 0 && cap,
        gap: s.kind === 'build' && lastOfSection && T.build && T.perc && s.bars >= 3,
        first: b === 0, last: isLast, padOnly,
        cadence: isLast ? 'final' : (s.kind === 'build' && lastOfSection) || (b === bars - 2) ? 'half' : 'none',
        busy: (s.kind === 'climax' || s.kind === 'variation') && (T.drive || T.form === 'dramatic'),
      });
    }
  }
  return { bar, bars, tail, seconds, sections, perBar, form: T.form };
}

function layersFor(k: SectionKind, j: number, len: number, T: Traits): Layers {
  const half = j >= Math.floor(len / 2), last2 = j >= len - 2;
  switch (k) {
    case 'intro': return { pad: 0.8, bass: T.bass && len >= 3 && half ? 0.6 : 0, perc: 0, arp: 0, piano: T.piano && j % 2 === 0 ? 0.6 : 0, lead: j >= 1 || len === 1 ? 0.55 : 0, bell: 0, tex: 1 };
    case 'development': return { pad: 0.8, bass: 0.85, perc: 0.6, arp: half || len < 3 ? 0.7 : 0, piano: 0.6, lead: 0.8, bell: 0, tex: 0.6 };
    case 'breakdown': return { pad: 1, bass: j === 0 ? 0.4 : 0, perc: 0, arp: 0.6, piano: 0.9, lead: 0.5, bell: 0.6, tex: 1 };
    case 'build': return { pad: 0.9, bass: 1, perc: 0.7 + 0.3 * (j / Math.max(1, len - 1)), arp: 0.9, piano: 0.5, lead: 0.85, bell: 0, tex: 0.5 };
    case 'climax': return { pad: 1, bass: 1, perc: 1, arp: 1, piano: 0.6, lead: 1, bell: 0.8, tex: 0.3 };
    case 'variation': return { pad: 0.85, bass: 0.9, perc: 0.75, arp: 0.8, piano: 0.7, lead: 0.85, bell: 0.5, tex: 0.5 };
    case 'resolution': return { pad: 1, bass: last2 ? 0.5 : 0.65, perc: j === 0 && len > 2 ? 0.4 : 0, arp: 0, piano: 0.9, lead: 0.7, bell: last2 ? 0.5 : 0, tex: 0.8 };
  }
}

/** Chord degree for every bar, given the recipe's progression. Sections use different harmonic rhythms and progressions; the ending is a real cadence. */
export function assignHarmony(plan: Plan, prog: number[], T: Traits): void {
  const n = prog.length, dom = T.scaleLen >= 7 ? 4 : Math.min(3, T.scaleLen - 1);
  const rot = (xs: number[], k: number) => xs.map((_, i) => xs[(i + k) % xs.length]);
  const A = prog, B = rot(prog, 2), alt = T.altProg && T.altProg.length === n ? T.altProg : B;
  for (const p of plan.perBar) {
    let d: number;
    switch (p.section) {
      case 'development': d = (plan.sections.filter((s) => s.kind === 'development').findIndex((s) => s.start === p.bar - p.idx) % 2 === 1 ? B : A)[p.idx % n]; break;
      case 'breakdown': d = A[Math.floor(p.idx / 2) % n]; break;                 // slower harmonic rhythm: each chord lasts two bars
      case 'build': d = p.idx >= p.len - 1 ? dom : [A[0], A[1 % n], A[2 % n], A[3 % n]][p.idx % 4]; break;
      case 'variation': d = alt[p.idx % n]; break;
      case 'resolution': d = A[(p.idx + 1) % n]; break;
      default: d = A[p.idx % n];
    }
    if (p.cadence === 'half' && p.section !== 'build' && p.bar === plan.bars - 2) d = dom;                 // V leading into the final I
    if (p.cadence === 'final') d = 0;                                                                      // the piece lands on the tonic
    p.chord = d;
  }
}

// ======================================================= melody =======================================================
export interface NoteEv { s: number; d: number; deg: number; v: number }
type Treatment = 'state' | 'sparse' | 'frag' | 'aug' | 'inv' | 'retro' | 'seq' | 'hi';

const RHYTHMS: Record<string, [number, number][]> = {
  long: [[0, 6], [6, 2], [8, 4], [12, 4], [16, 6], [22, 2], [24, 8]],
  sync: [[0, 4], [4, 4], [10, 2], [12, 4], [16, 3], [19, 3], [24, 4], [28, 4]],
  sparse: [[0, 8], [8, 8], [16, 6], [22, 2], [24, 8]],
  drive: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4], [16, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
  pickup: [[2, 2], [4, 6], [10, 2], [12, 4], [16, 2], [18, 6], [26, 2], [28, 4]],
};

/** One two-bar motif: a rhythm cell plus a contour of scale steps. Everything else in the piece is derived from it. */
export function makeMotif(seed: number, scaleLen: number, drive: boolean): NoteEv[] {
  const R = rng(seed * 101 + 3);
  const keys = drive ? ['sync', 'drive', 'pickup', 'sync'] : ['long', 'sparse', 'long', 'pickup'];
  const rh = RHYTHMS[keys[Math.floor(R() * keys.length)]];
  const shape = Math.floor(R() * 4);                       // 0 arch, 1 rise, 2 fall, 3 wave
  let deg = scaleLen + [0, 2, 4][Math.floor(R() * 3)];
  const lo = scaleLen - 1, hi = scaleLen * 2 + 2, ev: NoteEv[] = [];
  rh.forEach(([s, d], k) => {
    const prog = k / (rh.length - 1);
    const bias = shape === 0 ? (prog < 0.5 ? 0.35 : -0.4) : shape === 1 ? 0.25 : shape === 2 ? -0.25 : (k % 2 ? -0.3 : 0.3);
    const step = R() < 0.18 ? (R() < 0.5 ? -2 : 2) : R() < 0.5 + bias * 0.5 ? 1 : -1;
    if (k > 0) deg = Math.max(lo, Math.min(hi, deg + (R() < 0.12 ? 0 : step)));
    ev.push({ s, d, deg, v: s % 8 === 0 ? 1 : 0.8 });
  });
  return ev;
}

const nearestChordTone = (deg: number, chord: number, len: number): number => {
  let best = deg, bd = 99; const base = Math.floor(deg / len) * len;          // search around the note's own octave, so a high note stays high
  for (const k of [0, 2, 4]) for (const o of [-len, 0, len]) { const c = chord + k + base + o; const dd = Math.abs(c - deg); if (dd < bd) { bd = dd; best = c; } }
  return best;
};

function transform(m: NoteEv[], t: Treatment, n: number, len: number): NoteEv[] {
  const first = m[0]?.deg ?? len;
  switch (t) {
    case 'state': return m.map((e) => ({ ...e }));
    case 'seq': return m.map((e) => ({ ...e, deg: e.deg + n }));
    case 'inv': return m.map((e) => ({ ...e, deg: 2 * first - e.deg + n }));
    case 'retro': { const ds = m.map((e) => e.deg + n).reverse(); return m.map((e, i) => ({ ...e, deg: ds[i] })); }
    case 'hi': return m.map((e) => ({ ...e, deg: e.deg + len + n }));
    case 'sparse': return m.filter((_, i) => i % 2 === 0).map((e) => ({ ...e, d: Math.min(16, e.d * 2), v: e.v * 0.75, deg: e.deg + n }));
    case 'frag': return m.filter((e) => e.s < 16).map((e) => ({ ...e, deg: e.deg + n })).concat(m.slice(-1).map((e) => ({ ...e, s: 24, d: 8, deg: e.deg + n })));
    case 'aug': return m.filter((e) => e.s * 2 < 32).map((e) => ({ ...e, s: e.s * 2, d: Math.min(16, e.d * 2), v: e.v * 0.8, deg: e.deg + n }));
  }
}

const TREAT: Record<SectionKind, [Treatment, number][]> = {
  intro: [['sparse', 0], ['frag', -1], ['sparse', 1]],            // a hint of the hook, a step lower, so the full statement in the development is a genuine arrival
  development: [['state', 0], ['seq', 1], ['inv', 0], ['seq', 2], ['retro', 0], ['seq', -1], ['inv', 1], ['seq', 3]],
  breakdown: [['aug', 0], ['sparse', 2], ['aug', 1]],
  build: [['seq', 1], ['seq', 2], ['hi', 0], ['hi', 1]],
  climax: [['hi', 0], ['hi', 1], ['hi', 0], ['inv', 3]],            // the hook restated an octave up is deliberate; the units after it develop it
  variation: [['inv', 1], ['retro', 1], ['seq', 2], ['inv', 0]],
  resolution: [['aug', 0], ['frag', 0], ['aug', -1]],
};

/** Melody events for every bar: the motif, transformed per two-bar unit so nothing is simply looped, harmonised to each bar's chord, ending on the tonic. */
export function composeMelody(plan: Plan, seed: number, scaleLen: number, drive: boolean): NoteEv[][] {
  const motif = makeMotif(seed, scaleLen, drive), out: NoteEv[][] = plan.perBar.map(() => []);
  const counters: Partial<Record<SectionKind, number>> = {};
  for (const sec of plan.sections) {
    const treat = TREAT[sec.kind], c0 = counters[sec.kind] ?? 0;
    for (let u = 0; u * 2 < sec.bars; u++) {
      const [t, n] = treat[(c0 + u) % treat.length], idxShift = Math.floor((c0 + u) / treat.length);
      const ev = transform(motif, t, n + idxShift, scaleLen);
      for (let h = 0; h < 2; h++) {
        const bi = sec.start + u * 2 + h; if (bi >= sec.start + sec.bars) break;
        const bp = plan.perBar[bi], vel = bp.layers.lead; if (vel <= 0) continue;
        out[bi] = ev.filter((e) => e.s >= h * 16 && e.s < h * 16 + 16).map((e) => {
          const s = e.s - h * 16, strong = s % 8 === 0;
          const deg = strong ? nearestChordTone(e.deg, bp.chord, scaleLen) : e.deg;
          return { s, d: Math.min(e.d, 16 - s), deg, v: e.v * vel };
        });
        // a bar is never an exact copy of the one before it: if the transform collapsed onto the same figure, move it to a neighbouring tone
        const prev = bi > 0 ? out[bi - 1] : [];
        if (out[bi].length && prev.length && barSignature(out[bi]) === barSignature(prev)) {
          const weak = out[bi].filter((e) => e.s % 8 !== 0);
          if (weak.length) weak.forEach((e) => { e.deg += 1; });
          else { const e = out[bi][out[bi].length - 1]; e.deg = nearestChordTone(e.deg + 3, bp.chord, scaleLen); }
        }
      }
    }
    counters[sec.kind] = c0 + Math.ceil(sec.bars / 2);
  }
  // an ending that resolves: the final bar is one long tonic note, the bar before steps down towards it
  const L = plan.bars - 1;
  if (L >= 1) {
    const pre = plan.perBar[L - 1].layers.lead > 0 ? nearestChordTone(scaleLen + 1, plan.perBar[L - 1].chord, scaleLen) : null;
    if (pre !== null) out[L - 1] = [{ s: 0, d: 6, deg: scaleLen + 2, v: 0.7 }, { s: 8, d: 8, deg: pre, v: 0.65 }];
    out[L] = [{ s: 0, d: 16, deg: scaleLen, v: 0.75 }];
  }
  return out;
}

/** A compact fingerprint of one bar's melody, used by tests and the "no artificial repetition" guarantee. */
export const barSignature = (ev: NoteEv[]) => ev.map((e) => `${e.s}:${e.d}:${e.deg}`).join('|');
