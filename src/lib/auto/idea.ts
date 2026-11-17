import type { AutoConfig, BgType, SceneKind, SceneLook, SceneSpec, SceneStat, TypeFont } from './types.ts';

/**
 * Local Creative Director for Idea-to-Video / Mixed Media. Deterministic keyword + pattern rules (no network, no model):
 * it turns the instruction into scene structure, a visual look and the text for each scene.
 * Honesty rule: every word that appears on screen comes from the user (quoted text, headline/CTA fields, the subject phrase of the
 * instruction, style words they wrote, numbers they gave). Nothing about a business is invented; gaps are filled with text-free
 * animated scenes and reported.
 */
export interface IdeaPlan { scenes: SceneSpec[]; look: SceneLook; notes: string[]; decided: string[] }

const has = (t: string, re: RegExp) => re.test(t);
const ACCENTS: [RegExp, string][] = [[/\bred\b/, '#ef4444'], [/\bblue\b/, '#3b82f6'], [/\bpurple|violet\b/, '#a855f7'], [/\bgreen\b/, '#22c55e'], [/\bgold(en)?\b/, '#d4af37'], [/\borange\b/, '#f97316'], [/\bpink\b/, '#ec4899'], [/\bcyan|teal\b/, '#22d3ee'], [/\byellow\b/, '#facc15']];

interface Palette { name: string; colors: string[]; accent: string; text: string; font: TypeFont; upper: boolean; anim: SceneLook['anim']; bgs: BgType[]; speed: number }
const PALETTES: [RegExp, Palette][] = [
  [/futur|tech|\bai\b|digital|cyber|neon|robot|software|startup|electronic|sci-?fi/, { name: 'futuristic dark', colors: ['#03040b', '#0a1030', '#2b1f7a'], accent: '#6ee7ff', text: '#ffffff', font: 'modern', upper: true, anim: 'words', bgs: ['grid', 'aurora', 'particles', 'aurora'], speed: 1 }],
  [/luxur|premium|elegan|sophisticat|gold|upscale|jewel|fashion/, { name: 'luxury', colors: ['#050505', '#14110a', '#4a3a14'], accent: '#d4af37', text: '#f6f0de', font: 'elegant', upper: false, anim: 'fade_up', bgs: ['gradient', 'particles', 'gradient', 'solid'], speed: 0.7 }],
  [/african|afro|kente|ankara|uganda|kampala|swahili|nairobi|lagos/, { name: 'African contemporary', colors: ['#0d0a05', '#3a1d0b', '#14532d'], accent: '#f59e0b', text: '#fff7e6', font: 'bold', upper: true, anim: 'words', bgs: ['waves', 'gradient', 'particles', 'waves'], speed: 1.1 }],
  [/restaurant|food|menu|tasty|appetis|appetiz|chef|cafe|energetic|party|festival|summer|sale|offer/, { name: 'warm energetic', colors: ['#12060a', '#3a0e12', '#8a2a10'], accent: '#ffb020', text: '#fff8ee', font: 'bold', upper: true, anim: 'words', bgs: ['waves', 'particles', 'gradient', 'waves'], speed: 1.25 }],
  [/nature|eco|green|organic|farm|garden|forest/, { name: 'nature', colors: ['#04120a', '#0b3a1f', '#14532d'], accent: '#86efac', text: '#f2fff6', font: 'modern', upper: false, anim: 'fade_up', bgs: ['aurora', 'waves', 'gradient'], speed: 0.8 }],
  [/ocean|travel|beach|sea|island|holiday|vacation|journey/, { name: 'ocean', colors: ['#031018', '#06364a', '#0e7490'], accent: '#67e8f9', text: '#f0fcff', font: 'modern', upper: false, anim: 'fade_up', bgs: ['waves', 'aurora', 'gradient'], speed: 0.8 }],
  [/corporate|business|finance|bank|consult|professional/, { name: 'corporate', colors: ['#050a18', '#0b1f4a', '#1d4ed8'], accent: '#60a5fa', text: '#ffffff', font: 'modern', upper: false, anim: 'words', bgs: ['gradient', 'aurora', 'waves'], speed: 0.9 }],
  [/cinematic|dramatic|film|epic|moody/, { name: 'cinematic', colors: ['#050509', '#12121c', '#3a2a4a'], accent: '#e9c46a', text: '#f5f5f5', font: 'elegant', upper: false, anim: 'fade_up', bgs: ['aurora', 'gradient', 'particles'], speed: 0.65 }],
];
const DEFAULT_PALETTE: Palette = { name: 'modern dark', colors: ['#04050d', '#0b1033', '#3b2a8c'], accent: '#7c5cff', text: '#ffffff', font: 'modern', upper: false, anim: 'words', bgs: ['aurora', 'gradient', 'particles', 'waves'], speed: 1 };
const DESCRIPTORS = ['futuristic', 'elegant', 'modern', 'cinematic', 'bold', 'premium', 'luxurious', 'powerful', 'simple', 'smart', 'fast', 'dynamic', 'creative', 'innovative', 'beautiful', 'fresh', 'authentic'];

const titleCase = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => (w === w.toUpperCase() && w.length <= 4 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
export const quotedStrings = (p: string) => [...p.matchAll(/["“]([^"”]{2,120})["”]/g)].map((m) => m[1].trim());

/** The thing the video is about, in the user's own words ("for an AI technology company" -> "AI Technology Company"). */
export function subjectPhrase(prompt: string): string | null {
  const m = /\b(?:for|about|promoting|showcasing|featuring|introducing)\s+(?:an?\s+|the\s+|our\s+|my\s+)?([^.,;:!?"“”\n]{3,70})/i.exec(prompt); if (!m) return null;
  let s = m[1].split(/\s+(?:use|using|with|that|which|and then|make|in|on|featuring|including)\s+/i)[0].trim();
  s = s.replace(/\b(video|advert(isement)?|ad|promo|clip|montage)\b/gi, '').replace(/\s+/g, ' ').trim();
  const words = s.split(' ').slice(0, 4); return words.length && words.join('').length >= 3 ? titleCase(words.join(' ')) : null;
}

/** Only what the user explicitly asked for (named accent colour, light background, monospace, letter animation) plus refinement overrides. */
export function explicitOverrides(prompt: string, cfg: AutoConfig): Partial<SceneLook> {
  const t = prompt.toLowerCase(), o: Partial<SceneLook> = {}, c = cfg.look ?? {};
  const a = ACCENTS.find(([re]) => re.test(t)); if (a) o.accent = a[1];
  if (has(t, /monospace|terminal|code|hacker/)) o.font = 'tech'; if (has(t, /typewriter|letter by letter|letters/)) o.anim = 'letters';
  if (c.font) o.font = c.font; if (c.accent) o.accent = c.accent; if (c.anim) o.anim = c.anim;
  if (c.light || has(t, /light background|white background|bright background|clean white/)) { o.colors = ['#f6f6f8', '#e8e9ef', '#d5d8e6']; o.text = '#111322'; }
  return o;
}

export function pickLook(prompt: string, cfg: AutoConfig): SceneLook {
  const t = prompt.toLowerCase(); const pal = PALETTES.find(([re]) => re.test(t))?.[1] ?? DEFAULT_PALETTE;
  const look: SceneLook = { colors: [...pal.colors], accent: pal.accent, text: pal.text, font: pal.font, upper: pal.upper, anim: pal.anim, speed: pal.speed, dim: 0.45, name: pal.name };
  const explicit = ACCENTS.find(([re]) => re.test(t)); if (explicit) { look.accent = explicit[1]; look.name += `, ${explicit[1]} accent`; }
  if (has(t, /light background|white background|bright background|clean white/)) { look.colors = ['#f6f6f8', '#e8e9ef', '#d5d8e6']; look.text = '#111322'; look.name = 'light'; }
  if (has(t, /monospace|terminal|code|hacker/)) look.font = 'tech';
  if (has(t, /typewriter|letter by letter|letters/)) look.anim = 'letters';
  const o = cfg.look ?? {};
  if (o.font) look.font = o.font; if (o.accent) look.accent = o.accent; if (o.anim) look.anim = o.anim;
  if (o.light) { look.colors = ['#f6f6f8', '#e8e9ef', '#d5d8e6']; look.text = '#111322'; look.name = 'light'; }
  look.upper = look.upper || look.font === 'bold';
  return look;
}

export function stats(prompt: string): SceneStat[] {
  const out: SceneStat[] = [];
  for (const m of prompt.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|x\b)?\s*(?:times\s+)?([a-z][a-z ]{2,22}?)(?=\s*(?:[.,;:!?\n]|$|\band\b|\bwith\b|\buse\b|\bmake\b|\bin\b))/gi)) {
    const label = m[3].trim(); if (/^(-?\s*)?(second|sec|minute|min|hour|scene|slide|frame|word|photo|picture|image|clip)s?\b/i.test(label) || /^-/.test(label)) continue;
    const v = parseFloat(m[1].replace(',', '.')); if (!Number.isFinite(v) || v <= 0 || v > 1e6) continue;
    out.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: v, suffix: m[2] === '%' ? '%' : m[2] ? 'x' : undefined, max: m[2] === '%' ? 100 : undefined });
  }
  return out.slice(0, 4);
}
export const bulletsOf = (p: string) => { const m = /(?:features?|highlights?|benefits?|key points?)\s*[:\-]\s*([^.\n]+)/i.exec(p); return m ? m[1].split(/,|;|\band\b/i).map((x) => x.trim()).filter((x) => x.length > 1 && x.length < 48).slice(0, 5) : []; };

/** Plan scenes for a generated video. `beatsHint` = number of beats available (more beats -> more scenes). */
export function directIdea(prompt: string, cfg: AutoConfig, opts: { seconds: number; beat: number; mixed: boolean; creativeAssets?: { id: string; kind: string; name: string }[] }): IdeaPlan {
  const notes: string[] = [], decided: string[] = [];
  const look = pickLook(prompt, cfg); decided.push(`look: ${look.name}, ${look.font} type`);
  const quotes = quotedStrings(prompt), subject = subjectPhrase(prompt), t = prompt.toLowerCase();
  const quoteTxt = /\bquote\b[^"\u201C]{0,14}["\u201C]([^"\u201D]{2,160})["\u201D]/i.exec(prompt)?.[1].trim(); const isQuote = !!quoteTxt;
  const attrib = quoteTxt ? /[-–—]\s*([A-Z][^.\n"”]{2,40})\s*$/.exec(prompt)?.[1] : undefined;
  const textLines = quotes.filter((q) => q !== quoteTxt);
  const title = cfg.headline?.trim() || textLines[0] || subject || undefined;
  const bullets = bulletsOf(prompt), st = stats(prompt);
  const descr = DESCRIPTORS.filter((d) => new RegExp(`\\b${d}\\b`).test(t)).map((d) => titleCase(d) + '.').slice(0, 3);
  const bgs = cfg.look?.bg ? [cfg.look.bg] : (PALETTES.find(([re]) => re.test(t))?.[1] ?? DEFAULT_PALETTE).bgs;
  const user = (opts.creativeAssets ?? []).filter((a) => a.kind !== 'model').slice(0, 4);

  const body: { kind: SceneKind; weight: number; patch: Partial<SceneSpec> }[] = [];
  if (!opts.mixed) {
    let li = isQuote ? 0 : 1;
    const lines = textLines.filter((x) => x !== title);
    for (const l of lines.slice(0, 4)) { body.push({ kind: 'text', weight: 0.9, patch: { title: l } }); body.push({ kind: 'abstract', weight: 0.6, patch: {} }); li++; }
    if (bullets.length) body.push({ kind: 'product', weight: 1.7, patch: { title: subject ?? title ?? undefined, bullets } });
    if (st.length) body.push({ kind: 'infographic', weight: 1.6, patch: { title: subject ?? undefined, stats: st } });
    if (quoteTxt) body.push({ kind: 'quote', weight: 1.5, patch: { quote: quoteTxt, attribution: attrib } });
    if (!lines.length && descr.length) for (const d of descr) { body.push({ kind: 'text', weight: 0.8, patch: { title: d } }); body.push({ kind: 'abstract', weight: 0.7, patch: {} }); }
    for (const a of user) body.push({ kind: a.kind === 'footage' ? 'footage' : 'image', weight: 1.2, patch: { creativeAssetId: a.id, bg: 'asset' } });
    if (!body.length) { body.push({ kind: 'abstract', weight: 1, patch: {} }, { kind: 'abstract', weight: 1, patch: {} }, { kind: 'abstract', weight: 1, patch: {} }); notes.push('Your instruction contains no text to show, so the middle of the video uses animated, text-free scenes. Add quoted phrases, "features: a, b, c" or numbers like "50% faster" to get text and chart scenes.'); }
  } else {
    if (bullets.length) body.push({ kind: 'product', weight: 1.7, patch: { title: subject ?? title ?? undefined, bullets } });
    if (st.length) body.push({ kind: 'infographic', weight: 1.6, patch: { title: subject ?? undefined, stats: st } });
    if (quoteTxt) body.push({ kind: 'quote', weight: 1.5, patch: { quote: quoteTxt, attribution: attrib } });
    for (const l of textLines.filter((x) => x !== title).slice(0, 3)) body.push({ kind: 'text', weight: 0.9, patch: { title: l } });
  }

  const cta = cfg.cta?.trim() || undefined;
  const intro: SceneSpec = { id: 'intro', kind: 'intro', weight: 1.3, bg: bgs[0], title, subtitle: !opts.mixed && descr[0] ? descr[0].replace(/\.$/, '') : undefined };
  if (!title) notes.push('No title found in your instruction. Put the brand or topic in the headline field, or say "for <your brand>" to get an opening title.');
  const outro: SceneSpec = { id: 'outro', kind: 'outro', weight: 1.3, bg: bgs[Math.min(1, bgs.length - 1)], title, cta };
  if (!cta) decided.push('no closing message supplied: ending on the title card');

  // trim body to what fits: every scene needs about 2 s
  const minSec = 2.2, maxScenes = Math.max(3, Math.floor(opts.seconds / minSec));
  const wantBody = Math.max(0, maxScenes - 2), picked = body.slice(0, wantBody);
  if (picked.length < body.length) notes.push(`${body.length - picked.length} planned scene(s) dropped: a ${Math.round(opts.seconds)} s video fits about ${maxScenes} scenes.`);
  // spread to the requested length: repeat text-free scenes only; never repeat text or invent more content
  const need = Math.max(0, Math.min(wantBody, Math.round(opts.seconds / 5.5) - 2) - picked.length);
  for (let i = 0; i < need; i++) picked.push({ kind: 'abstract', weight: 0.8, patch: {} });
  // interleave text-free scenes so two text/chart scenes never touch
  picked.sort((a, b) => (a.kind === 'abstract' ? 1 : 0) - (b.kind === 'abstract' ? 1 : 0));
  const arranged: typeof picked = []; const abs = picked.filter((x) => x.kind === 'abstract'), rest = picked.filter((x) => x.kind !== 'abstract');
  while (rest.length || abs.length) { if (rest.length) arranged.push(rest.shift()!); if (abs.length && (arranged.length % 2 === 1 || !rest.length)) arranged.push(abs.shift()!); }

  const counters: Record<string, number> = {}; let bi = 1;
  const scenes: SceneSpec[] = [intro, ...arranged.map((b) => { counters[b.kind] = (counters[b.kind] ?? 0) + 1; return { id: `${b.kind}${counters[b.kind]}`, kind: b.kind, weight: b.weight, bg: bgs[bi++ % bgs.length], ...b.patch } as SceneSpec; }), outro];
  if (opts.mixed && !title) scenes.shift();                         // nothing to say up front: let the media open the video
  if (opts.mixed && !title && !cta) scenes.pop();
  decided.push(`${scenes.length} generated scene(s): ${scenes.map((s) => s.kind).join(' → ')}`);
  // user edits
  for (const s of scenes) { const e = cfg.sceneEdits?.[s.id]; if (e) Object.assign(s, e); }
  return { scenes: scenes.filter((s) => !(cfg.excludeUnits ?? []).includes(`scene:${s.id}@0.0`)), look, notes, decided };
}
