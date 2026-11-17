import { spawn } from 'node:child_process';
import type { AudioAnalysis } from './types.ts';

const SR = 11025, HOP = 256; // ~23 ms per frame

function decode(file: string, seconds: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-t', String(seconds), '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject); p.on('close', (c) => {
      if (c !== 0) return reject(new Error(`ffmpeg ${c}: ${err.slice(-200)}`));
      const b = Buffer.concat(chunks); resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)).slice());
    });
  });
}

/**
 * Onset-strength envelope from three bands (low <150 Hz = kicks/bass, mid, high = hats/plucks). Each band's positive log-energy change is
 * normalised and summed, so a steady kick defines the pulse even when fast hats or arpeggios are louder in the full mix.
 */
export function onsetEnvelope(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP), bands = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const a1 = 1 - Math.exp(-2 * Math.PI * 150 / SR), a2 = 1 - Math.exp(-2 * Math.PI * 2000 / SR); let l1 = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    let e0 = 0, e1 = 0, e2 = 0;
    for (let j = 0; j < HOP; j++) { const v = x[i * HOP + j]; l1 += a1 * (v - l1); l2 += a2 * (v - l2); const lo = l1, mid = l2 - l1, hi = v - l2; e0 += lo * lo; e1 += mid * mid; e2 += hi * hi; }
    bands[0][i] = Math.sqrt(e0 / HOP); bands[1][i] = Math.sqrt(e1 / HOP); bands[2][i] = Math.sqrt(e2 / HOP);
  }
  const env = new Float32Array(n), w = [1.0, 0.6, 0.6];
  bands.forEach((b, k) => {
    const o = new Float32Array(n); let prev = 0, mean = 0;
    for (let i = 0; i < n; i++) { const l = Math.log(1 + 40 * b[i]); o[i] = Math.max(0, l - prev); prev = l * 0.6 + prev * 0.4; mean += o[i]; }
    mean = mean / Math.max(1, n) || 1; for (let i = 0; i < n; i++) env[i] += (w[k] * o[i]) / mean;
  });
  return env;
}

/** Classical tempo + beat-phase estimate: autocorrelation of the onset envelope, then a comb search for the downbeat phase. */
export function estimateTempo(env: Float32Array): AudioAnalysis {
  const fps = SR / HOP, minLag = Math.round(fps * 60 / 180), maxLag = Math.round(fps * 60 / 60);
  const n = env.length; if (n < maxLag * 3) return { bpm: null, beatOffset: 0, confidence: 0 };
  let mean = 0; for (const v of env) mean += v; mean /= n;
  const z = env.map((v) => v - mean);
  const top = Math.min(n - 2, maxLag * 4 + 2), ac = new Float32Array(top + 1); let ac0 = 0; for (let i = 0; i < n; i++) ac0 += z[i] * z[i];
  for (let lag = minLag; lag <= top; lag++) { let s = 0; for (let i = lag; i < n; i++) s += z[i] * z[i - lag]; ac[lag] = s / (ac0 || 1); }
  // Tempo prior (Ellis 2007): listeners hear the pulse near ~110 BPM, so log-tempo is weighted by a Gaussian around it. This resolves
  // half/double-time and 3-against-4 polyrhythm ambiguity toward the felt beat.
  const prior = (lag: number) => { const o = Math.log2(60 * fps / lag / 110); return Math.exp(-0.5 * (o / 0.55) ** 2); };
  let best = minLag, bv = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) { const v = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0) + 0.25 * (ac[lag * 4] ?? 0)) * prior(lag); if (v > bv) { bv = v; best = lag; } }
  const a = ac[best - 1], b = ac[best], c = ac[best + 1]; const d = a - 2 * b + c; const lagF = best + (d !== 0 ? 0.5 * (a - c) / d : 0);
  // Joint refinement of period (+-1.5%) and phase: a coarse period error would otherwise drift the beat grid by ~100 ms over 30 s.
  let period = lagF, bestPhase = 0, pv = -Infinity;
  for (let pr = lagF * 0.985; pr <= lagF * 1.015; pr += lagF * 0.0006) {
    for (let ph = 0; ph < pr; ph += 0.5) {
      let sum = 0; for (let t = ph; t < n - 1; t += pr) { const i = Math.round(t); sum += Math.max(env[i - 1] ?? 0, env[i] ?? 0, env[i + 1] ?? 0); }
      if (sum > pv) { pv = sum; bestPhase = ph; period = pr; }
    }
  }
  const lagFinal = period;
  const conf = Math.max(0, Math.min(1, bv * 1.4));
  return { bpm: +(60 * fps / lagFinal).toFixed(2), beatOffset: +(bestPhase / fps).toFixed(3), confidence: +conf.toFixed(2) };
}

export async function detectTempo(file: string, seconds = 45): Promise<AudioAnalysis> { return estimateTempo(onsetEnvelope(await decode(file, seconds))); }
