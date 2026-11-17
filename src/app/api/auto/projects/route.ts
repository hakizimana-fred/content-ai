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
