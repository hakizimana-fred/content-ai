/**
 * Minimal, dependency-free DSP toolkit for procedural sound design.
 * Everything is deterministic given a seed, runs on any CPU, and needs no model or sample library.
 * Buffers are Float32Array mono at SR; Stereo = { l, r }.
 */
export const SR = 44100;

export interface Stereo { l: Float32Array; r: Float32Array }

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const secToN = (s: number) => Math.max(1, Math.round(s * SR));
export const mono = (seconds: number) => new Float32Array(secToN(seconds));
export const stereo = (seconds: number): Stereo => ({ l: mono(seconds), r: mono(seconds) });

// ---- oscillators ------------------------------------------------------------------------------
export type Wave = 'sine' | 'saw' | 'square' | 'tri';
export function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p);
    case 'saw': return 2 * p - 1;
    case 'square': return p < 0.5 ? 1 : -1;
    default: return 4 * Math.abs(p - 0.5) - 1;
  }
}

/** ADSR envelope value at time t for a note held `hold` seconds (then released). */
export function adsr(t: number, hold: number, a: number, d: number, s: number, r: number): number {
  if (t < 0) return 0;
  if (t < hold) {
    if (t < a) return t / Math.max(1e-6, a);
    if (t < a + d) return 1 - (1 - s) * ((t - a) / Math.max(1e-6, d));
    return s;
  }
  const lvl = hold < a ? hold / Math.max(1e-6, a) : hold < a + d ? 1 - (1 - s) * ((hold - a) / Math.max(1e-6, d)) : s;
  const k = (t - hold) / Math.max(1e-6, r);
  return k >= 1 ? 0 : lvl * (1 - k);
}

// ---- filters (RBJ biquad) ---------------------------------------------------------------------
export type FilterType = 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf';
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  type: FilterType;
  constructor(type: FilterType, freq: number, q = 0.707, gainDb = 0) { this.type = type; this.set(freq, q, gainDb); }
  set(freq: number, q = 0.707, gainDb = 0) {
    const f = Math.min(Math.max(20, freq), SR * 0.45);
    const w0 = (2 * Math.PI * f) / SR, cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / (2 * Math.max(0.05, q));
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (this.type) {
      case 'lp': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'hp': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      case 'lowshelf': { const s2 = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cos + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - s2); a0 = (A + 1) + (A - 1) * cos + s2; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - s2; break; }
      case 'highshelf': { const s2 = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cos + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s2); a0 = (A + 1) - (A - 1) * cos + s2; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s2; break; }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
export function filterBuf(buf: Float32Array, type: FilterType, freq: number, q = 0.707, gainDb = 0): Float32Array {
  const f = new Biquad(type, freq, q, gainDb); const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = f.process(buf[i]);
  return out;
}
/** Simple multi-band EQ: [type, freq, q, gainDb][] */
export function eq(buf: Float32Array, bands: [FilterType, number, number, number][]): Float32Array {
  let o = buf; for (const [t, f, q, g] of bands) o = filterBuf(o, t, f, q, g); return o;
}

// ---- effects ----------------------------------------------------------------------------------
export function delay(buf: Float32Array, timeSec: number, feedback: number, mix: number): Float32Array {
  const d = secToN(timeSec), out = new Float32Array(buf.length), line = new Float32Array(d); let w = 0;
  for (let i = 0; i < buf.length; i++) {
    const wet = line[w]; line[w] = buf[i] + wet * feedback; w = (w + 1) % d;
    out[i] = buf[i] + wet * mix;
  }
  return out;
}

/** Schroeder reverb (4 combs + 2 allpasses). `size` 0..1 scales tail length; `width` offsets the R channel. */
export function reverb(buf: Float32Array, size = 0.5, mix = 0.3, damp = 0.4, width = 0): Float32Array {
  const combT = [0.0297, 0.0371, 0.0411, 0.0437].map((t) => (t * (0.6 + size * 1.6)) * (1 + width * 0.07));
  const apT = [0.005, 0.0017];
  const fb = 0.72 + size * 0.22;
  const combs = combT.map((t) => ({ buf: new Float32Array(secToN(t)), i: 0, lp: 0 }));
  const aps = apT.map((t) => ({ buf: new Float32Array(secToN(t)), i: 0 }));
  const out = new Float32Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n]; let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i]; c.lp = y * (1 - damp) + c.lp * damp; c.buf[c.i] = x + c.lp * fb; c.i = (c.i + 1) % c.buf.length; s += y;
    }
    s *= 0.25;
    for (const a of aps) { const y = a.buf[a.i]; const z = s + y * 0.5; a.buf[a.i] = z; a.i = (a.i + 1) % a.buf.length; s = y - z * 0.5; }
    out[n] = x * (1 - mix) + s * mix * 1.8;
  }
  return out;
}

export function distort(buf: Float32Array, drive: number): Float32Array {
  const out = new Float32Array(buf.length), k = 1 + drive * 12, norm = Math.tanh(k);
  for (let i = 0; i < buf.length; i++) out[i] = Math.tanh(buf[i] * k) / norm;
  return out;
}

/** Feed-forward peak compressor (threshold in linear amplitude). */
export function compress(buf: Float32Array, threshold = 0.4, ratio = 3, attack = 0.01, release = 0.12, makeup = 1): Float32Array {
  const out = new Float32Array(buf.length), a = Math.exp(-1 / (attack * SR)), r = Math.exp(-1 / (release * SR)); let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = Math.abs(buf[i]); env = x > env ? a * env + (1 - a) * x : r * env + (1 - r) * x;
    const g = env > threshold ? (threshold + (env - threshold) / ratio) / env : 1;
    out[i] = buf[i] * g * makeup;
  }
  return out;
}

export function fade(buf: Float32Array, inSec: number, outSec: number): Float32Array {
  const ni = secToN(inSec), no = secToN(outSec);
  for (let i = 0; i < Math.min(ni, buf.length); i++) buf[i] *= i / ni;
  for (let i = 0; i < Math.min(no, buf.length); i++) buf[buf.length - 1 - i] *= i / no;
  return buf;
}

export function gain(buf: Float32Array, g: number): Float32Array { for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; }

/** Add `src` into `dst` starting at `at` seconds, scaled. Safely clipped to dst length. */
export function mixInto(dst: Float32Array, src: Float32Array, atSec: number, g = 1) {
  const start = secToN(atSec);
  for (let i = 0; i < src.length && start + i < dst.length; i++) if (start + i >= 0) dst[start + i] += src[i] * g;
}

export function peak(buf: Float32Array): number { let p = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; } return p; }
export function rms(buf: Float32Array): number { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / Math.max(1, buf.length)); }

/** Peak-normalise a stereo pair together to `target` (linear). */
export function normalise(s: Stereo, target = 0.7): Stereo {
  const p = Math.max(peak(s.l), peak(s.r)); if (p > 1e-6) { const g = target / p; gain(s.l, g); gain(s.r, g); } return s;
}

/** Stereo widen a mono source: Haas delay + slight filtering difference. */
export function widen(m: Float32Array, ms = 12): Stereo {
  const d = secToN(ms / 1000), r = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) r[i] = i >= d ? m[i - d] : 0;
  return { l: m, r };
}

/** 16-bit PCM stereo WAV. */
export function encodeWav(s: Stereo): Buffer {
  const n = s.l.length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s.l[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s.r[i])) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
