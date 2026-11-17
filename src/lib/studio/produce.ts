import type { EditingPlan } from './plan.ts';
import type { ProductionSettings } from '../../types/video.ts';
import type { CaptionStyle } from '../editor/captions.ts';
import type { PlatformId } from '../editor/platforms.ts';
import type { Identity, IdentityInput } from './identity.ts';
import type { AudioDesignSpec } from './audio-spec.ts';
import type { OverlaySpec } from './overlay.ts';
import { CAPTION_LOOKS, PRODUCTION_STYLES, captionStyleFromPlan } from './styles.ts';
import type { SfxKind } from './sonic.ts';

export interface ProduceContext {
  identity?: Identity | IdentityInput | null;
  /** Used for the title card. */
  title: string;
  hasTranscript: boolean;
  /** Clip-relative times (seconds) of detected scene changes. */
  sceneTimesInClip?: number[];
  seed: number;
  /** Source-time face-tracking keyframes, when available (needed for speaker_tracking). */
  track?: { t: number; x: number }[] | null;
}

export interface ProduceResult {
  production: ProductionSettings;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
  applied: string[];
  skipped: string[];
}

/**
 * Translate a validated EditingPlan (+ optional identity) into the settings the EXISTING renderer understands, and report
 * exactly which plan fields were honoured and which this renderer cannot do yet. Nothing is silently dropped.
 */
export function productionFromPlan(plan: EditingPlan, ctx: ProduceContext): ProduceResult {
  const applied: string[] = [], skipped: string[] = [];
  const id = ctx.identity ?? null;
  const style = PRODUCTION_STYLES[plan.style];

  // ---- format / platform
  const vertical = plan.format !== 'landscape_16_9';
  const platform: PlatformId = vertical ? 'tiktok' : 'youtube';
  const canvas = plan.format === 'square_1_1' ? 'square' as const : plan.format === 'portrait_4_5' ? 'four_five' as const : undefined;
  if (canvas) applied.push(`${plan.format === 'square_1_1' ? '1:1 square' : '4:5'} canvas (landscape sources only; a portrait source is left as is)`);
  else applied.push(`format ${plan.format}`);

  // ---- framing
  let mode = 'center', layout: 'fill' | 'fit' = 'fill';
  switch (plan.framing) {
    case 'speaker_tracking':
      if (ctx.track?.length) { mode = 'auto'; applied.push('speaker tracking (face track available)'); }
      else { mode = 'center'; skipped.push('speaker tracking needs a face track; run Auto Track in Crop, using centre framing for now'); }
      break;
    case 'blur_pad': case 'wide': layout = 'fit'; applied.push('fit with blurred background'); break;
    default: applied.push('centre crop');
  }

  // ---- captions
  let captionStyle = captionStyleFromPlan(plan);
  if (id) {
    captionStyle = { ...captionStyle, fontFamily: id.typography.fontFamily, fontWeight: id.typography.fontWeight, highlightColor: plan.captions.highlight_keywords ? id.colors.accent : id.colors.text, textColor: id.colors.text, ...id.caption.overrides };
    if (id.caption.preset !== plan.captions.preset) captionStyle = { ...captionStyle, ...pickLook(plan.captions.preset) };
    captionStyle = { ...captionStyle, position: plan.captions.position };
    applied.push(`identity "${id.name}" typography & colours`);
  }
  const captionsEnabled = ctx.hasTranscript;
  if (captionsEnabled) applied.push(`captions (${plan.captions.preset}, ${plan.captions.position})`);
  else skipped.push('captions need a transcript; generate one in Media');
  if (plan.captions.highlight_keywords && captionsEnabled) applied.push('keyword highlighting (numbers, names and strong words are coloured)');

  // ---- pacing (renderer has no retiming / silence removal yet)
  if (plan.pacing.remove_silence) applied.push('silence removal (pauses over 0.7 s are shortened; captions, framing and sound follow)');
  if (plan.pacing.speed !== 1) applied.push(`speed ${plan.pacing.speed}×`);

  // ---- sound design + grade
  const grade = id && id.grade !== 'style' ? id.grade : style.grade;
  const cueKind: SfxKind | null = id ? (id.transitions === 'none' ? null : id.transitions === 'punchy' ? 'whoosh' : 'transition') : style.transitionSfx;
  const cues = (ctx.sceneTimesInClip ?? []).slice(0, 6).filter(() => !!cueKind).map((t) => ({ t, kind: cueKind as SfxKind }));
  const audioDesign: AudioDesignSpec = {
    mood: plan.audio.music ? plan.audio.mood : 'none', intensity: plan.audio.intensity, music: plan.audio.music && plan.audio.mood !== 'none',
    musicVolume: plan.audio.music_volume, soundEffects: plan.audio.sound_effects, ducking: plan.audio.ducking, ending: plan.ending.style,
    seed: ctx.seed, sfxCues: cues, signatureSeed: id?.sound.signatureSeed, grade,
  };
  if (audioDesign.music) applied.push(`${plan.audio.mood} music at ${Math.round(plan.audio.music_volume * 100)}% with ${plan.audio.ducking ? 'speech-aware ducking' : 'NO ducking'}`);
  if (plan.audio.sound_effects) applied.push('sound effects');
  if (plan.ending.style !== 'none') applied.push(`ending: ${plan.ending.style}`);
  if (grade !== 'none') applied.push(`colour grade: ${grade} (re-encodes video; adds render time)`);

  // ---- overlays (identity-driven)
  // A logo image replaces the text brand mark in the same corner (both would overlap).
  const full = id as Partial<Identity> | null | undefined;
  const logo = full && full.id && full.logo && id && id.brand.corner !== 'none' ? { identityId: full.id, corner: id.brand.corner } : undefined;
  if (logo) applied.push('logo image');
  let overlays: OverlaySpec | undefined;
  if (id) {
    const o: OverlaySpec = { accent: id.colors.accent, text: id.colors.text, fontFamily: id.typography.fontFamily };
    if (id.opening.style === 'title_card' && ctx.title) { o.title = { text: ctx.title.slice(0, 60), seconds: id.opening.seconds }; }
    if (plan.ending.style !== 'none' && id.ending.text) o.endCard = { text: id.ending.text, seconds: id.ending.seconds };
    if (id.brand.corner !== 'none' && id.brand.text && !logo) o.brand = { text: id.brand.text, corner: id.brand.corner };
    if (o.title || o.endCard || o.brand) { overlays = o; applied.push(['title card', 'end card', 'brand mark'].filter((_, i) => [o.title, o.endCard, o.brand][i]).join(', ')); }
  }

  const production: ProductionSettings = {
    platform, layout,
    framing: { mode, manualX: 0.5, zoom: plan.style === 'cinematic_storytelling' && mode !== 'auto' ? 1.0 : 1, track: mode === 'auto' ? ctx.track ?? null : null },
    captions: captionsEnabled ? { ...captionStyle } : null,
    studio: { audioDesign, overlays, plan, keywordHighlight: plan.captions.highlight_keywords, canvas, logo, pacing: plan.pacing.remove_silence || plan.pacing.speed !== 1 ? { removeSilence: plan.pacing.remove_silence, speed: plan.pacing.speed } : undefined },
  };
  return { production, captionStyle, captionsEnabled, applied, skipped };
}

function pickLook(preset: EditingPlan['captions']['preset']): Partial<CaptionStyle> {
  const l = CAPTION_LOOKS[preset];
  return { fontSize: l.fontSize, caseMode: l.caseMode, animation: l.animation, entrance: l.entrance, wordsPerLine: l.wordsPerLine, bgColor: l.bgColor, bgOpacity: l.bgOpacity, outlineWidth: l.outlineWidth, shadow: l.shadow };
}
