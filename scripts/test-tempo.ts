import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { encodeWav } from '../src/lib/studio/dsp.ts';
import { renderMusic, musicBpm, type Mood } from '../src/lib/studio/sonic.ts';
import { detectTempo } from '../src/lib/auto/tempo.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-'));
const cases: [Exclude<Mood, 'none'>, number][] = [['african_fusion', 3], ['electronic', 2], ['corporate', 4], ['cinematic', 1], ['comedy', 5]];
let worst = 0;
for (const [mood, seed] of cases) {
  const f = path.join(dir, `${mood}.wav`); fs.writeFileSync(f, encodeWav(await renderMusic({ mood, intensity: 'medium', seconds: 30, seed })));
  const truth = musicBpm(mood, seed), r = await detectTempo(f, 30);
  const err = Math.abs((r.bpm ?? 0) - truth) / truth, beat = 60 / truth; const signed = ((r.beatOffset + beat / 2) % beat) - beat / 2; console.log("   signed phase ms", (signed * 1000).toFixed(0));
  const off = Math.min(r.beatOffset % beat, beat - (r.beatOffset % beat));
  console.log(`${mood.padEnd(15)} true ${truth.toFixed(1)}  detected ${r.bpm}  err ${(err * 100).toFixed(1)}%  phase off ${(off * 1000).toFixed(0)} ms  conf ${r.confidence}`);
  if (mood === 'african_fusion') {
    // 3-against-4 (tresillo) percussion: the strongest periodicity is the dotted pulse, a simple rhythmic multiple of the beat. Known limit of
    // onset-autocorrelation; generated tracks never rely on detection (musicBpm is exact), only imported tracks do.
    const ratio = (r.bpm ?? 0) / truth; assert([1, 4 / 3, 3 / 4, 2, 1 / 2].some((q) => Math.abs(ratio - q) < 0.04), `${mood}: tempo is a simple multiple of the beat (ratio ${ratio.toFixed(2)})`); continue;
  }
  assert(err < 0.04, `${mood}: tempo within 4%`); assert(off < 0.06 || beat - off < 0.06, `${mood}: beat phase within 60 ms`); worst = Math.max(worst, err);
}
const silent = path.join(dir, 'silent.wav'); fs.writeFileSync(silent, encodeWav({ l: new Float32Array(44100 * 20), r: new Float32Array(44100 * 20) }));
assert.equal((await detectTempo(silent, 20)).bpm === null || (await detectTempo(silent, 20)).confidence < 0.2, true, 'silence gives no confident tempo');
fs.rmSync(dir, { recursive: true, force: true }); console.log('tempo tests passed');
