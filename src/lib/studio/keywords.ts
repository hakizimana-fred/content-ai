/**
 * Keyword picking for caption emphasis. Classical, offline, deterministic: numbers, proper nouns, strong/emotive words and
 * topical repeats score higher; common words never qualify. Works on any transcript words ({ text } is enough).
 */
const STOP = new Set(`a about above after again all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers him his how i i'd i'll i'm i've if in into is isn't it it's its just let's like me more most my no nor not of off on once only or other our out over own same she should shouldn't so some such than that that's the their them then there there's these they they're this those through to too under until up very was wasn't we we're were weren't what what's when where which while who whom why will with won't would wouldn't you you'd you'll you're you've your yeah okay oh um uh get got going gonna really actually basically thing things know think mean want said say says one two kind lot much many even still way back well now right
na ya wa kwa ni la za kama pia au lakini hii huu hizi hao yake yangu yetu sana tu bado sasa hapo hivyo kwamba nini nani wapi`.split(/\s+/));

const STRONG = new Set(`never always nothing everything secret truth lie lies million billion trillion free money cash rich poor broke love hate dead death kill war power crisis danger risk fear angry biggest worst best greatest impossible incredible shocking insane crazy mistake failure success win lose lost won fraud scam stolen proof exposed warning urgent breaking history future change
pesa mungu kamwe siri ukweli vita kifo upendo hatari`.split(/\s+/));

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'%$]/gu, '').replace(/^'+|'+$/g, '');
export const normalizeWord = norm;

export function pickKeywords(words: { text: string }[], opts: { ratio?: number; max?: number } = {}): Set<string> {
  const counts = new Map<string, number>();
  for (const w of words) { const n = norm(w.text); if (n) counts.set(n, (counts.get(n) ?? 0) + 1); }
  const score = new Map<string, number>();
  words.forEach((w, i) => {
    const n = norm(w.text);
    if (!n || STOP.has(n) || (n.length < 3 && !/\d/.test(n))) return;
    let s = score.get(n) ?? 0;
    if (/\d/.test(n)) s = Math.max(s, 3);                                   // numbers, money, percentages
    const prev = words[i - 1]?.text ?? '.';
    if (/^\p{Lu}[\p{L}'-]+$/u.test(w.text.replace(/[^\p{L}'-]/gu, '')) && !/[.!?]$/.test(prev) && i > 0) s = Math.max(s, 2.5); // proper noun mid-sentence
    if (STRONG.has(n)) s = Math.max(s, 3);                                  // strong / emotive vocabulary
    if (n.length >= 8) s += 0.75;
    else if (n.length >= 6) s += 0.4;
    const c = counts.get(n) ?? 1; if (c >= 2 && c <= 4) s += 0.6;           // topical repeats (not filler)
    score.set(n, s);
  });
  const unique = [...score.entries()].filter(([, s]) => s >= 1.1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const budget = Math.min(opts.max ?? 14, Math.max(1, Math.round(counts.size * (opts.ratio ?? 0.18))));
  return new Set(unique.slice(0, budget).map(([w]) => w));
}
