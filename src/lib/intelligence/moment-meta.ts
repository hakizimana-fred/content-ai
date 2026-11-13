import type { CandidateMoment } from './types';

export type MomentCategory = 'Story' | 'Debate' | 'Humour' | 'Q&A' | 'Strong opener' | 'Conversation' | 'Discussion';

/** Deterministic, explainable category from the signals that selected the moment. */
export function momentCategory(m: CandidateMoment): MomentCategory {
  const tags = m.tags.join('|');
  if (m.text && m.text.humour >= 70) return 'Humour';
  if (tags.includes('Humorous')) return 'Humour';
  if (tags.includes('Question & Answer') || (m.text && m.text.curiosity >= 75)) return 'Q&A';
  if (tags.includes('Dynamic Dialogue') && tags.includes('Rapid Exchange')) return 'Debate';
  if (tags.includes('Punchy Climax')) return 'Story';
  if (tags.includes('High Hook Impact') || tags.includes('Strong Opening Line')) return 'Strong opener';
  if (tags.includes('Rapid Exchange')) return 'Conversation';
  return 'Discussion';
}

export const CATEGORY_STYLE: Record<MomentCategory, string> = {
  Story: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
  Debate: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
  Humour: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  'Q&A': 'bg-sky-500/15 text-sky-200 border-sky-400/30',
  'Strong opener': 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
  Conversation: 'bg-indigo-500/15 text-indigo-200 border-indigo-400/30',
  Discussion: 'bg-zinc-500/15 text-zinc-200 border-zinc-400/30',
};

const LANG_NAMES: Record<string, string> = { en: 'English', sw: 'Swahili', lg: 'Luganda', rw: 'Kinyarwanda', fr: 'French', ar: 'Arabic' };
export const languageName = (code?: string | null) => (code ? LANG_NAMES[code] ?? code.toUpperCase() : 'Unknown');
