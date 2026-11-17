import assert from 'node:assert/strict';
import { planKeep, buildTimeMap, mapTime, remapWords, remapTrack, parseSilences, isIdentityMap } from '../src/lib/studio/pacing.ts';

// 20s clip: leading silence 0-1.5, middle silence 8-10 (2s), tiny pause 12-12.4 (kept), trailing silence 18-20
const sil = [{ start: 0, end: 1.5 }, { start: 8, end: 10 }, { start: 12, end: 12.4 }, { start: 18, end: 20 }];
const keep = planKeep(sil, 20);
assert.deepEqual(keep.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), [[1.32, 8.18], [9.82, 18.18]], 'leading/trailing removed (with pad), middle shortened to a 0.36s gap, short pause kept');
assert.deepEqual(planKeep([], 20), [[0, 20]]); assert.deepEqual(planKeep([{ start: 0, end: 20 }], 20).length, 1, 'all-silent clip never produces an empty plan');
assert.deepEqual(planKeep([{ start: 5, end: 5.5 }], 20), [[0, 20]], 'silences under the threshold are ignored');

const map = buildTimeMap(keep, 1, 20);
assert(Math.abs(map.outDuration - (6.86 + 8.36)) < 0.02); assert(Math.abs(map.removedSeconds - 4.78) < 0.05);
assert(Math.abs(mapTime(map, 1.32)) < 1e-9, 'first kept moment is output time 0');
assert(Math.abs(mapTime(map, 5) - 3.68) < 1e-6);
assert(Math.abs(mapTime(map, 9) - mapTime(map, 8.18)) < 1e-6, 'times inside a removed gap collapse to the cut');
assert(Math.abs(mapTime(map, 9.82) - 6.86) < 1e-6 && Math.abs(mapTime(map, 100) - map.outDuration) < 1e-9);
for (let t = 1.4; t < 8; t += 0.7) assert(mapTime(map, t + 0.5) > mapTime(map, t), 'monotonic');

// speed
const fast = buildTimeMap([[0, 20]], 1.25); assert(Math.abs(fast.outDuration - 16) < 1e-9 && Math.abs(mapTime(fast, 10) - 8) < 1e-9);
assert(isIdentityMap(buildTimeMap([[0, 20]], 1), 20) && !isIdentityMap(fast, 20) && !isIdentityMap(map, 20));
assert.throws(() => buildTimeMap([[0, 1]], 3)); assert.throws(() => buildTimeMap([[0, 1]], 0.2));
const both = buildTimeMap(keep, 1.1); assert(Math.abs(both.outDuration - map.outDuration / 1.1) < 1e-9);

// captions / track follow the same map
const words = [{ text: 'a', start: 100.5, end: 101 }, { text: 'gone', start: 101.6, end: 101.9 }, { text: 'b', start: 108.3, end: 108.8 }, { text: 'c', start: 109.9, end: 110.4 }];
// clip starts at source 100; word 'gone' (1.6-1.9 clip time) is inside leading silence 0-1.5? no, 1.6 > 1.32 so kept; make one that is truly removed:
const removed = remapWords([{ text: 'x', start: 101.0, end: 101.2 }], map, 100); assert.equal(removed.length, 0, 'word fully inside removed time is dropped');
const rw = remapWords(words, map, 100); assert.deepEqual(rw.map((w) => w.text), ['gone', 'c'], "'b' lies inside the removed gap so it is dropped");
assert(Math.abs(rw[1].start - (6.86 + (9.9 - 9.82))) < 0.01, 'word after the cut moves earlier by exactly the removed time');
assert(rw.every((w, i) => i === 0 || w.start >= rw[i - 1].start), 'order kept');
const tr = remapTrack([{ t: 101, x: 0.4 }, { t: 105, x: 0.5 }, { t: 109, x: 0.6 }, { t: 112, x: 0.7 }], map, 100);
assert(tr.length >= 3 && tr[0].t >= 0 && tr.every((k, i) => i === 0 || k.t > tr[i - 1].t), 'track keyframes strictly increasing after remap');

// ffmpeg silencedetect output
const out = `[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 1.52 | silence_duration: 1.52\n[silencedetect @ 0x1] silence_start: 8.01\n[silencedetect @ 0x1] silence_end: 10.0 | silence_duration: 1.99\n[silencedetect @ 0x1] silence_start: 18.2\n`;
assert.deepEqual(parseSilences(out, 20), [{ start: 0, end: 1.52 }, { start: 8.01, end: 10 }, { start: 18.2, end: 20 }], 'trailing open silence runs to the end');
assert.deepEqual(parseSilences('', 20), []);
console.log('pacing tests passed');
