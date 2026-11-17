import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getIdentity } from '@/lib/studio/identity-store';
import { logoFile } from '@/lib/studio/logo-store';
import { DEFAULT_LOGO_STYLE } from '@/lib/studio/identity';
import { brandOf, brandPalette } from '@/lib/auto/brand';
import { PY, SCRIPT, run } from '@/lib/auto/media';

const HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * Real preview of the brand in a scene: renders ~1.5 s of the actual scene renderer at low resolution and returns the last frame as a PNG.
 * body: { identityId, role: 'opening' | 'closing', style?: {scale, reveal, ...}, colors?: {primary, secondary, accent} }  (unsaved edits are previewed without saving)
 */
export async function POST(request: NextRequest) {
  let b: Record<string, any>; try { b = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); } // eslint-disable-line @typescript-eslint/no-explicit-any
  const idn = getIdentity(String(b.identityId ?? '')); if (!idn) return NextResponse.json({ success: false, error: 'brand profile not found' }, { status: 404 });
  const file = logoFile(idn.id); if (!file) return NextResponse.json({ success: false, error: 'Upload a logo first.' }, { status: 400 });
  const role = b.role === 'closing' ? 'closing' : 'opening';
  const colors = { ...idn.colors }; for (const k of ['primary', 'secondary', 'accent'] as const) if (typeof b.colors?.[k] === 'string') { if (!HEX.test(b.colors[k])) return NextResponse.json({ success: false, error: `colors.${k} must be #RRGGBB` }, { status: 400 }); (colors as Record<string, string>)[k] = b.colors[k]; }
  const st = { ...DEFAULT_LOGO_STYLE, ...(idn.logoStyle ?? {}), ...(b.style && typeof b.style === 'object' ? b.style : {}) };
  const scale = Math.max(0.5, Math.min(1.6, Number(st.scale) || 1)), reveal = ['fade', 'rise', 'sweep'].includes(st.reveal) ? st.reveal : 'sweep';
  const pal = brandPalette({ ...brandOf({ ...idn, colors }), style: st });
  const tmp = path.join(os.tmpdir(), `brandprev_${crypto.randomBytes(5).toString('hex')}`); const mp4 = tmp + '.mp4', png = tmp + '.png';
  const name = idn.brand.text || idn.name, wide = (idn.logo?.aspect ?? 1) > 2.4;
  const scene = role === 'opening' ? { kind: 'intro', title: name, subtitle: idn.tagline, logo: { role, reveal, scale: scale * (wide ? 1.1 : 1), file } } : { kind: 'outro', title: name, subtitle: idn.tagline, logo: { role, reveal, scale: scale * (wide ? 1.1 : 1.15), file } };
  const job = { out: mp4, w: 360, h: 640, fps: 12, seconds: 2.4, seed: 3, bg: { type: 'gradient', colors: pal.colors, accent: pal.accent, speed: 1 }, text: { color: pal.text, font: 'modern' }, fx: { vignette: 0.5, grain: 0.1 }, motif: 'none', scene };
  try {
    await run(PY(), [SCRIPT('scene_render.py')], { input: JSON.stringify(job), timeoutMs: 60_000, nice: true });
    await run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.2', '-i', mp4, '-frames:v', '1', png], { timeoutMs: 20_000 });
    const meta = JSON.parse(fs.readFileSync(mp4 + '.meta.json', 'utf8'));
    return NextResponse.json({ success: true, image: `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`, palette: pal, logo: meta.logo });
  } catch (e) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message.slice(0, 160) : 'preview failed' }, { status: 500 }); }
  finally { for (const f of [mp4, mp4 + '.meta.json', png]) { try { fs.unlinkSync(f); } catch { /* none */ } } }
}
