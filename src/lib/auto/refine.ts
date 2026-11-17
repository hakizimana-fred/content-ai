import type { AutoConfig, AutoProject, Format, StyleChoice } from './types.ts';

export type Dirty = 'composition' | 'visual' | 'audio' | 'text';
export interface RefineResult { config: AutoConfig; changes: string[]; dirty: Dirty[]; unrecognised: boolean; notes: string[] }

const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const has = (t: string, re: RegExp) => re.test(t);
const quoted = (s: string) => /["“‘']([^"”’']{1,80})["”’']/.exec(s)?.[1]?.trim();

/**
 * Conversational editing: maps plain-English instructions onto the project's CONFIG (never onto media). The pipeline re-runs from the
 * config, and because shots, the assembly and the mix are cached by content, only what actually changed is rebuilt.
 */
export function refine(p: AutoProject, instruction: string): RefineResult {
  const t = instruction.toLowerCase().trim(), c: AutoConfig = { ...p.config, excludeUnits: [...(p.config.excludeUnits ?? [])] };
  const changes: string[] = [], dirty = new Set<Dirty>(), notes: string[] = [];
  const note = (msg: string, ...d: Dirty[]) => { changes.push(msg); d.forEach((x) => dirty.add(x)); };
  const music = /(sound\s*track|music|song|track|audio)/;

  // remove a shot: "remove the second scene", "delete shot 3", "drop the last clip"
  const rm = /(remove|delete|drop|cut out|get rid of)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)?)\s+(scene|shot|clip|photo|picture|image|part)/.exec(t);
  if (rm) {
    const shots = p.timeline?.shots ?? [];
    if (!shots.length) notes.push('Make the first version before removing a scene, so I know which one you mean.');
    else {
      const n = rm[2] === 'last' ? shots.length : ORD[rm[2]] ?? parseInt(rm[2], 10);
      const s = shots[n - 1];
      if (!s) notes.push(`There is no scene ${n}; the video has ${shots.length}.`);
      else if (shots.length <= 1) notes.push('That is the only scene, so it cannot be removed.');
      else { const key = `${s.assetId}@${s.srcStart.toFixed(1)}`; if (!c.excludeUnits!.includes(key)) c.excludeUnits!.push(key); note(`removed scene ${n} (${p.assets.find((a) => a.id === s.assetId)?.name ?? 'media'}); the other shots close the gap`, 'composition'); }
    }
  }

  if (has(t, /(change|different|another|new|swap|switch|replace|try)\b.*\b(sound\s*track|music|song|track)\b|\b(sound\s*track|music|song|track)\b.*\b(different|another|new|swap|switch)/)) {
    c.soundtrackId = undefined; c.musicVariation = (c.musicVariation ?? 0) + 1; if (c.audioMode === 'library' || c.audioMode === 'original' || c.audioMode === 'none') c.audioMode = 'generate';
    note('picked a different soundtrack', 'audio', 'composition');
  }
  if (has(t, new RegExp(`(more|very|really)?\\s*(energetic|upbeat|lively|punchy|driving|high[- ]energy)\\s+${music.source}|${music.source}.*(more|so|very)\\s+(energetic|upbeat|lively)`))) {
    c.prompt = `${c.prompt} Upbeat, energetic soundtrack.`; c.soundtrackId = undefined; c.musicVariation = (c.musicVariation ?? 0) + 1; if (c.audioMode === 'original' || c.audioMode === 'none') c.audioMode = 'auto';
    note('more energetic soundtrack', 'audio', 'composition');
  } else if (has(t, new RegExp(`(calmer|softer|slower|gentler|quieter|more (?:calm|relaxed|gentle|peaceful))\\s+${music.source}|${music.source}.*(calmer|softer|gentler)`)) && !has(t, /(reduce|lower)/)) {
    c.prompt = `${c.prompt} Calm, gentle soundtrack.`; c.soundtrackId = undefined; c.musicVariation = (c.musicVariation ?? 0) + 1; note('calmer soundtrack', 'audio', 'composition');
  }
  if (has(t, new RegExp(`(reduce|lower|decrease|turn down|less|quieter|softer)\\b.*\\b(background\\s+)?${music.source}|${music.source}\\b.*\\b(too loud|quieter|lower)`)) && !changes.some((x) => /calmer/.test(x))) { c.musicGain = Math.max(0.15, (c.musicGain ?? 1) * 0.6); note(`background music lowered (level now ${Math.round(c.musicGain * 100)}%)`, 'audio'); }
  else if ((has(t, new RegExp(`(increase|raise|turn up|louder|boost|more)\\b.*\\b(background\\s+)?${music.source}\\b`)) || has(t, new RegExp(`${music.source}\\b.*\\b(louder|higher|turn it up|more prominent)`))) && !has(t, /energetic|upbeat|lively/)) { c.musicGain = Math.min(2, (c.musicGain ?? 1) * 1.5); note(`background music raised (level now ${Math.round(c.musicGain * 100)}%)`, 'audio'); }
  if (has(t, /(no|without|remove|turn off|drop)\s+(the\s+)?(background\s+)?(music|soundtrack)/) && !rm) { c.audioMode = 'none'; c.soundtrackId = undefined; note('background music removed', 'audio', 'composition'); }
  if (has(t, /original audio only|only (the )?original (audio|sound)/)) { c.audioMode = 'original'; note('original audio only', 'audio', 'composition'); }

  if (has(t, /(increase|bigger|larger|enlarge|make)\b.*\b(text|captions?|subtitles?|titles?|font|typography)\b.*(bigger|larger)?|\b(text|captions?|subtitles?|titles?)\b.*\b(bigger|larger|too small)/) && !has(t, /(smaller|decrease|reduce)/) && has(t, /(increase|bigger|larger|enlarge|too small)/)) { c.textScale = Math.min(1.8, (c.textScale ?? 1) * 1.25); note(`text enlarged (${Math.round(c.textScale * 100)}%)`, 'text'); }
  else if (has(t, /(smaller|decrease|reduce|shrink)\b.*\b(text|captions?|subtitles?|titles?|font)|\b(text|captions?|subtitles?|titles?)\b.*\b(smaller|too big|too large)/)) { c.textScale = Math.max(0.6, (c.textScale ?? 1) / 1.25); note(`text reduced (${Math.round(c.textScale * 100)}%)`, 'text'); }
  if (has(t, /(remove|no|hide|turn off|without)\s+(the\s+)?(captions?|subtitles?)/)) { c.captions = false; note('captions off', 'text'); } else if (has(t, /(add|show|turn on|enable)\s+(the\s+)?(captions?|subtitles?)/)) { c.captions = true; note('captions on', 'text'); }

  if (has(t, /(smoother|softer|gentler|more fluid|more elegant)\s+(transitions?|cuts?)|(transitions?|cuts?).*(smoother|softer|gentler|more fluid)/)) { c.transitionFeel = 'smooth'; note('smoother transitions', 'composition'); }
  else if (has(t, /(punchier|snappier|faster|sharper|more dynamic|more energetic)\s+(transitions?|cuts?)|(transitions?|cuts?).*(punchier|snappier|faster|sharper)/)) { c.transitionFeel = 'punchy'; note('punchier transitions', 'composition'); }
  if (has(t, /(opening|intro|beginning|start|first (few )?seconds?).*(engaging|hook|exciting|punchier|stronger|better|catchier|grab)|(more|better)\s+(engaging|catchy)\s+(opening|intro|start)/)) { c.openingBoost = true; note('opening tightened to hook the viewer sooner', 'composition'); }

  const style = /\b(cinematic|documentary|social|commercial)\b/.exec(t)?.[1] as StyleChoice | undefined;
  if (style && has(t, /(more|make|go|switch|change|turn|look|feel|style)/) && !rm && !has(t, new RegExp(`${style}\\s+(transitions?|music|sound)`))) { c.style = style; note(`style set to ${style}`, 'composition', 'visual'); }
  if (has(t, /more\s+(luxur\w+|premium|elegant|sophisticated)/)) { c.prompt = `${c.prompt} Luxurious, elegant.`; c.style = 'auto'; note('more luxurious feel', 'composition', 'audio'); }
  if (has(t, /(more|faster|quicker|snappier)\s*(energetic|paced|pacing)?\b.*\b(video|edit|pacing|pace|overall)|faster pac/) && !changes.length) { c.prompt = `${c.prompt} Energetic, fast.`; note('faster pacing', 'composition'); }
  if (has(t, /(slower|calmer|more relaxed)\s*(pacing|pace|edit|video)/)) { c.prompt = `${c.prompt} Slow, calm.`; note('slower pacing', 'composition'); }
  const sec = /(\d{1,3})\s*(?:-?\s*)?(?:s\b|sec|secs|seconds?)\b/.exec(t);
  if (sec && has(t, /(make|change|set|shorten|lengthen|trim|cut|it)\b/)) { const v = Math.max(5, Math.min(180, +sec[1])); if (v !== c.durationSec) { c.durationSec = v; note(`length set to ${v} seconds`, 'composition'); } }
  else if (has(t, /\b(shorter|shorten|trim it down)\b/)) { c.durationSec = Math.max(10, Math.round(c.durationSec * 0.75)); note(`shorter: ${c.durationSec} seconds`, 'composition'); }
  else if (has(t, /\b(longer|lengthen|extend)\b/)) { c.durationSec = Math.min(180, Math.round(c.durationSec * 1.3)); note(`longer: ${c.durationSec} seconds`, 'composition'); }
  const fmt: [RegExp, Format][] = [[/tiktok|reels?|shorts|vertical|9:16/, '9:16'], [/landscape|16:9|youtube|widescreen/, '16:9'], [/square|1:1/, '1:1']];
  for (const [re, f] of fmt) if (has(t, re) && has(t, /(make|change|switch|use|export|format|convert|for)/) && c.format !== f) { c.format = f; note(`format changed to ${f}`, 'composition', 'visual'); break; }

  const q = quoted(instruction);
  if (q && has(t, /(headline|title|opening (text|line)|heading)/)) { c.headline = q; note(`headline: “${q}”`, 'text'); }
  if (q && has(t, /(call to action|cta|closing (text|message|line)|ending (text|message))/)) { c.cta = q; note(`closing message: “${q}”`, 'text'); }
  if (has(t, /(remove|no|delete)\s+(the\s+)?(headline|title)\b/)) { c.headline = undefined; note('headline removed', 'text'); }
  if (has(t, /(another|different|new)\s+(version|cut|edit|arrangement|order)|shuffle|rearrange|try again/)) { c.variation = (c.variation ?? 0) + 1; note('a different arrangement of the same material', 'composition'); }
  if (has(t, /keep (my|the) (own )?order/)) { c.keepOrder = true; note('keeping your media order', 'composition'); }

  const unrecognised = changes.length === 0;
  if (unrecognised && !notes.length) notes.push('I did not recognise a change in that. Try things like “change the soundtrack”, “make the transitions smoother”, “increase the text size”, “remove the second scene”, “reduce the background music” or “make it 20 seconds”.');
  return { config: c, changes, dirty: [...dirty], unrecognised, notes };
}
