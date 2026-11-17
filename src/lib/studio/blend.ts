// Soundtrack composition from several style "ingredients". The result is a single Recipe for the existing synthesiser (renderMusic):
// one harmony and tempo, with each selected style contributing the layer it is best at, under rules for tempo, energy and frequency overlap.
// Nothing here picks files or fakes audio: callers render the recipe and store the real WAV.
import { RECIPES, type Recipe } from './sonic.ts';

export const STYLES = ['cinematic', 'corporate', 'luxury', 'ambient', 'electronic', 'african_fusion', 'inspirational', 'dramatic', 'minimal', 'experimental'] as const;
export type StyleId = (typeof STYLES)[number];
export const STYLE_LABEL: Record<StyleId, string> = { cinematic: 'Cinematic', corporate: 'Corporate', luxury: 'Luxury', ambient: 'Ambient', electronic: 'Electronic', african_fusion: 'African Fusion', inspirational: 'Inspirational', dramatic: 'Dramatic', minimal: 'Minimal', experimental: 'Experimental' };
export const STYLE_BLURB: Record<StyleId, string> = { cinematic: 'wide atmosphere, slow weight', corporate: 'steady groove, clean structure', luxury: 'piano, warm pads, space', ambient: 'long evolving pads, no beat', electronic: 'four-on-the-floor, saw arps', african_fusion: 'afro percussion, pentatonic', inspirational: 'major lift, rising build', dramatic: 'dark, heavy, tense', minimal: 'few notes, lots of air', experimental: 'odd scales, restless texture' };
export const isStyle = (s: unknown): s is StyleId => typeof s === 'string' && (STYLES as readonly string[]).includes(s);

const R = RECIPES;
/** Base recipe of each style. Ambient, dramatic and experimental are derived from the nearest synthesiser moods and are described as such in the UI. */
export const STYLE_RECIPE: Record<StyleId, Recipe> = {
  cinematic: R.cinematic, corporate: R.corporate, luxury: R.luxury, electronic: R.electronic, african_fusion: R.african_fusion, inspirational: R.inspirational, minimal: R.minimal,
  ambient: { ...R.minimal, bpm: 62, scale: 'dorian', pad: { wave: 'sine', cutoff: 1300, level: 0.62, detune: 11 }, bass: 'sub', bassLevel: 0.25, perc: 'none', percLevel: 0, piano: false, pianoLevel: 0, texture: 0.22, reverb: 0.9, build: true },
  dramatic: { ...R.cinematic, bpm: 78, scale: 'phrygian', prog: [0, 1, 0, 5], pad: { wave: 'saw', cutoff: 900, level: 0.5, detune: 13 }, bassLevel: 0.9, perc: 'cinematic', percLevel: 1, texture: 0.2, reverb: 0.7, build: true },
  experimental: { ...R.technology, bpm: 98, scale: 'phrygian', pad: { wave: 'square', cutoff: 1500, level: 0.2, detune: 18 }, arp: { div: 4, wave: 'saw', level: 0.36 }, perc: 'minimal', percLevel: 0.5, texture: 0.3, reverb: 0.6 },
};
/** 0..1 how loud and busy each style is, used to decide whether two styles can share one arrangement. */
const ENERGY: Record<StyleId, number> = { cinematic: 0.55, corporate: 0.55, luxury: 0.3, ambient: 0.12, electronic: 0.9, african_fusion: 0.8, inspirational: 0.65, dramatic: 0.85, minimal: 0.18, experimental: 0.6 };
/** What each style is best at contributing to a mix. */
const ROLES: Record<StyleId, ('atmosphere' | 'harmony' | 'groove' | 'instrument' | 'tension' | 'colour')[]> = {
  cinematic: ['atmosphere', 'tension'], dramatic: ['tension', 'atmosphere'], ambient: ['atmosphere'], luxury: ['instrument', 'harmony'], corporate: ['groove', 'harmony'],
  inspirational: ['harmony', 'groove'], electronic: ['groove', 'colour'], african_fusion: ['groove', 'colour'], minimal: ['instrument'], experimental: ['colour'],
};

export const CHARACTERS = ['dramatic', 'elegant', 'modern', 'minimal'] as const;
export type Character = (typeof CHARACTERS)[number];
const CHAR_TITLE: Record<Character, string> = { dramatic: 'Cinematic and dramatic', elegant: 'Elegant and sophisticated', modern: 'Modern with atmosphere', minimal: 'Minimal and subtle' };

export interface Blend { recipe: Recipe; label: string; character: Character; styles: StyleId[]; leader: StyleId; bpm: number; notes: string[]; contributions: Record<string, string> }

const SCALE_FAMILY: Record<Recipe['scale'], 'bright' | 'dark' | 'modal'> = { major: 'bright', pentMajor: 'bright', minor: 'dark', pentMinor: 'dark', phrygian: 'dark', dorian: 'modal' } as never;
const by = (styles: StyleId[], pref: StyleId[]) => pref.find((p) => styles.includes(p)) ?? styles[0];
const tempoCompatible = (a: number, b: number) => { const r = b / a; return Math.abs(r - 1) < 0.22 || Math.abs(r - 2) < 0.2 || Math.abs(r - 0.5) < 0.1; };

export function blendStyles(input: StyleId[], character: Character, seedIndex = 0): Blend {
  const styles = [...new Set(input)].filter(isStyle); if (!styles.length) throw new Error('Pick at least one style.');
  const notes: string[] = [], contributions: Record<string, string> = {};
  // 1. who leads depends on the character wanted from this variation
  const leader: StyleId = character === 'dramatic' ? by(styles, ['dramatic', 'cinematic', 'experimental', 'electronic']) : character === 'elegant' ? by(styles, ['luxury', 'cinematic', 'inspirational', 'ambient', 'minimal'])
    : character === 'modern' ? by(styles, ['corporate', 'electronic', 'inspirational', 'african_fusion', 'experimental']) : by(styles, ['minimal', 'luxury', 'ambient', 'cinematic']);
  const lead = STYLE_RECIPE[leader]; const rc: Recipe = JSON.parse(JSON.stringify(lead)); contributions[leader] = 'harmony, tempo and overall shape (leads)';
  const others = styles.filter((s) => s !== leader);

  // 2. energy compatibility: a very quiet style and a very loud one cannot both own the drums; the gap decides who is an influence only
  const maxE = Math.max(...styles.map((s) => ENERGY[s])), minE = Math.min(...styles.map((s) => ENERGY[s])), gap = maxE - minE;
  const influenceOnly = new Set<StyleId>(); if (gap > 0.55) { for (const s of others) if (Math.abs(ENERGY[s] - ENERGY[leader]) > 0.45) influenceOnly.add(s); if (influenceOnly.size) notes.push(`${[...influenceOnly].map((s) => STYLE_LABEL[s]).join(', ')} differ${influenceOnly.size === 1 ? 's' : ''} strongly in energy from ${STYLE_LABEL[leader]}, so ${influenceOnly.size === 1 ? 'it is' : 'they are'} used as ${influenceOnly.size === 1 ? 'an influence' : 'influences'} at reduced level instead of being layered at full strength.`); }

  for (const s of others) {
    const o = STYLE_RECIPE[s], f = influenceOnly.has(s) ? 0.45 : 1, roles = ROLES[s], got: string[] = [];
    // tempo: only combine when the tempos are musically related, otherwise the leader's tempo stands
    if (tempoCompatible(lead.bpm, o.bpm)) { const r = o.bpm / lead.bpm; if (Math.abs(r - 1) < 0.22) rc.bpm = Math.round(rc.bpm * (1 - 0.3 * f) + o.bpm * 0.3 * f); }
    else notes.push(`${STYLE_LABEL[s]} runs at ${o.bpm} BPM, which does not sit with ${Math.round(lead.bpm)} BPM, so its tempo is not used.`);
    if (tempoCompatible(lead.bpm, o.bpm) && f === 1) {                      // related tempos still matter: a double-time partner busies the hats, a half-time partner thins the groove
      const ratio = o.bpm / lead.bpm;
      if (Math.abs(ratio - 2) < 0.2 && rc.feel !== 'half') { rc.feel = 'double'; notes.push(`${STYLE_LABEL[s]} is double-time against ${STYLE_LABEL[leader]}: the climax uses a busier rhythm.`); }
      else if (Math.abs(ratio - 0.5) < 0.1 && rc.feel !== 'double') { rc.feel = 'half'; notes.push(`${STYLE_LABEL[s]} is half-time against ${STYLE_LABEL[leader]}: the groove stays spacious.`); }
    }
    if (roles.includes('atmosphere')) { rc.reverb = Math.max(rc.reverb, o.reverb * (0.7 + 0.3 * f)); rc.texture = Math.max(rc.texture, o.texture * f); if (o.pad.level >= rc.pad.level) rc.pad = { ...rc.pad, wave: o.pad.wave, detune: Math.round((rc.pad.detune + o.pad.detune) / 2) }; got.push('pad character, space and texture'); }
    if (roles.includes('tension')) { rc.bassLevel = Math.max(rc.bassLevel, o.bassLevel * f); if (rc.bass === 'none') rc.bass = 'sub'; if (o.perc === 'cinematic' && rc.perc !== 'four' && rc.perc !== 'afro') { rc.perc = 'cinematic'; rc.percLevel = Math.max(rc.percLevel, o.percLevel * f); } rc.build = true; got.push('low-end weight and tension'); }
    if (roles.includes('instrument') && o.piano) { rc.piano = true; rc.pianoLevel = Math.max(rc.pianoLevel, o.pianoLevel * f); got.push('piano'); }
    if (roles.includes('groove') && o.bass !== 'none') { if (rc.bass === 'none' || (rc.bass === 'sub' && f === 1)) rc.bass = o.bass; rc.bassLevel = Math.max(rc.bassLevel, o.bassLevel * f); if (rc.perc === 'none' || rc.perc === 'minimal') { rc.perc = o.perc; rc.percLevel = Math.max(rc.percLevel, o.percLevel * f); } if (!rc.arp && o.arp) rc.arp = { ...o.arp, level: o.arp.level * f }; got.push('rhythmic structure'); }
    if (roles.includes('colour') && o.arp) { rc.arp = { div: o.arp.div, wave: o.arp.wave, level: Math.max(rc.arp?.level ?? 0, o.arp.level * f) }; if (o.perc === 'afro' && f === 1) rc.perc = 'afro', rc.percLevel = Math.max(rc.percLevel, o.percLevel); got.push('arpeggio colour'); }
    if (roles.includes('harmony') && SCALE_FAMILY[o.scale] === SCALE_FAMILY[rc.scale]) { rc.pad = { ...rc.pad, cutoff: Math.round((rc.pad.cutoff + o.pad.cutoff) / 2) }; got.push('pad brightness'); }
    // key and mode: every blend stays in the leader's key. A style in a compatible mode lends its chord progression to the Variation section; a clashing mode only colours the tone.
    if (SCALE_FAMILY[o.scale] === SCALE_FAMILY[rc.scale] || SCALE_FAMILY[o.scale] === 'modal' || SCALE_FAMILY[rc.scale] === 'modal') {
      if (!rc.altProg && o.prog.length === rc.prog.length && o.prog.join() !== rc.prog.join() && f === 1) { rc.altProg = [...o.prog]; got.push('chord progression for the variation section'); }
    } else notes.push(`${STYLE_LABEL[s]} is in a ${SCALE_FAMILY[o.scale]} mode and ${STYLE_LABEL[leader]} in a ${SCALE_FAMILY[rc.scale]} one, so the key and harmony of ${STYLE_LABEL[leader]} are kept and ${STYLE_LABEL[s]} only colours the sound.`);
    contributions[s] = (influenceOnly.has(s) ? 'influence at reduced level: ' : '') + (got.length ? got.join(', ') : 'tone only (nothing in its character fits this arrangement)');
  }

  // 3. the character shapes the arrangement: what plays, when it enters, how the energy moves
  const sub = (x: number, m: number) => Math.max(0, x * m);
  if (character === 'dramatic') { rc.bpm = Math.round(rc.bpm * 0.94); rc.build = true; rc.perc = rc.perc === 'none' ? 'cinematic' : rc.perc; rc.percLevel = Math.max(rc.percLevel, 0.9); rc.bassLevel = Math.max(rc.bassLevel, 0.8); rc.pad.cutoff = Math.round(rc.pad.cutoff * 0.8); rc.reverb = Math.max(rc.reverb, 0.75); rc.texture = Math.max(rc.texture, 0.16); rc.arc = 'arch'; rc.layerIn = { perc: 0.12, bass: 0.0, arp: 0.35 }; rc.outroSec = 3; }
  else if (character === 'elegant') { rc.piano = true; rc.pianoLevel = Math.max(rc.pianoLevel, 0.85); rc.pad = { ...rc.pad, wave: 'tri', cutoff: Math.min(rc.pad.cutoff, 1900) }; rc.arp = null; rc.perc = rc.perc === 'none' ? 'none' : 'minimal'; rc.percLevel = sub(rc.percLevel, 0.5); rc.bass = rc.bass === 'none' ? 'none' : 'sub'; rc.bassLevel = Math.min(rc.bassLevel, 0.5); rc.bpm = Math.round(Math.min(rc.bpm, 88)); rc.build = false; rc.arc = 'rise'; rc.layerIn = { piano: 0, perc: 0.4, bass: 0.15 }; rc.outroSec = 4; }
  else if (character === 'modern') { rc.bpm = Math.round(Math.max(rc.bpm, 100)); if (rc.bass === 'none' || rc.bass === 'sub') rc.bass = 'pulse'; rc.bassLevel = Math.max(rc.bassLevel, 0.5); if (rc.perc === 'none' || rc.perc === 'cinematic') rc.perc = 'soft'; rc.percLevel = Math.max(rc.percLevel, 0.55); if (!rc.arp) rc.arp = { div: 2, wave: 'tri', level: 0.28 }; rc.build = true; rc.arc = 'rise'; rc.layerIn = { bass: 0.08, perc: 0.1, arp: 0.25, piano: 0.3 }; rc.outroSec = 2.5; }
  else { rc.bass = rc.bass === 'none' ? 'none' : 'sub'; rc.bassLevel = Math.min(rc.bassLevel, 0.3); rc.perc = rc.perc === 'none' ? 'none' : 'minimal'; rc.percLevel = Math.min(rc.percLevel, 0.3); rc.arp = null; rc.piano = true; rc.pianoLevel = Math.max(rc.pianoLevel, 0.5); rc.pad = { ...rc.pad, level: rc.pad.level * 0.7 }; rc.reverb = Math.max(rc.reverb, 0.65); rc.bpm = Math.round(Math.min(rc.bpm, 84)); rc.build = false; rc.arc = 'steady'; rc.layerIn = { piano: 0.05, perc: 0.5, bass: 0.3 }; rc.outroSec = 4; }

  // the character also decides how a long piece moves: dramatic builds longest and lands hardest, elegant breathes, modern gets going early, minimal stays level
  rc.form = character;

  // 4. frequency overlap: pad, piano and bass compete for the low-mids. Carve room instead of stacking them at full level.
  if (rc.piano && rc.pianoLevel > 0.5 && rc.pad.level > 0.4) { rc.pad = { ...rc.pad, level: rc.pad.level * 0.8, cutoff: Math.min(rc.pad.cutoff, 1700) }; notes.push('Pad level and brightness were reduced so the piano and pad do not mask each other.'); }
  if (rc.bass !== 'none' && rc.bassLevel > 0.6 && rc.pad.level > 0.45) { rc.pad = { ...rc.pad, level: rc.pad.level * 0.85 }; notes.push('Pad lowered to leave room for the bass.'); }
  if (rc.arp && rc.arp.level > 0.3 && rc.pad.cutoff > 2200) { rc.arp = { ...rc.arp, level: rc.arp.level * 0.8 }; notes.push('Arpeggio softened because the pad is already bright.'); }
  rc.bpm = Math.max(56, Math.min(132, rc.bpm));
  const label = `${styles.map((s) => STYLE_LABEL[s]).join(' + ')} · ${CHAR_TITLE[character]}`;
  void seedIndex; return { recipe: rc, label, character, styles, leader, bpm: rc.bpm, notes, contributions };
}

/** n variations of one selection: the first four use the four characters; beyond that characters repeat with a different key/tempo seed. */
export const variationPlan = (n: number): Character[] => Array.from({ length: n }, (_, i) => CHARACTERS[i % CHARACTERS.length]);
export const characterTitle = (c: Character) => CHAR_TITLE[c];
