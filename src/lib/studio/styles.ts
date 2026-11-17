import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../editor/captions.ts';
import type { EditingPlan } from './plan.ts';
import type { Grade } from './audio-spec.ts';
import type { SfxKind } from './sonic.ts';

type Plan = EditingPlan;

/** Caption "looks" the plan can request. Built on the existing CaptionStyle so preview and export stay identical. */
export const CAPTION_LOOKS: Record<Plan['captions']['preset'], CaptionStyle> = {
  clean: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter', fontWeight: 700, fontSize: 56, caseMode: 'sentence', outlineWidth: 4, shadow: 0.6, animation: 'line', entrance: 'fade', wordsPerLine: 5, highlightColor: '#FDE047' },
  bold_dynamic: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Anton', fontWeight: 400, fontSize: 78, caseMode: 'upper', outlineWidth: 9, shadow: 0.8, animation: 'word', entrance: 'pop', wordsPerLine: 2, highlightColor: '#22C55E' },
  cinematic: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Montserrat', fontWeight: 600, fontSize: 52, caseMode: 'sentence', outlineWidth: 2, shadow: 0.9, animation: 'line', entrance: 'fade', wordsPerLine: 6, highlightColor: '#FDE68A', textColor: '#F8FAFC' },
  editorial: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Poppins', fontWeight: 700, fontSize: 54, caseMode: 'sentence', bgColor: '#111827', bgOpacity: 0.8, outlineWidth: 0, shadow: 0, animation: 'word', entrance: 'slide', wordsPerLine: 4, highlightColor: '#38BDF8' },
  minimal: { ...DEFAULT_CAPTION_STYLE, fontFamily: 'Inter', fontWeight: 600, fontSize: 50, caseMode: 'sentence', outlineWidth: 0, shadow: 0.9, animation: 'line', entrance: 'fade', wordsPerLine: 6, highlightColor: '#FFFFFF' },
};

export interface StyleDef {
  id: Plan['style'];
  label: string;
  description: string;
  grade: Grade;
  /** Transition sound used at scene changes in this style. */
  transitionSfx: SfxKind;
  /** Default title-card behaviour when an identity does not specify one. */
  titleCard: boolean;
}

export const PRODUCTION_STYLES: Record<Plan['style'], StyleDef> = {
  cinematic_storytelling: { id: 'cinematic_storytelling', label: 'Cinematic Storytelling', description: 'Dramatic grade, atmospheric sound, carefully timed captions', grade: 'cinematic', transitionSfx: 'transition', titleCard: true },
  editorial_news: { id: 'editorial_news', label: 'Editorial News', description: 'Clean grade, strong headline, boxed captions', grade: 'clean', transitionSfx: 'click', titleCard: true },
  podcast_energy: { id: 'podcast_energy', label: 'Podcast Energy', description: 'Speaker tracking, dynamic captions, fast pacing', grade: 'none', transitionSfx: 'click', titleCard: false },
  documentary: { id: 'documentary', label: 'Documentary', description: 'Muted grade, atmospheric sound, deliberate pacing', grade: 'documentary', transitionSfx: 'transition', titleCard: true },
  premium_advertising: { id: 'premium_advertising', label: 'Premium Advertising', description: 'Punchy grade, polished sound design, strong ending', grade: 'clean', transitionSfx: 'whoosh', titleCard: true },
  african_contemporary: { id: 'african_contemporary', label: 'African Contemporary', description: 'Warm grade, bold typography, syncopated percussion', grade: 'warm', transitionSfx: 'electronic_accent', titleCard: true },
};

/** Apply the plan's caption choices on top of a look: position, size and keyword emphasis. */
export function captionStyleFromPlan(plan: Plan, base: CaptionStyle = CAPTION_LOOKS[plan.captions.preset]): CaptionStyle {
  const s: CaptionStyle = { ...base, position: plan.captions.position, fontSize: Math.round(base.fontSize * plan.captions.scale) };
  if (!plan.captions.highlight_keywords) s.highlightColor = s.textColor;
  return s;
}
