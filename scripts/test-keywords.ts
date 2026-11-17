import assert from 'node:assert/strict';
import { pickKeywords, normalizeWord } from '../src/lib/studio/keywords.ts';
import { buildAss } from '../src/lib/editor/ass.ts';
import { DEFAULT_CAPTION_STYLE, toTimedWords } from '../src/lib/editor/captions.ts';

const text = "So last year Safaricom lost 40 million shillings because of one terrible mistake. Nobody told the board the truth, and the truth is that the fraud was happening for years. We think it was really just a thing that happened, you know, and the board said okay.";
const words = toTimedWords([{ start: 0, end: 20, text }]);
const kw = pickKeywords(words);
console.log('keywords:', [...kw].join(', '));
for (const w of ['safaricom', '40', 'million', 'mistake', 'truth', 'fraud']) assert(kw.has(w), `${w} should be a keyword`);
for (const w of ['the', 'and', 'that', 'really', 'just', 'you', 'know', 'okay', 'think', 'thing', 'was']) assert(!kw.has(w), `${w} must never be a keyword`);
assert(kw.size <= 14 && kw.size >= 3);
assert.deepEqual([...pickKeywords(words)], [...pickKeywords(words)], 'deterministic');
assert.equal(pickKeywords([]).size, 0); assert.equal(pickKeywords([{ text: 'the' }, { text: 'and' }, { text: 'of' }]).size, 0, 'only filler -> nothing highlighted');
assert.equal(normalizeWord('"Million,"'), 'million'); assert.equal(normalizeWord('40%'), '40%');
// Swahili strong words are recognised, Swahili filler is not
const sw = pickKeywords(toTimedWords([{ start: 0, end: 5, text: 'Sasa hii ni siri kubwa kuhusu pesa na mungu lakini sana' }]));
assert(['siri', 'pesa', 'mungu'].filter((w) => sw.has(w)).length >= 2 && !sw.has('sasa') && !sw.has('lakini') && !sw.has('sana') && !sw.has('kubwa') === !sw.has('kubwa'), 'strong Swahili words picked, Swahili filler not');

// ---- the real ASS builder ----
const opts = { words, clipStart: 0, clipEnd: 20, platform: 'tiktok' as const, playResX: 1080, playResY: 1920 };
const base = { ...DEFAULT_CAPTION_STYLE, highlightColor: '#22C55E', textColor: '#FFFFFF' };
const plain = buildAss({ ...opts, style: { ...base, animation: 'line' } });
const emph = buildAss({ ...opts, style: { ...base, animation: 'line' }, emphasis: kw });
assert(!plain.includes('fscx110'), 'no emphasis unless requested (existing behaviour unchanged)');
const lineWithKw = emph.split('\n').find((l) => /MISTAKE/.test(l))!;
assert(/\\fscx110\\fscy110\}MISTAKE[.,]?\{/.test(lineWithKw), 'MISTAKE is coloured and enlarged');
assert(!/\\fscx110\\fscy110\}(THE|AND|WAS)\{/.test(emph), 'filler is never emphasised');
const wordMode = buildAss({ ...opts, style: { ...base, animation: 'word' }, emphasis: kw });
assert(/\\fscx110/.test(wordMode), 'word animation also emphasises keywords');
const karaoke = buildAss({ ...opts, style: { ...base, animation: 'karaoke' }, emphasis: kw });
assert(!karaoke.includes('fscx110'), 'karaoke is left alone');
assert.equal(plain.split('\n').length, emph.split('\n').length, 'same number of caption events');
console.log('keyword tests passed');
