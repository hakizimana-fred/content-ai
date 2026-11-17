import type { BgType, Composition, Motif, SceneFx, SceneKind, SceneLook, SceneSpec, TypeFont } from './types.ts';

/**
 * Creative directions: each one is a complete, different way of making a video (palette, background family, type, layout
 * vocabulary, texture, motif and pacing). The Director (model or keywords) picks one; the renderer makes it look different.
 */
export interface Direction {
  id: string; name: string; blurb: string;
  colors: string[]; accent: string; text: string; font: TypeFont; upper: boolean; anim: SceneLook['anim']; speed: number;
  bgs: BgType[]; motif: Motif; fx: SceneFx; transitions: 'smooth' | 'punchy' | 'cinematic';
  comps: Partial<Record<SceneKind, Composition[]>>;
  match: RegExp;
}
const fx = (grain: number, leak: number, blur: number, vignette: number, bars = false): SceneFx => ({ grain, leak, blur, vignette, bars });

export const DIRECTIONS: Direction[] = [
  { id: 'kinetic_pop', name: 'Kinetic pop', blurb: 'big type slamming on the beat, warm saturated colour, fast', colors: ['#14060a', '#3a0e12', '#9a2d12'], accent: '#ffb020', text: '#fff8ee', font: 'bold', upper: true, anim: 'words', speed: 1.3,
    bgs: ['waves', 'beams', 'bokeh', 'waves'], motif: 'blocks', fx: fx(0.15, 0.4, 0.2, 0.5), transitions: 'punchy',
    comps: { intro: ['slam', 'stack'], text: ['slam', 'stack', 'split'], outro: ['slam'], product: ['cards'], infographic: ['bignum', 'default'], quote: ['default'] },
    match: /restaurant|food|menu|tasty|appetis|appetiz|chef|cafe|energetic|party|festival|summer|sale|offer|african|afro|kente|ankara|uganda|kampala|swahili|nairobi|lagos|tiktok|reel|viral|hype|punchy/ },
  { id: 'editorial_luxe', name: 'Editorial luxe', blurb: 'serif type, soft bokeh and light leaks, slow and spacious', colors: ['#080706', '#17120b', '#4f3d17'], accent: '#d4af37', text: '#f6f0de', font: 'elegant', upper: false, anim: 'fade_up', speed: 0.7,
    bgs: ['bokeh', 'gradient', 'bokeh', 'contours'], motif: 'orbits', fx: fx(0.35, 0.8, 0.5, 0.65), transitions: 'smooth',
    comps: { intro: ['left', 'default'], text: ['default', 'wave'], outro: ['default'], product: ['default'], infographic: ['donuts', 'default'], quote: ['bar', 'default'] },
    match: /luxur|premium|elegan|sophisticat|gold|upscale|jewel|fashion|boutique|perfume|spa|wellness|wedding|morning|coffee|tea\b|calm|serene/ },
  { id: 'tech_grid', name: 'Tech grid', blurb: 'monospace type, neon grid and geometry, parallax shapes', colors: ['#03040b', '#08112e', '#27227a'], accent: '#6ee7ff', text: '#ffffff', font: 'tech', upper: true, anim: 'letters', speed: 1,
    bgs: ['grid', 'geo', 'contours', 'geo'], motif: 'diagonals', fx: fx(0.1, 0, 0.3, 0.55), transitions: 'punchy',
    comps: { intro: ['stack', 'left'], text: ['stack', 'split'], outro: ['default'], product: ['cards'], infographic: ['donuts', 'bignum'], quote: ['bar'] },
    match: /futur|tech|\bai\b|digital|cyber|neon|robot|software|startup|electronic|sci-?fi|app\b|saas|data|code|developer|platform/ },
  { id: 'cinematic_film', name: 'Cinematic film', blurb: 'letterbox bars, heavy grain, volumetric light beams, slow dissolves', colors: ['#040408', '#0f0f1b', '#33243f'], accent: '#e9c46a', text: '#f4f1ea', font: 'elegant', upper: false, anim: 'fade_up', speed: 0.6,
    bgs: ['beams', 'bokeh', 'contours', 'beams'], motif: 'none', fx: fx(0.7, 0.6, 0.7, 0.8, true), transitions: 'cinematic',
    comps: { intro: ['default', 'left'], text: ['default'], outro: ['default'], product: ['default'], infographic: ['default'], quote: ['default', 'bar'] },
    match: /cinematic|dramatic|film|epic|moody|trailer|noir|suspens|thriller/ },
  { id: 'clean_corporate', name: 'Clean corporate', blurb: 'crisp sans type, soft gradient meshes, cards and big numbers', colors: ['#050a18', '#0a1d45', '#1c4ed0'], accent: '#60a5fa', text: '#ffffff', font: 'modern', upper: false, anim: 'words', speed: 0.9,
    bgs: ['mesh', 'gradient', 'mesh', 'waves'], motif: 'dots', fx: fx(0.05, 0.15, 0.2, 0.4), transitions: 'smooth',
    comps: { intro: ['left', 'default'], text: ['default', 'split'], outro: ['default'], product: ['cards'], infographic: ['donuts', 'default'], quote: ['bar'] },
    match: /corporate|business|finance|bank|consult|professional|b2b|enterprise|insurance|law\b|invest/ },
  { id: 'organic_calm', name: 'Organic calm', blurb: 'flowing waves and bokeh, gentle sans type, cool natural colour', colors: ['#04120d', '#0b3a2c', '#0f6b56'], accent: '#86efac', text: '#f2fff8', font: 'modern', upper: false, anim: 'fade_up', speed: 0.75,
    bgs: ['waves', 'bokeh', 'mesh', 'waves'], motif: 'rings', fx: fx(0.25, 0.35, 0.4, 0.55), transitions: 'smooth',
    comps: { intro: ['default', 'left'], text: ['wave', 'default'], outro: ['default'], product: ['default'], infographic: ['default', 'donuts'], quote: ['default'] },
    match: /nature|eco|green|organic|farm|garden|forest|ocean|travel|beach|sea|island|holiday|vacation|journey|health|yoga|mindful/ },
];
export const DEFAULT_DIRECTION: Direction = { id: 'modern_gradient', name: 'Modern gradient', blurb: 'aurora and mesh colour, clean type, rings', colors: ['#04050d', '#0b1033', '#3b2a8c'], accent: '#7c5cff', text: '#ffffff', font: 'modern', upper: false, anim: 'words', speed: 1,
  bgs: ['aurora', 'mesh', 'gradient', 'aurora'], motif: 'rings', fx: fx(0.3, 0.5, 0.4, 0.55), transitions: 'smooth',
  comps: { intro: ['default', 'left'], text: ['default', 'split', 'wave'], outro: ['default'], product: ['default', 'cards'], infographic: ['default', 'donuts'], quote: ['default', 'bar'] }, match: /$^/ };
export const ALL_DIRECTIONS = [...DIRECTIONS, DEFAULT_DIRECTION];
export const directionById = (id?: string) => ALL_DIRECTIONS.find((d) => d.id === id);
export const pickDirection = (prompt: string): Direction => DIRECTIONS.find((d) => d.match.test(prompt.toLowerCase())) ?? DEFAULT_DIRECTION;

/** Which compositions each scene kind actually supports in the renderer (validation whitelist). */
export const COMPOSITIONS: Partial<Record<SceneKind, Composition[]>> = {
  intro: ['default', 'slam', 'stack', 'left'], text: ['default', 'slam', 'stack', 'split', 'wave'], quote: ['default', 'bar'], product: ['default', 'cards'],
  infographic: ['default', 'bignum', 'donuts'], outro: ['default', 'slam'],
};

/** Apply a direction's look and layout vocabulary to a planned scene list. Deterministic; varies compositions and backgrounds scene to scene. */
export function lookFromDirection(d: Direction, base?: Partial<SceneLook>): SceneLook {
  return { colors: [...d.colors], accent: d.accent, text: d.text, font: d.font, upper: d.upper || d.font === 'bold', anim: d.anim, speed: d.speed, dim: 0.45, name: d.name, direction: d.id, fx: { ...d.fx }, motif: d.motif, ...base };
}
export function styleScenes(scenes: SceneSpec[], d: Direction, keepBg = false): SceneSpec[] {
  const used: Record<string, number> = {}; let bi = 0;
  return scenes.map((s) => {
    const out = { ...s }; const opts = (d.comps[s.kind] ?? []).filter((c) => (COMPOSITIONS[s.kind] ?? []).includes(c));
    if (opts.length && !out.composition) { const n = (used[s.kind] = (used[s.kind] ?? -1) + 1); out.composition = opts[n % opts.length]; }
    if (out.composition && !(COMPOSITIONS[s.kind] ?? []).includes(out.composition)) out.composition = undefined;
    if (!keepBg && out.bg !== 'asset') out.bg = d.bgs[bi++ % d.bgs.length];
    return out;
  });
}
