// Brand Director: turns a brand profile (logo + palette + tagline + placement choices) into concrete creative decisions.
// Deterministic and inspectable. It never edits the logo image; it decides where the logo appears, when, how large, how it enters,
// and recolours the *video* (backgrounds, accents, object colours) from the brand palette.
import type { SceneLook, SceneSpec } from './types.ts';
import type { Identity, LogoStyle } from '../studio/identity.ts';
import { DEFAULT_LOGO_STYLE } from '../studio/identity.ts';
import fs from 'node:fs';
import { getIdentity } from '../studio/identity-store.ts';
import { logoFile } from '../studio/logo-store.ts';

export interface BrandCtx {
  id: string; name: string; tagline?: string; colors: { primary: string; secondary?: string; accent: string; text: string };
  hasLogo: boolean; logoAspect?: number; style: LogoStyle;
}
export const brandOf = (i: Identity): BrandCtx => ({ id: i.id, name: i.brand.text || i.name, tagline: i.tagline, colors: { primary: i.colors.primary, secondary: i.colors.secondary, accent: i.colors.accent, text: i.colors.text },
  hasLogo: !!i.logo, logoAspect: i.logo?.aspect, style: { ...DEFAULT_LOGO_STYLE, ...(i.logoStyle ?? {}) } });

const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t);
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Background colours, accent and text colour derived from the brand palette; text always has readable contrast with the background. */
export function brandPalette(b: BrandCtx): Pick<SceneLook, 'colors' | 'accent' | 'text'> & { light: boolean } {
  const p = rgb(b.colors.primary), s = rgb(b.colors.secondary ?? b.colors.primary), a = rgb(b.colors.accent);
  const light = lum(p) > 175;                                                   // a pale brand gets a light video, not a muddy dark one
  const colors = light ? [mix(p, [255, 255, 255], 0.9), mix(p, [255, 255, 255], 0.75), mix(s, [255, 255, 255], 0.6)] : [mix(p, [0, 0, 0], 0.86), mix(mix(p, s, 0.25), [0, 0, 0], 0.62), mix(mix(s, p, 0.3), [0, 0, 0], 0.3)];
  let acc = a; if (!light && lum(acc) < 90) acc = mix(acc, [255, 255, 255], 0.45); if (light && lum(acc) > 170) acc = mix(acc, [0, 0, 0], 0.4);
  return { colors: colors.map(hex), accent: hex(acc), text: light ? '#14141c' : '#ffffff', light };
}

/** Apply the brand to a finished scene list. Returns new scenes, look overrides and the list of decisions made (shown in the plan). */
export function applyBrand(scenes: SceneSpec[], b: BrandCtx): { scenes: SceneSpec[]; look: Partial<SceneLook>; decided: string[] } {
  const decided: string[] = [], pal = brandPalette(b); const out = scenes.map((s) => ({ ...s }));
  decided.push(`brand "${b.name}": video palette derived from your colours (${b.colors.primary}${b.colors.secondary ? ', ' + b.colors.secondary : ''}, accent ${b.colors.accent}); text is ${pal.light ? 'dark' : 'light'} for contrast`);
  // 3D objects take the brand colours instead of a generic recipe colour
  let oi = 0; for (const s of out) if (s.three) { s.three = { ...s.three, objects: s.three.objects.map((o) => (o.shape === 'glb' || o.shape === 'phone' ? o : { ...o, color: oi++ % 2 === 0 ? pal.accent : b.colors.primary })) }; }
  if (out.some((s) => s.three)) decided.push('3D objects recoloured with the brand accent and primary');
  if (!b.hasLogo) return { scenes: out, look: { colors: pal.colors, accent: pal.accent, text: pal.text } as Partial<SceneLook>, decided: [...decided, 'no logo uploaded: only colours and the brand name were applied'] };

  const st = b.style, intro = out.find((s) => s.kind === 'intro'), outro = out.find((s) => s.kind === 'outro');
  const wide = (b.logoAspect ?? 1) > 2.4;       // wordmarks are shown wider and lower so they stay legible
  if (intro && st.opening) {
    const heroOpen = !intro.title; intro.logo = { role: 'opening', reveal: st.reveal, scale: st.scale * (wide ? 1.1 : 1), hero: heroOpen };
    decided.push(heroOpen ? 'opening: logo reveal alone (the video has no opening title), large and centred' : `opening: ${st.reveal} reveal of the logo above the title, ${Math.round(st.scale * 100)}% size`);
  } else if (!intro && st.opening) { out.unshift({ id: 'intro', kind: 'intro', weight: 1.1, bg: out[0]?.bg ?? 'aurora', logo: { role: 'opening', reveal: st.reveal, scale: st.scale, hero: true } }); decided.push('opening: added a short logo reveal because the video had no opening scene'); }
  if (outro && st.closing) {
    outro.logo = { role: 'closing', reveal: st.reveal, scale: st.scale * (wide ? 1.1 : 1.15), hero: !outro.title && !outro.cta };
    if (b.tagline && !outro.subtitle) outro.subtitle = b.tagline;
    decided.push(`branded ending: logo ${outro.cta ? 'above the call to action' : 'large and centred'}${b.tagline && outro.subtitle === b.tagline ? ', with your tagline beneath' : ''}`);
    if (st.extrude) { outro.kind = 'logo3d'; outro.logo = { ...outro.logo!, extrude: true, hero: false }; outro.three = { objects: [{ shape: 'logo', color: pal.accent, metal: 0.55, gloss: 0.8, spin: { start: -14 } }], floor: -0.85, camera: { orbit: [-6, 6], dolly: [6.4, 5.8], height: 0.3 } }; outro.subtitle = outro.cta ?? outro.subtitle;
      decided.push('closing logo shown as a stylised 3D extrusion (you enabled this; the flat logo is not used in that scene)'); }
  }
  decided.push(st.watermark ? 'logo kept as a small corner mark through the middle of the video' : 'no corner watermark (turned off in the brand profile)');
  return { scenes: out, look: { colors: pal.colors, accent: pal.accent, text: pal.text } as Partial<SceneLook>, decided };
}

/** Attach the stored logo file (and its modification time, so replacing the logo invalidates cached scenes) to every scene that uses it. Scenes that lose their logo file simply render without it. */
export function bindLogo(scenes: SceneSpec[], identityId?: string): { scenes: SceneSpec[]; missing: boolean } {
  const f = identityId ? logoFile(identityId) : null, ver = f ? Math.round(fs.statSync(f).mtimeMs) : 0; let missing = false;
  return { scenes: scenes.map((s) => { if (!s.logo) return s; if (!f) { missing = true; return { ...s, logo: undefined }; } return { ...s, logo: { ...s.logo, file: f, ver } }; }), missing };
}
export const logoWindow = (scenes: { start: number; len: number; scene?: SceneSpec }[]): [number, number] | null => {
  const a = scenes.find((s) => s.scene?.logo?.role === 'opening'), z = scenes.find((s) => s.scene?.logo?.role === 'closing');
  return a || z ? [a ? a.start + a.len : 0, z ? z.start : 1e9] : null;
};
