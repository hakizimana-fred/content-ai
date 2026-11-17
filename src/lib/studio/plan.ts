/**
 * Editing plan: the ONLY thing the Creative Director (LLM or rules) may output.
 * The deterministic engine (ffmpeg) executes validated plans; models never touch media.
 */
export const FORMATS = ['vertical_9_16', 'square_1_1', 'landscape_16_9', 'portrait_4_5'] as const;
export const STYLES = ['cinematic_storytelling', 'editorial_news', 'podcast_energy', 'documentary', 'premium_advertising', 'african_contemporary'] as const;
export const FRAMINGS = ['center', 'speaker_tracking', 'blur_pad', 'wide'] as const;
export const CAPTION_PRESETS = ['clean', 'bold_dynamic', 'cinematic', 'editorial', 'minimal'] as const;
export const CAPTION_POSITIONS = ['top', 'center', 'bottom'] as const;
export const AUDIO_MOODS = ['cinematic', 'corporate', 'luxury', 'documentary', 'suspense', 'inspirational', 'electronic', 'african_fusion', 'minimal', 'technology', 'comedy', 'emotional', 'advertising', 'news_editorial', 'travel', 'social', 'none'] as const;
export const INTENSITIES = ['low', 'medium', 'high'] as const;
export const ENDING_STYLES = ['none', 'dramatic_resolution', 'clean_fade', 'logo_sting', 'call_to_action'] as const;

type OneOf<T extends readonly string[]> = T[number];

export interface EditingPlan {
  format: OneOf<typeof FORMATS>;
  duration_target: number; // seconds
  style: OneOf<typeof STYLES>;
  framing: OneOf<typeof FRAMINGS>;
  pacing: { remove_silence: boolean; speed: number }; // speed 0.9..1.25
  captions: { preset: OneOf<typeof CAPTION_PRESETS>; position: OneOf<typeof CAPTION_POSITIONS>; highlight_keywords: boolean; scale: number };
  audio: { mood: OneOf<typeof AUDIO_MOODS>; intensity: OneOf<typeof INTENSITIES>; music: boolean; music_volume: number; sound_effects: boolean; ducking: boolean };
  ending: { style: OneOf<typeof ENDING_STYLES> };
}

export const DEFAULT_PLAN: EditingPlan = {
  format: 'vertical_9_16',
  duration_target: 45,
  style: 'podcast_energy',
  framing: 'speaker_tracking',
  pacing: { remove_silence: false, speed: 1 },
  captions: { preset: 'bold_dynamic', position: 'center', highlight_keywords: true, scale: 1 },
  audio: { mood: 'none', intensity: 'medium', music: false, music_volume: 0.15, sound_effects: false, ducking: true },
  ending: { style: 'none' },
};

export type ValidationResult = { ok: true; plan: EditingPlan; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate untrusted JSON (e.g. LLM output) against the plan schema.
 * Missing fields fall back to `base` (used for partial refinements); wrong types / unknown enum values are errors.
 * Numeric ranges are rejected, not silently clamped, so a bad model output is never "repaired" into something unintended.
 */
export function validatePlan(input: unknown, base: EditingPlan = DEFAULT_PLAN): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['plan must be a JSON object'] };

  const known = new Set(['format', 'duration_target', 'style', 'framing', 'pacing', 'captions', 'audio', 'ending']);
  for (const k of Object.keys(input)) if (!known.has(k)) warnings.push(`ignored unknown field "${k}"`);

  const pickEnum = <T extends readonly string[]>(path: string, v: unknown, allowed: T, fallback: T[number]): T[number] => {
    if (v === undefined) return fallback;
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T[number];
    errors.push(`${path}: "${String(v)}" is not one of ${allowed.join(', ')}`);
    return fallback;
  };
  const pickNum = (path: string, v: unknown, min: number, max: number, fallback: number): number => {
    if (v === undefined) return fallback;
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
    errors.push(`${path}: must be a number between ${min} and ${max}`);
    return fallback;
  };
  const pickBool = (path: string, v: unknown, fallback: boolean): boolean => {
    if (v === undefined) return fallback;
    if (typeof v === 'boolean') return v;
    errors.push(`${path}: must be true or false`);
    return fallback;
  };
  const section = (path: string, v: unknown): Record<string, unknown> => {
    if (v === undefined) return {};
    if (isObj(v)) return v;
    errors.push(`${path}: must be an object`);
    return {};
  };

  const pacing = section('pacing', input.pacing);
  const captions = section('captions', input.captions);
  const audio = section('audio', input.audio);
  const ending = section('ending', input.ending);

  const plan: EditingPlan = {
    format: pickEnum('format', input.format, FORMATS, base.format),
    duration_target: pickNum('duration_target', input.duration_target, 5, 180, base.duration_target),
    style: pickEnum('style', input.style, STYLES, base.style),
    framing: pickEnum('framing', input.framing, FRAMINGS, base.framing),
    pacing: {
      remove_silence: pickBool('pacing.remove_silence', pacing.remove_silence, base.pacing.remove_silence),
      speed: pickNum('pacing.speed', pacing.speed, 0.9, 1.25, base.pacing.speed),
    },
    captions: {
      preset: pickEnum('captions.preset', captions.preset, CAPTION_PRESETS, base.captions.preset),
      position: pickEnum('captions.position', captions.position, CAPTION_POSITIONS, base.captions.position),
      highlight_keywords: pickBool('captions.highlight_keywords', captions.highlight_keywords, base.captions.highlight_keywords),
      scale: pickNum('captions.scale', captions.scale, 0.6, 2, base.captions.scale),
    },
    audio: {
      mood: pickEnum('audio.mood', audio.mood, AUDIO_MOODS, base.audio.mood),
      intensity: pickEnum('audio.intensity', audio.intensity, INTENSITIES, base.audio.intensity),
      music: pickBool('audio.music', audio.music, base.audio.music),
      music_volume: pickNum('audio.music_volume', audio.music_volume, 0, 1, base.audio.music_volume),
      sound_effects: pickBool('audio.sound_effects', audio.sound_effects, base.audio.sound_effects),
      ducking: pickBool('audio.ducking', audio.ducking, base.audio.ducking),
    },
    ending: { style: pickEnum('ending.style', ending.style, ENDING_STYLES, base.ending.style) },
  };

  // Cross-field rules.
  if (plan.audio.music && plan.audio.mood === 'none') errors.push('audio: music is enabled but mood is "none"');
  if (!plan.audio.music && plan.audio.mood !== 'none') warnings.push('audio: mood set but music is off; mood will be unused');
  if (plan.audio.music && !plan.audio.ducking) warnings.push('audio: music without ducking may overpower dialogue');
  if (plan.audio.music && plan.audio.music_volume > 0.35 && plan.audio.ducking === false) errors.push('audio: music_volume above 0.35 requires ducking');

  return errors.length ? { ok: false, errors } : { ok: true, plan, warnings };
}

/** Which top-level sections differ — lets the UI/engine re-run only what changed on a refinement. */
export function diffPlan(a: EditingPlan, b: EditingPlan): string[] {
  return (Object.keys(a) as (keyof EditingPlan)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
