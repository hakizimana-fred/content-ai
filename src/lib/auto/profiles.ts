import type { AudioMode, MotionType, StyleChoice } from './types.ts';
import type { Grade } from '../studio/audio-spec.ts';
import type { EditingPlan } from '../studio/plan.ts';
import type { SfxKind } from '../studio/sonic.ts';

export type ConcreteStyle = Exclude<StyleChoice, 'auto'>;
export interface StyleProfile {
  id: ConcreteStyle; label: string;
  /** seconds a still photo stays on screen (before beat quantisation) */
  photoRange: [number, number]; videoMax: number;
  /** ffmpeg xfade names; a short "cut" is a ~2-frame fade */
  transitions: string[]; transitionSeconds: number; cutRatio: number;
  motions: MotionType[]; motionIntensity: 'subtle' | 'medium' | 'strong';
  grade: Grade; transitionSfx: SfxKind; defaultMood: EditingPlan['audio']['mood']; defaultBpm: number;
  caption: EditingPlan['captions']['preset']; textLook: { font: string; upper: boolean };
}
export const STYLE_PROFILES: Record<ConcreteStyle, StyleProfile> = {
  commercial: { id: 'commercial', label: 'Commercial', photoRange: [2.0, 3.2], videoMax: 4.5, transitions: ['smoothleft', 'slideleft', 'zoomin', 'wipeleft', 'smoothright', 'fade'], transitionSeconds: 0.36, cutRatio: 0.2,
    motions: ['zoom_in', 'ken_burns', 'pan_right', 'subject_focus', 'pan_left', 'zoom_out'], motionIntensity: 'medium', grade: 'clean', transitionSfx: 'whoosh', defaultMood: 'advertising', defaultBpm: 118, caption: 'bold_dynamic', textLook: { font: 'Montserrat', upper: true } },
  cinematic: { id: 'cinematic', label: 'Cinematic', photoRange: [3.0, 5.0], videoMax: 6.5, transitions: ['fade', 'dissolve', 'fadeblack', 'dissolve'], transitionSeconds: 0.9, cutRatio: 0,
    motions: ['zoom_in', 'pan_right', 'ken_burns', 'zoom_out', 'pan_left', 'pan_up'], motionIntensity: 'subtle', grade: 'cinematic', transitionSfx: 'transition', defaultMood: 'cinematic', defaultBpm: 76, caption: 'cinematic', textLook: { font: 'Montserrat', upper: false } },
  documentary: { id: 'documentary', label: 'Documentary', photoRange: [3.5, 5.5], videoMax: 8, transitions: ['dissolve', 'fade'], transitionSeconds: 0.7, cutRatio: 0.15,
    motions: ['pan_right', 'zoom_in', 'pan_left', 'pan_down'], motionIntensity: 'subtle', grade: 'documentary', transitionSfx: 'transition', defaultMood: 'documentary', defaultBpm: 80, caption: 'editorial', textLook: { font: 'Inter', upper: false } },
  social: { id: 'social', label: 'Social media', photoRange: [1.4, 2.4], videoMax: 3.5, transitions: ['zoomin', 'slideleft', 'wipeleft', 'slideright', 'circleopen', 'wiperight'], transitionSeconds: 0.24, cutRatio: 0.35,
    motions: ['zoom_in', 'ken_burns', 'subject_focus', 'pan_left', 'zoom_in', 'pan_right'], motionIntensity: 'strong', grade: 'warm', transitionSfx: 'click', defaultMood: 'electronic', defaultBpm: 124, caption: 'bold_dynamic', textLook: { font: 'Anton', upper: true } },
};
export const STYLE_OF_PLAN: Record<EditingPlan['style'], ConcreteStyle> = {
  premium_advertising: 'commercial', cinematic_storytelling: 'cinematic', documentary: 'documentary', podcast_energy: 'social', african_contemporary: 'social', editorial_news: 'documentary',
};

export interface Intent { style: ConcreteStyle; mood: EditingPlan['audio']['mood'] | null; intensity: 'low' | 'medium' | 'high'; pace: 'slow' | 'normal' | 'fast'; why: string[] }

const has = (t: string, re: RegExp) => re.test(t);
/**
 * Maps natural-language intent to a production style + music mood using plain keyword rules (deterministic, offline).
 * Explicit style words win; otherwise the subject of the video decides ("restaurant" -> commercial).
 */
export function interpretIntent(prompt: string, styleChoice: StyleChoice, planStyle?: EditingPlan['style'], planMood?: string): Intent {
  const t = prompt.toLowerCase(); const why: string[] = [];
  let style: ConcreteStyle | null = styleChoice !== 'auto' ? styleChoice : null; if (style) why.push(`style set to ${style} in the options`);
  if (!style) {
    const rules: [RegExp, ConcreteStyle, string][] = [
      [/promo|advert|commercial|restaurant|menu|product|sale|brand|launch|shop|store|offer|luxur|premium/, 'commercial', 'looks like an advertisement (cinematic wording is applied as transitions and grade, not the whole style)'],
      [/cinematic|film(ic)?|dramatic|epic/, 'cinematic', 'asked for a cinematic look'], [/documentar|informative|educational|story of/, 'documentary', 'asked for a documentary feel'], [/tiktok|reel|viral|trend|hook|social media|social/, 'social', 'asked for a social-media feel'],
      [/travel|trip|holiday|vacation|journey|adventure|montage|memor|wedding|family|emotion|story/, 'cinematic', 'travel/personal story reads as cinematic'],
    ];
    for (const [re, s, w] of rules) if (has(t, re)) { style = s; why.push(w); break; }
    if (!style && planStyle) { style = STYLE_OF_PLAN[planStyle]; why.push(`plan style ${planStyle}`); }
    if (!style) { style = 'commercial'; why.push('no style cue; defaulted to commercial'); }
  }
  let mood: Intent['mood'] = null;
  const moods: [RegExp, NonNullable<Intent['mood']>][] = [
    [/african|afro|afrobeat|amapiano/, 'african_fusion'], [/luxur|elegant|sophisticated|premium|upscale/, 'luxury'], [/emotional|heartfelt|nostalg|wedding|sentimental|sad|memor/, 'emotional'],
    [/travel|trip|holiday|vacation|journey|adventure|atmospher/, 'travel'], [/suspens|tense|thriller|mystery/, 'suspense'], [/funny|comedy|playful|humou?r/, 'comedy'], [/tech|futur|digital|startup|software/, 'technology'],
    [/corporate|business|professional/, 'corporate'], [/inspir|motivat|uplift/, 'inspirational'], [/minimal|ambient|calm|relax|peaceful/, 'minimal'], [/documentar/, 'documentary'], [/cinematic|epic|dramatic/, 'cinematic'],
    [/social|tiktok|reel|trend|upbeat|energetic|party/, 'social'], [/restaurant|food|menu|appetis|product|promo|advert|commercial|sale/, 'advertising'],
  ];
  for (const [re, m] of moods) if (has(t, re)) { mood = m; why.push(`music mood "${m}" from the wording`); break; }
  if (!mood && planMood && planMood !== 'none') { mood = planMood as Intent['mood']; why.push(`music mood "${planMood}" from the plan`); }
  const intensity: Intent['intensity'] = has(t, /energetic|upbeat|punchy|powerful|exciting|high[- ]energy|fast/) ? 'high' : has(t, /calm|gentle|soft|subtle|quiet|relax/) ? 'low' : 'medium';
  const pace: Intent['pace'] = has(t, /energetic|fast|quick|punchy|snappy|upbeat/) ? 'fast' : has(t, /slow|calm|relaxed|gentle|smooth|peaceful|lingering/) ? 'slow' : 'normal';
  return { style, mood, intensity, pace, why };
}
export const audioModeNeedsMusic = (m: AudioMode) => m === 'auto' || m === 'library' || m === 'generate';
