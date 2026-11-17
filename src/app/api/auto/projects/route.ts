import { NextRequest, NextResponse } from 'next/server';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '@/lib/auto/store';
import { currentJob } from '@/lib/auto/pipeline';
import type { AutoConfig } from '@/lib/auto/types';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const idOf = (r: NextRequest) => new URL(r.url).searchParams.get('id') ?? '';
const FORMATS = ['9:16', '16:9', '1:1'], STYLES = ['auto', 'commercial', 'cinematic', 'documentary', 'social'], MODES = ['auto', 'library', 'generate', 'original', 'none'];

/** Whitelist + validate the user-editable config. Anything else in the body is ignored. */
export function cleanConfig(b: Record<string, unknown>, base: AutoConfig): { ok: true; config: AutoConfig } | { ok: false; error: string } {
  const c = { ...base };
  if (b.prompt !== undefined) { if (typeof b.prompt !== 'string' || b.prompt.length > 1500) return { ok: false, error: 'prompt must be text up to 1500 characters.' }; c.prompt = b.prompt; }
  if (b.format !== undefined) { if (!FORMATS.includes(b.format as string)) return { ok: false, error: 'format must be 9:16, 16:9 or 1:1.' }; c.format = b.format as AutoConfig['format']; }
  if (b.durationSec !== undefined) { const d = Number(b.durationSec); if (!Number.isFinite(d) || d < 5 || d > 180) return { ok: false, error: 'duration must be 5 to 180 seconds.' }; c.durationSec = Math.round(d); }
  if (b.style !== undefined) { if (!STYLES.includes(b.style as string)) return { ok: false, error: 'unknown style.' }; c.style = b.style as AutoConfig['style']; }
  if (b.audioMode !== undefined) { if (!MODES.includes(b.audioMode as string)) return { ok: false, error: 'unknown audio mode.' }; c.audioMode = b.audioMode as AutoConfig['audioMode']; }
  if (b.soundtrackId !== undefined) { if (b.soundtrackId !== null && (typeof b.soundtrackId !== 'string' || !/^[a-f0-9]{16}$/.test(b.soundtrackId))) return { ok: false, error: 'invalid soundtrack id.' }; c.soundtrackId = (b.soundtrackId as string | null) ?? undefined; }
  for (const k of ['headline', 'cta'] as const) if (b[k] !== undefined) { if (b[k] !== null && (typeof b[k] !== 'string' || (b[k] as string).length > 80)) return { ok: false, error: `${k} must be text up to 80 characters.` }; c[k] = ((b[k] as string | null) ?? '').trim() || undefined; }
  for (const k of ['keepOrder', 'captions', 'useModel'] as const) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') return { ok: false, error: `${k} must be true or false.` }; c[k] = b[k] as boolean; }
  if (b.mode !== undefined) { if (!['video', 'image', 'idea', 'mixed'].includes(b.mode as string)) return { ok: false, error: 'unknown creation mode.' }; c.mode = b.mode as AutoConfig['mode']; }
  if (b.quality !== undefined) { if (!['preview', 'final'].includes(b.quality as string)) return { ok: false, error: 'quality must be preview or final.' }; c.quality = b.quality as AutoConfig['quality']; }
  if (b.creativeAssetIds !== undefined) { const a = b.creativeAssetIds; if (!Array.isArray(a) || a.length > 8 || !a.every((x) => typeof x === 'string' && /^ca_[a-f0-9]{12}$/.test(x))) return { ok: false, error: 'invalid creative asset list.' }; c.creativeAssetIds = a as string[]; }
  if (b.sceneEdits !== undefined) {
    const e = b.sceneEdits as Record<string, Record<string, unknown>>; if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'invalid scene edits.' }; const out: NonNullable<AutoConfig['sceneEdits']> = {};
    for (const [id, v] of Object.entries(e)) {
      if (!/^[a-z]+\d{0,2}$/.test(id) || !v || typeof v !== 'object') return { ok: false, error: 'invalid scene id.' }; const o2: Record<string, unknown> = {};
      for (const k of ['title', 'subtitle', 'cta', 'quote', 'attribution']) if (v[k] !== undefined) { if (typeof v[k] !== 'string' || (v[k] as string).length > 160) return { ok: false, error: `scene ${k} must be text up to 160 characters.` }; o2[k] = (v[k] as string).trim(); }
      if (v.bullets !== undefined) { if (!Array.isArray(v.bullets) || v.bullets.length > 5 || !v.bullets.every((x) => typeof x === 'string' && x.length <= 60)) return { ok: false, error: 'bullets must be up to 5 short lines.' }; o2.bullets = v.bullets; }
      out[id] = o2 as never;
    }
    c.sceneEdits = out;
  }
  if (b.soundtrackStyles !== undefined) { const a = b.soundtrackStyles; if (!Array.isArray(a) || a.length > 6 || !a.every((x) => typeof x === 'string' && /^[a-z_]{3,20}$/.test(x))) return { ok: false, error: 'soundtrackStyles must be a short list of style ids.' }; c.soundtrackStyles = a.length ? (a as string[]) : undefined; }
  if (b.soundtrackVariations !== undefined) { const n = Number(b.soundtrackVariations); if (!Number.isInteger(n) || n < 1 || n > 4) return { ok: false, error: 'soundtrackVariations must be 1 to 4.' }; c.soundtrackVariations = n; }
  if (b.fontAssetId !== undefined) { if (b.fontAssetId !== null && (typeof b.fontAssetId !== 'string' || !/^ca_[a-f0-9]{12}$/.test(b.fontAssetId))) return { ok: false, error: 'invalid font id.' }; c.fontAssetId = (b.fontAssetId as string | null) ?? undefined; }
  if (b.fps !== undefined) { if (b.fps !== 24 && b.fps !== 30) return { ok: false, error: 'fps must be 24 or 30.' }; c.fps = b.fps; }
  if (b.commercial !== undefined) { if (typeof b.commercial !== 'boolean') return { ok: false, error: 'commercial must be true or false.' }; c.commercial = b.commercial; }
  if (b.identityId !== undefined) c.identityId = typeof b.identityId === 'string' && /^idn_[a-z0-9]{3,16}$/.test(b.identityId) ? b.identityId : undefined;
  return { ok: true, config: c };
}

export async function GET(request: NextRequest) {
  const id = idOf(request);
  if (id) { const p = getProject(id); return p ? NextResponse.json({ success: true, project: p, busy: currentJob()?.projectId ?? null }) : bad('project not found', 404); }
  return NextResponse.json({ success: true, projects: listProjects().map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, assets: p.assets.length, hasVideo: !!p.render.outputFile })), busy: currentJob()?.projectId ?? null });
}
export async function POST(request: NextRequest) {
  let b: Record<string, unknown> = {}; try { b = await request.json(); } catch { /* empty body ok */ }
  const p = createProject(typeof b.name === 'string' ? b.name : 'Untitled video');
  const c = cleanConfig(b, p.config); if (!c.ok) { deleteProject(p.id); return bad(c.error); }
  return NextResponse.json({ success: true, project: updateProject(p.id, (q) => { q.config = c.config; }) });
}
export async function PATCH(request: NextRequest) {
  const id = idOf(request), p = getProject(id); if (!p) return bad('project not found', 404);
  if (currentJob()?.projectId === id) return bad('This video is being made right now. Wait for it to finish or cancel it.', 409);
  let b: Record<string, unknown>; try { b = await request.json(); } catch { return bad('Invalid JSON body.'); }
  const c = cleanConfig(b, p.config); if (!c.ok) return bad(c.error);
  return NextResponse.json({ success: true, project: updateProject(id, (q) => { q.config = c.config; if (typeof b.name === 'string' && b.name.trim()) q.name = b.name.trim().slice(0, 80); }) });
}
export async function DELETE(request: NextRequest) {
  const id = idOf(request); if (currentJob()?.projectId === id) return bad('Cancel the render first.', 409);
  return deleteProject(id) ? NextResponse.json({ success: true }) : bad('project not found', 404);
}
