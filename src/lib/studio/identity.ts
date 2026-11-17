import type { EditingPlan } from './plan.ts';
import { AUDIO_MOODS } from './plan.ts';
import type { CaptionStyle } from '../editor/captions.ts';
import type { Grade } from './audio-spec.ts';
import { PRODUCTION_STYLES } from './styles.ts';

/** A reusable creative identity for one content page. Plain JSON, stored locally. */
export interface Identity {
  id: string;
  name: string;
  colors: { primary: string; accent: string; text: string };
  typography: { fontFamily: string; fontWeight: number };
  caption: { preset: EditingPlan['captions']['preset']; position?: EditingPlan['captions']['position']; overrides: Partial<CaptionStyle> };
  opening: { style: 'none' | 'title_card'; seconds: number };
  ending: { style: EditingPlan['ending']['style']; text: string; seconds: number };
  sound: { signatureSeed: number; mood: EditingPlan['audio']['mood']; preferredMoods: EditingPlan['audio']['mood'][]; sfx: boolean; musicVolume: number };
  transitions: 'none' | 'soft' | 'punchy';
  brand: { text: string; corner: 'tl' | 'tr' | 'bl' | 'br' | 'none' };
  framing: { framing: EditingPlan['framing'] };
  style: EditingPlan['style'];
  grade: Grade | 'style';
  /** Uploaded logo image (stored in storage/studio/logos). Placed at the brand corner. Managed by the upload endpoint, not the edit form. */
  logo?: { ext: 'png' | 'jpg' | 'webp' };
  createdAt: number;
  updatedAt: number;
}

export type IdentityInput = Omit<Identity, 'id' | 'createdAt' | 'updatedAt' | 'logo'>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS = ['Poppins', 'Montserrat', 'Inter', 'Anton', 'Bebas Neue', 'Arial', 'Impact'];
const CORNERS = ['tl', 'tr', 'bl', 'br', 'none'];

export const IDENTITY_TEMPLATES: Record<string, IdentityInput> = {
  africa_unfiltered: {
    name: 'Africa Unfiltered',
    colors: { primary: '#0B0B0F', accent: '#F59E0B', text: '#FFFFFF' },
    typography: { fontFamily: 'Anton', fontWeight: 400 },
    caption: { preset: 'bold_dynamic', position: 'center', overrides: { highlightColor: '#F59E0B', outlineWidth: 10 } },
    opening: { style: 'title_card', seconds: 2.2 },
    ending: { style: 'logo_sting', text: 'AFRICA UNFILTERED', seconds: 2.4 },
    sound: { signatureSeed: 2024, mood: 'african_fusion', preferredMoods: ['african_fusion', 'cinematic', 'electronic'], sfx: true, musicVolume: 0.16 },
    transitions: 'punchy', brand: { text: 'AFRICA UNFILTERED', corner: 'tl' }, framing: { framing: 'speaker_tracking' }, style: 'african_contemporary', grade: 'style',
  },
  clean_editorial: {
    name: 'Clean Editorial',
    colors: { primary: '#0F172A', accent: '#38BDF8', text: '#F8FAFC' },
    typography: { fontFamily: 'Poppins', fontWeight: 700 },
    caption: { preset: 'editorial', overrides: {} },
    opening: { style: 'title_card', seconds: 2 },
    ending: { style: 'clean_fade', text: '', seconds: 2 },
    sound: { signatureSeed: 11, mood: 'news_editorial', preferredMoods: ['news_editorial', 'corporate', 'minimal'], sfx: false, musicVolume: 0.1 },
    transitions: 'soft', brand: { text: '', corner: 'none' }, framing: { framing: 'center' }, style: 'editorial_news', grade: 'style',
  },
};

/** Strict validation for user-supplied identities (rejects instead of silently fixing). */
export function validateIdentity(v: unknown): { ok: true; identity: IdentityInput } | { ok: false; errors: string[] } {
  const e: string[] = [];
  if (typeof v !== 'object' || v === null) return { ok: false, errors: ['identity must be an object'] };
  const o = v as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const str = (p: string, x: unknown, max = 80) => { if (typeof x !== 'string' || x.length > max) { e.push(`${p}: must be a string up to ${max} characters`); return ''; } return x; };
  const hex = (p: string, x: unknown) => { if (typeof x !== 'string' || !HEX.test(x)) { e.push(`${p}: must be a #RRGGBB colour`); return '#000000'; } return x; };
  const num = (p: string, x: unknown, min: number, max: number) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) { e.push(`${p}: must be a number between ${min} and ${max}`); return min; } return x; };
  const oneOf = <T extends string>(p: string, x: unknown, allowed: readonly T[]): T => { if (typeof x === 'string' && (allowed as readonly string[]).includes(x)) return x as T; e.push(`${p}: must be one of ${allowed.join(', ')}`); return allowed[0]; };

  const name = str('name', o.name, 60).trim(); if (!name) e.push('name: required');
  const fontFamily = oneOf('typography.fontFamily', o.typography?.fontFamily, FONTS);
  const id: IdentityInput = {
    name,
    colors: { primary: hex('colors.primary', o.colors?.primary), accent: hex('colors.accent', o.colors?.accent), text: hex('colors.text', o.colors?.text) },
    typography: { fontFamily, fontWeight: num('typography.fontWeight', o.typography?.fontWeight, 300, 900) },
    caption: { preset: oneOf('caption.preset', o.caption?.preset, ['clean', 'bold_dynamic', 'cinematic', 'editorial', 'minimal'] as const), position: o.caption?.position === undefined ? undefined : oneOf('caption.position', o.caption.position, ['top', 'center', 'bottom'] as const), overrides: typeof o.caption?.overrides === 'object' && o.caption.overrides ? o.caption.overrides : {} },
    opening: { style: oneOf('opening.style', o.opening?.style, ['none', 'title_card'] as const), seconds: num('opening.seconds', o.opening?.seconds ?? 2, 0.5, 5) },
    ending: { style: oneOf('ending.style', o.ending?.style, ['none', 'dramatic_resolution', 'clean_fade', 'logo_sting', 'call_to_action'] as const), text: str('ending.text', o.ending?.text ?? '', 80), seconds: num('ending.seconds', o.ending?.seconds ?? 2, 0.5, 6) },
    sound: {
      signatureSeed: Math.round(num('sound.signatureSeed', o.sound?.signatureSeed, 1, 999999)), mood: oneOf('sound.mood', o.sound?.mood, AUDIO_MOODS),
      preferredMoods: Array.isArray(o.sound?.preferredMoods) ? o.sound.preferredMoods.filter((m: unknown) => (AUDIO_MOODS as readonly string[]).includes(m as string)) : [],
      sfx: typeof o.sound?.sfx === 'boolean' ? o.sound.sfx : (e.push('sound.sfx: must be true or false'), false), musicVolume: num('sound.musicVolume', o.sound?.musicVolume, 0, 0.5),
    },
    transitions: oneOf('transitions', o.transitions, ['none', 'soft', 'punchy'] as const),
    brand: { text: str('brand.text', o.brand?.text ?? '', 40), corner: oneOf('brand.corner', o.brand?.corner, CORNERS as unknown as readonly ('tl' | 'tr' | 'bl' | 'br' | 'none')[]) },
    framing: { framing: oneOf('framing.framing', o.framing?.framing, ['center', 'speaker_tracking', 'blur_pad', 'wide'] as const) },
    style: oneOf('style', o.style, Object.keys(PRODUCTION_STYLES) as (keyof typeof PRODUCTION_STYLES)[]),
    grade: oneOf('grade', o.grade ?? 'style', ['style', 'none', 'cinematic', 'documentary', 'clean', 'warm'] as const),
  };
  return e.length ? { ok: false, errors: e } : { ok: true, identity: id };
}

/**
 * Make a plan inherit an identity: its style, framing, caption look/position, sound signature and ending.
 * Explicit choices already in `explicit` (paths such as "audio.mood") are NOT overridden, so the user's words beat the brand.
 */
export function applyIdentityToPlan(plan: EditingPlan, identity: Identity | IdentityInput, explicit: string[] = []): EditingPlan {
  const p: EditingPlan = JSON.parse(JSON.stringify(plan));
  const free = (path: string) => !explicit.includes(path);
  if (free('style')) p.style = identity.style;
  if (free('framing')) p.framing = identity.framing.framing;
  if (free('captions.preset')) p.captions.preset = identity.caption.preset;
  if (free('captions.position') && identity.caption.position) p.captions.position = identity.caption.position;
  if (free('ending.style') && identity.ending.style !== 'none') p.ending.style = identity.ending.style;
  if (p.audio.music && free('audio.mood')) {
    // keep a mood the identity likes; otherwise fall back to its signature mood
    if (!identity.sound.preferredMoods.includes(p.audio.mood)) p.audio.mood = identity.sound.mood;
  }
  if (free('audio.music_volume') && p.audio.music) p.audio.music_volume = identity.sound.musicVolume;
  if (free('audio.sound_effects') && identity.sound.sfx) p.audio.sound_effects = true;
  return p;
}
