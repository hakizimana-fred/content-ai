import type { TranscriptSegmentLike, TextSignal } from './types.ts';

/**
 * Deterministic, explainable transcript features (no paid APIs, no LLMs).
 *
 * Design rules:
 *  1. Text is only trusted in proportion to ASR confidence. Whisper on low-resource
 *     languages (Luganda, Kinyarwanda) often hallucinates loops of nonsense; scoring
 *     that text would reward noise. `transcriptReliability` gates every text feature.
 *  2. Lexicons are small seed lists meant to be extended by labelled data, not a
 *     claim of linguistic completeness. Keep them in one place so they can move to JSON.
 */

type Lang = 'en' | 'sw' | 'lg';

const QUESTION_WORDS: Record<Lang, string[]> = {
  en: ['why', 'how', 'what', 'who', 'when', 'where', 'which', 'really', 'seriously'],
  sw: ['kwa nini', 'kwanini', 'vipi', 'nini', 'nani', 'lini', 'wapi', 'je', 'kweli'],
  lg: ['lwaki', 'ki', 'kiki', 'ani', 'ddi', 'wa', 'ku ngeri ki', 'ddala'],
};

// Words that signal a claim worth stopping for: surprise, stakes, contrast, secrets.
const HOOK_WORDS: Record<Lang, string[]> = {
  en: ['never', 'nobody', 'secret', 'truth', 'mistake', 'worst', 'best', 'biggest', 'shocking',
    'actually', 'but', 'however', 'imagine', 'story', 'died', 'lost', 'won', 'million', 'first time', 'lie'],
  sw: ['kamwe', 'hakuna', 'siri', 'ukweli', 'kosa', 'mbaya', 'kubwa', 'lakini', 'hata hivyo',
    'hadithi', 'alikufa', 'pesa', 'uongo', 'ajabu', 'mara ya kwanza'],
  lg: ['tewali', 'kyama', 'amazima', 'kisobyo', 'kibi', 'ekinene', 'naye', 'olugero',
    'yafa', 'ssente', 'bulimba', 'kyewuunyo', 'omulundi ogwasooka'],
};

const LAUGHTER = /\b(ha(ha)+|he(he)+|hi(hi)+|lol|\[laugh(ter|ing)?\]|\(laugh(ter|ing)?\))\b/i;

// Sentence openers that depend on earlier context ("But that's why…", "Na hivyo…", "Naye kino…").
const CONTEXT_DEPENDENT_OPENERS = [
  'and', 'but', 'so', 'because', 'then', 'that', 'this', 'it', 'he', 'she', 'they',
  'na', 'lakini', 'hivyo', 'kwa hiyo', 'basi', 'huyo', 'hiyo',
  'era', 'naye', 'kale', 'olwo', 'oyo', 'ekyo',
];

const norm = (t: string) => t.toLowerCase().replace(/[.,!?:;"()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

function countPhrases(text: string, phrases: string[]): number {
  const padded = ` ${norm(text)} `;
  let n = 0;
  for (const p of phrases) if (padded.includes(` ${p} `)) n++;
  return n;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/**
 * 0..1 trust in the transcript for [start,end] (whole file if omitted).
 * Combines duration-weighted avg token log-prob, no-speech probability and repetition
 * (Whisper hallucination loops produce many near-identical consecutive segments).
 */
export function transcriptReliability(
  segments: TranscriptSegmentLike[],
  start = 0,
  end = Number.POSITIVE_INFINITY
): number {
  const segs = segments.filter((s) => s.end > start && s.start < end);
  if (segs.length === 0) return 0;

  let wSum = 0;
  let lpSum = 0;
  let nsSum = 0;
  for (const s of segs) {
    const w = Math.max(0.05, s.end - s.start);
    wSum += w;
    lpSum += (s.avg_logprob ?? -0.7) * w; // unknown confidence => assume mediocre, not great
    nsSum += (s.no_speech_prob ?? 0) * w;
  }
  const meanLogprob = lpSum / wSum;
  const meanNoSpeech = nsSum / wSum;

  // avg_logprob: >= -0.4 is clean speech, <= -1.6 is mostly noise for Whisper-family models.
  const confidence = clamp((meanLogprob + 1.6) / 1.2);
  const repetition = repetitionRatio(segs.map((s) => s.text));
  return clamp(confidence * (1 - meanNoSpeech) * (1 - repetition));
}

/** Share of segments that (near-)duplicate another segment. High => ASR loop / hallucination. */
export function repetitionRatio(texts: string[]): number {
  const cleaned = texts.map(norm).filter((t) => t.length > 0);
  if (cleaned.length < 3) return 0;
  const seen = new Map<string, number>();
  for (const t of cleaned) {
    // First 14 chars catches "vannaork solici" / "vannaork soliciti" style drift.
    const key = t.slice(0, 14);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const c of seen.values()) if (c > 1) dup += c - 1;
  return clamp(dup / cleaned.length);
}

/**
 * Score a candidate window's textual attention potential. Returns null if there is
 * no usable text in the window. Every sub-score is 0..100 and individually explainable.
 */
export function scoreWindowText(
  segments: TranscriptSegmentLike[],
  start: number,
  end: number
): TextSignal | null {
  const segs = segments.filter((s) => s.end > start && s.start < end && s.text.trim().length > 0);
  if (segs.length === 0) return null;

  const reliability = transcriptReliability(segments, start, end);
  const allText = segs.map((s) => s.text).join(' ');
  const opening = segs.filter((s) => s.start < start + 5).map((s) => s.text).join(' ');
  const duration = Math.max(1, end - start);
  const langs: Lang[] = ['en', 'sw', 'lg'];

  // --- Hook: does the first ~5s open a curiosity gap / bold claim? ---
  const openQuestion = /\?/.test(opening) || langs.some((l) => countPhrases(opening, QUESTION_WORDS[l]) > 0);
  const openHookHits = langs.reduce((a, l) => a + countPhrases(opening, HOOK_WORDS[l]), 0);
  const openHasNumber = /\d/.test(opening);
  const hookStrength = clamp(0.25 + (openQuestion ? 0.3 : 0) + Math.min(0.35, openHookHits * 0.17) + (openHasNumber ? 0.1 : 0)) * 100;

  // --- Curiosity / Q&A: a question followed by an answer inside the window ---
  const qIdx = segs.findIndex((s) => /\?/.test(s.text));
  const questionAnswer = qIdx >= 0 && qIdx < segs.length - 1;
  const questionCount = segs.filter((s) => /\?/.test(s.text)).length;
  const curiosity = clamp(0.3 + (questionAnswer ? 0.4 : 0) + Math.min(0.3, questionCount * 0.1)) * 100;

  // --- Stakes: hook-lexicon density over the whole clip ---
  const hits = langs.reduce((a, l) => a + countPhrases(allText, HOOK_WORDS[l]), 0);
  const words = norm(allText).split(' ').filter(Boolean).length;
  const stakes = clamp(0.2 + (hits / Math.max(10, words / 8)) * 0.8) * 100;

  // --- Humour / emphasis ---
  const laughter = LAUGHTER.test(allText);
  const exclam = (allText.match(/!/g) ?? []).length;
  const humour = clamp(0.25 + (laughter ? 0.5 : 0) + Math.min(0.25, exclam * 0.08)) * 100;

  // --- Self-containedness: starts a thought, ends a thought ---
  const first = segs[0].text.trim();
  const last = segs[segs.length - 1].text.trim();
  const startsClean = !CONTEXT_DEPENDENT_OPENERS.some((o) => norm(first).startsWith(`${o} `));
  const endsClean = /[.!?]["')\]]?$/.test(last);
  const startsMidSegment = segs[0].start < start - 0.5; // would cut a sentence in half
  const endsMidSegment = segs[segs.length - 1].end > end + 0.5;
  const selfContained = clamp(
    0.4 + (startsClean ? 0.2 : 0) + (endsClean ? 0.25 : 0) - (startsMidSegment ? 0.15 : 0) - (endsMidSegment ? 0.15 : 0)
  ) * 100;

  // --- Pace: words per second; too slow = dead air, too fast = unintelligible ---
  const wps = words / duration;
  const pace = wps >= 1.8 && wps <= 3.8 ? 90 : wps < 1.8 ? clamp(wps / 1.8) * 90 : clamp(1 - (wps - 3.8) / 3) * 90;

  const raw = hookStrength * 0.28 + curiosity * 0.18 + stakes * 0.16 + humour * 0.1 + selfContained * 0.18 + pace * 0.1;

  const reasons: string[] = [];
  if (openQuestion) reasons.push('opens with a question');
  if (openHookHits > 0) reasons.push('opens with a high-stakes claim');
  if (questionAnswer) reasons.push('question is answered inside the clip');
  if (laughter) reasons.push('laughter detected');
  if (!startsClean) reasons.push('starts with a context-dependent connective');
  if (!endsClean) reasons.push('ends mid-thought');
  if (reliability < 0.35) reasons.push('transcript unreliable, text signal down-weighted');

  return {
    score: Math.round(raw),
    reliability: Number(reliability.toFixed(3)),
    hookStrength: Math.round(hookStrength),
    curiosity: Math.round(curiosity),
    stakes: Math.round(stakes),
    humour: Math.round(humour),
    selfContained: Math.round(selfContained),
    pace: Math.round(pace),
    needsPrecedingContext: !startsClean,
    reasons,
  };
}

/**
 * Snap a window outward/inward to sentence (segment) boundaries so a clip never starts
 * or ends mid-sentence. If the opener depends on prior context, pull the start back
 * up to `maxContextSeconds` to include the setup. Result stays within [minDur, maxDur].
 */
export function snapToSpeechBoundaries(
  segments: TranscriptSegmentLike[],
  start: number,
  end: number,
  opts: { minDuration: number; maxDuration: number; maxContextSeconds?: number; videoDuration: number }
): { start: number; end: number; contextAdded: number } {
  const { minDuration, maxDuration, maxContextSeconds = 8, videoDuration } = opts;
  if (segments.length === 0) return { start, end, contextAdded: 0 };

  const pad = 0.15;
  // Start: nearest segment start within ±2.5s.
  let newStart = start;
  const startCand = segments
    .filter((s) => Math.abs(s.start - start) <= 2.5)
    .sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))[0];
  if (startCand) newStart = Math.max(0, startCand.start - pad);

  // Pull back for missing context.
  let contextAdded = 0;
  const openSeg = segments.find((s) => s.end > newStart && s.start >= newStart - 0.5);
  if (openSeg && CONTEXT_DEPENDENT_OPENERS.some((o) => norm(openSeg.text).startsWith(`${o} `))) {
    const prev = [...segments].reverse().find((s) => s.end <= openSeg.start + 0.1 && openSeg.start - s.start <= maxContextSeconds);
    if (prev && end - prev.start <= maxDuration) {
      contextAdded = newStart - Math.max(0, prev.start - pad);
      newStart = Math.max(0, prev.start - pad);
    }
  }

  // End: nearest segment end within ±3s, preferring ones that finish a sentence.
  let newEnd = end;
  const endCands = segments
    .filter((s) => Math.abs(s.end - end) <= 3)
    .sort((a, b) => {
      const sa = /[.!?]$/.test(a.text.trim()) ? 0 : 1;
      const sb = /[.!?]$/.test(b.text.trim()) ? 0 : 1;
      return sa - sb || Math.abs(a.end - end) - Math.abs(b.end - end);
    });
  if (endCands[0]) newEnd = Math.min(videoDuration, endCands[0].end + pad);

  if (newEnd - newStart < minDuration || newEnd - newStart > maxDuration) {
    return { start, end, contextAdded: 0 }; // snapping would break duration constraints; keep original
  }
  return { start: Number(newStart.toFixed(2)), end: Number(newEnd.toFixed(2)), contextAdded: Number(contextAdded.toFixed(2)) };
}
