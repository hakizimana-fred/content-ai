// Composes the project's soundtrack from the selected style ingredients (real synthesis through the Sonic Engine) and stores it in the sound library,
// so it is playable, reusable and shows up in the Soundtrack Library like any other track. Cached by (styles, character, length).
import crypto from 'node:crypto';
import { blendStyles, characterTitle, isStyle, STYLE_LABEL, variationPlan, type Character, type StyleId } from '../studio/blend.ts';
import { describePlan, MIN_STRUCTURED_SECONDS, planMusic, renderMusic } from '../studio/sonic.ts';
import { listItems, saveItem, withRenderLock } from '../studio/library.ts';
import type { AutoProject } from './types.ts';

const MOOD_OF: Record<string, string> = { ambient: 'minimal', dramatic: 'suspense', experimental: 'technology' };
export function characterFor(styleId: string, styles: StyleId[]): Character {
  if (/cinematic|documentary/.test(styleId) || styles.includes('dramatic')) return 'dramatic';
  if (/premium|luxury|editorial/.test(styleId) || (styles.includes('luxury') && !styles.includes('electronic'))) return 'elegant';
  return 'modern';
}
export interface Composed { id: string; label: string; character: string; notes: string[]; reused: boolean; siblings: string[] }

export async function composeSoundtrack(p: AutoProject, styleId: string, onStatus?: (s: string) => void): Promise<Composed | null> {
  const styles = (p.config.soundtrackStyles ?? []).filter(isStyle); if (!styles.length) return null;
  const secs = Math.max(8, Math.min(120, Math.round(p.config.durationSec + 2))), want = Math.max(1, Math.min(4, Math.round(p.config.soundtrackVariations ?? 1)));
  const first = characterFor(styleId, styles), order = [first, ...variationPlan(4).filter((c) => c !== first)].slice(0, want);
  const tag = (c: Character) => `auto:${crypto.createHash('sha1').update(JSON.stringify([styles, c, secs, 'structured-v2'])).digest('hex').slice(0, 12)}`;
  const existing = listItems().find((i) => i.prompt === tag(first)); if (existing && want === 1) return { id: existing.id, label: existing.label, character: existing.character ?? '', notes: existing.arrangement?.notes ?? [], reused: true, siblings: [] };
  const made: Composed[] = [];
  await withRenderLock(async () => {
    for (let i = 0; i < order.length; i++) {
      const c = order[i], ex = listItems().find((it) => it.prompt === tag(c)); if (ex) { made.push({ id: ex.id, label: ex.label, character: ex.character ?? '', notes: ex.arrangement?.notes ?? [], reused: true, siblings: [] }); continue; }
      onStatus?.(`composing soundtrack ${i + 1} of ${order.length}: ${characterTitle(c)}`);
      const bl = blendStyles(styles, c, i), seed = 1000 + parseInt(crypto.createHash('sha1').update(tag(c)).digest('hex').slice(0, 4), 16) % 8000, t0 = Date.now();
      const mood = (MOOD_OF[bl.leader] ?? bl.leader) as never, audio = await renderMusic({ mood, intensity: 'medium', seconds: secs, seed, overrides: bl.recipe });
      const it = saveItem(audio, { kind: 'music', label: bl.label, mood: MOOD_OF[bl.leader] ?? bl.leader, intensity: 'medium', seed, seconds: secs, prompt: tag(c), overrides: bl.recipe as unknown as Record<string, unknown>, structure: secs >= MIN_STRUCTURED_SECONDS ? { sections: describePlan(planMusic({ mood, intensity: 'medium', seconds: secs, seed, overrides: bl.recipe }).plan) } : undefined, renderMs: Date.now() - t0,
        styles: styles.map((s) => STYLE_LABEL[s]), character: characterTitle(c), group: tag(first), arrangement: { notes: bl.notes, contributions: bl.contributions, bpm: bl.bpm, leader: STYLE_LABEL[bl.leader] } });
      made.push({ id: it.id, label: it.label, character: characterTitle(c), notes: bl.notes, reused: false, siblings: [] });
    }
  });
  const main = made[0]; if (!main) return null; return { ...main, siblings: made.slice(1).map((m) => m.id) };
}
