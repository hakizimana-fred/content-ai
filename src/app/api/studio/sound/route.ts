import { NextRequest, NextResponse } from 'next/server';
import { detectHardware } from '@/lib/studio/hardware';
import { SFX_KINDS, SFX_LABELS, SOUND_CATEGORIES, SOUND_LICENSE, parseSoundPrompt, renderMusic, renderSfx, renderSignature, type SfxKind } from '@/lib/studio/sonic';
import { deleteItem, limitsForTier, listEntries, saveItem, withRenderLock } from '@/lib/studio/library';
import { AUDIO_MOODS, INTENSITIES } from '@/lib/studio/plan';
import { blendStyles, characterTitle, isStyle, variationPlan, STYLES, STYLE_LABEL, STYLE_BLURB } from '@/lib/studio/blend';
import crypto from 'node:crypto';

export async function GET() {
  const hw = detectHardware();
  return NextResponse.json({
    success: true, categories: SOUND_CATEGORIES, styles: STYLES.map((s) => ({ id: s, label: STYLE_LABEL[s], blurb: STYLE_BLURB[s] })), sfx: SFX_KINDS.map((k) => ({ id: k, label: SFX_LABELS[k] })), license: SOUND_LICENSE,
    limits: limitsForTier(hw.tier), tier: hw.tier, library: listEntries(),
  });
}

/**
 * POST { prompt?, mood?, intensity?, seconds?, variations?, sfx? } -> rendered, auditionable variations saved to the local library.
 * Procedural synthesis (no model). Limits follow the hardware tier and only one render runs at a time.
 */
export async function POST(request: NextRequest) {
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  const hw = detectHardware(), lim = limitsForTier(hw.tier);
  try {
    return await withRenderLock(async () => {
      if (typeof b.signatureSeed === 'number' && Number.isInteger(b.signatureSeed) && b.signatureSeed > 0) {
        const t0 = Date.now(), mood = (AUDIO_MOODS as readonly string[]).includes(b.mood as string) ? (b.mood as never) : 'cinematic';
        const item = saveItem(renderSignature(b.signatureSeed, mood), { kind: 'sfx', label: `Signature #${b.signatureSeed}`, sfx: 'signature', mood: String(mood), seed: b.signatureSeed, seconds: 3, renderMs: Date.now() - t0 });
        return NextResponse.json({ success: true, items: [item] });
      }
      if (typeof b.sfx === 'string') {
        if (!(SFX_KINDS as readonly string[]).includes(b.sfx)) return NextResponse.json({ success: false, error: 'Unknown sound effect.' }, { status: 400 });
        const t0 = Date.now(), seed = Number.isInteger(b.seed) ? (b.seed as number) : 1, kind = b.sfx as SfxKind;
        const item = saveItem(renderSfx(kind, seed), { kind: 'sfx', label: SFX_LABELS[kind], sfx: kind, seed, seconds: 0, renderMs: Date.now() - t0 });
        return NextResponse.json({ success: true, items: [item] });
      }
      if (Array.isArray(b.styles)) {                     // composition from several style ingredients
        const styles = b.styles.filter(isStyle); if (!styles.length || styles.length !== b.styles.length) return NextResponse.json({ success: false, error: 'styles must be a list of known style ids.' }, { status: 400 });
        const secs = Math.round(Number(b.seconds ?? 30)), n = Math.round(Number(b.variations ?? 4));
        if (!Number.isFinite(secs) || secs < 5 || secs > lim.maxSeconds) return NextResponse.json({ success: false, error: `seconds must be 5-${lim.maxSeconds} on this ${hw.tier}-resource machine.` }, { status: 400 });
        if (!Number.isFinite(n) || n < 1 || n > lim.maxVariations) return NextResponse.json({ success: false, error: `variations must be 1-${lim.maxVariations} on this ${hw.tier}-resource machine.` }, { status: 400 });
        const baseSeed = Number.isInteger(b.seed) ? (b.seed as number) : Math.floor(Math.random() * 9000) + 1, group = crypto.randomBytes(5).toString('hex'), items = [], MOOD_OF: Record<string, string> = { ambient: 'minimal', dramatic: 'suspense', experimental: 'technology' };
        variationPlan(n).forEach(() => {}); const plan = variationPlan(n);
        for (let i = 0; i < n; i++) {
          const bl = blendStyles(styles, plan[i], i), seed = baseSeed + i * 7, t0 = Date.now(), intensity = (INTENSITIES as readonly string[]).includes(b.intensity as string) ? (b.intensity as string) : 'medium';
          const audio = await renderMusic({ mood: (MOOD_OF[bl.leader] ?? bl.leader) as never, intensity: intensity as never, seconds: secs, seed, overrides: bl.recipe });
          items.push(saveItem(audio, { kind: 'music', label: `${bl.label}${n > 4 ? ` #${i + 1}` : ''}`, mood: MOOD_OF[bl.leader] ?? bl.leader, intensity, seed, seconds: secs, overrides: bl.recipe as unknown as Record<string, unknown>, renderMs: Date.now() - t0,
            styles: styles.map((s) => STYLE_LABEL[s]), character: characterTitle(bl.character), group, arrangement: { notes: bl.notes, contributions: bl.contributions, bpm: bl.bpm, leader: STYLE_LABEL[bl.leader] } }));
        }
        return NextResponse.json({ success: true, items, group });
      }
      const prompt = typeof b.prompt === 'string' ? b.prompt.slice(0, 500) : '';
      let mood = b.mood as string | undefined, intensity = b.intensity as string | undefined, overrides = {}, matched: string[] = [];
      if (prompt.trim()) { const p = parseSoundPrompt(prompt); mood = mood ?? p.mood; intensity = intensity ?? p.intensity; overrides = p.overrides; matched = p.matched; }
      if (!mood || mood === 'none' || !(AUDIO_MOODS as readonly string[]).includes(mood)) return NextResponse.json({ success: false, error: 'Give a prompt or a valid mood.' }, { status: 400 });
      if (intensity && !(INTENSITIES as readonly string[]).includes(intensity)) return NextResponse.json({ success: false, error: 'Invalid intensity.' }, { status: 400 });
      const seconds = Math.round(Number(b.seconds ?? 30)), variations = Math.round(Number(b.variations ?? 2));
      if (!Number.isFinite(seconds) || seconds < 5 || seconds > lim.maxSeconds) return NextResponse.json({ success: false, error: `seconds must be 5-${lim.maxSeconds} on this ${hw.tier}-resource machine.` }, { status: 400 });
      if (!Number.isFinite(variations) || variations < 1 || variations > lim.maxVariations) return NextResponse.json({ success: false, error: `variations must be 1-${lim.maxVariations} on this ${hw.tier}-resource machine.` }, { status: 400 });
      const baseSeed = Number.isInteger(b.seed) ? (b.seed as number) : Math.floor(Math.random() * 9000) + 1;
      const items = [];
      for (let i = 0; i < variations; i++) {
        const seed = baseSeed + i, t0 = Date.now();
        const audio = await renderMusic({ mood: mood as never, intensity: (intensity as never) ?? 'medium', seconds, seed, overrides });
        items.push(saveItem(audio, { kind: 'music', label: `${mood} #${seed}`, mood, intensity: intensity ?? 'medium', seed, seconds, prompt: prompt || undefined, overrides, renderMs: Date.now() - t0 }));
      }
      return NextResponse.json({ success: true, items, interpreted: matched });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'BUSY') return NextResponse.json({ success: false, error: 'Another sound is rendering. Try again in a moment.' }, { status: 429 });
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Render failed.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  return deleteItem(new URL(request.url).searchParams.get('id') ?? '') ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });
}
