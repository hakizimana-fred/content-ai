import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject, assetPath } from '@/lib/auto/store';
import { refine } from '@/lib/auto/refine';
import { currentJob, startRender } from '@/lib/auto/pipeline';
import { transcribeMedia } from '@/lib/intelligence/transcription-service';

/** POST ?project=ID { instruction, start?: boolean } -> applies a plain-English change to the plan, then re-renders (only changed parts are rebuilt). */
export async function POST(request: NextRequest) {
  const pid = new URL(request.url).searchParams.get('project') ?? '', p = getProject(pid);
  if (!p) return NextResponse.json({ success: false, error: 'project not found' }, { status: 404 });
  if (currentJob()) return NextResponse.json({ success: false, error: 'A video is being made right now. Wait for it to finish.' }, { status: 409 });
  let b: { instruction?: unknown; start?: unknown }; try { b = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  if (typeof b.instruction !== 'string' || !b.instruction.trim() || b.instruction.length > 400) return NextResponse.json({ success: false, error: 'Tell me what to change (up to 400 characters).' }, { status: 400 });
  const r = refine(p, b.instruction);
  if (r.unrecognised) return NextResponse.json({ success: true, understood: false, changes: [], notes: r.notes, project: p });
  const next = updateProject(pid, (q) => { q.config = r.config; q.history.push({ at: Date.now(), text: b.instruction as string }); q.history = q.history.slice(-30); })!;
  let started = false, startError: string | undefined;
  if (b.start !== false) {
    const s = startRender(pid, { transcribe: async (a, pr) => { const t = await transcribeMedia(`auto_${a.id}`, assetPath(pr, a), 'base'); return t.segments.length ? { segments: t.segments } : null; } });
    started = s.ok; if (!s.ok) startError = s.error;
  }
  return NextResponse.json({ success: true, understood: true, changes: r.changes, dirty: r.dirty, notes: r.notes, started, startError, project: next });
}
