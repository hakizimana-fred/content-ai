import assert from 'node:assert/strict';
import { parseTimecodeStrict as p, formatTimecode as f, formatDuration as d, validateSelection as v } from '../src/lib/timecode.ts';

const sec = (s: string) => { const r = p(s); assert(r.ok, `${s} should parse`); return r.ok ? r.seconds : NaN; };
assert.equal(sec('00:02:15'), 135); assert.equal(sec('00:02:15.250'), 135.25);
assert.equal(sec('2:15'), 135); assert.equal(sec('135.5'), 135.5); assert.equal(sec('1:02:15,250'), 3735.25);
assert.equal(sec('  0  '), 0);
for (const bad of ['', '   ', '-1', '-00:00:01', 'abc', '1:2:3:4', '00:61:00', '00:00:75', '1.2345', '1::2', '00:02:15.', '１２']) assert(!p(bad).ok, `${JSON.stringify(bad)} should be rejected`);
assert.equal(f(135.25), '00:02:15.250'); assert.equal(f(0.9996), '00:00:01.000'); assert.equal(f(3735.5), '01:02:15.500'); assert.equal(f(-3), '00:00:00.000');
assert.equal(d(87), '01:27'); assert.equal(d(3723), '1:02:03'); assert.equal(d(2.5), '2.50s');
assert.equal(f(sec(f(1234.567))), '00:20:34.567'); // round-trip

const D = 600;
assert(v(135, 222, D).ok); assert.equal(v(135, 222, D).duration, 87);
assert.match(v(10, 5, D).rangeError!, /before end/); assert.match(v(10, 10, D).rangeError!, /same/);
assert.match(v(-1, 5, D).startError!, /negative/); assert.match(v(0, 601, D).endError!, /beyond/);
assert(v(0, 600.02, D).ok, 'sub-frame float drift tolerated'); assert(!v(0, 600.2, D).ok);
assert.match(v(0, 0.2, D).rangeError!, /too short/); assert(v(0, 2, D).warnings.length === 1);
assert(v(0, 900, 1200).warnings.some((w) => /Long/.test(w)));
assert(!v(null, 5, D).ok && v(null, 5, D).startError);
console.log('timecode tests passed');
