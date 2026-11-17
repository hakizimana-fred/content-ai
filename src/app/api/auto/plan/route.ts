import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/auto/store';
import { currentJob } from '@/lib/auto/pipeline';
import { generatePlan } from '@/lib/auto/plan-service';
import { pendingReview } from '@/lib/auto/copy';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const idOf = (r: NextRequest) => new URL(r.url).searchParams.get('id') ?? '';

/** Generate the creative plan (local model when available, keyword Director otherwise) for review. Nothing is rendered. */
export async function POST(request: NextRequest) {
  const id = idOf(request), p = getProject(id); if (!p) return bad('project not found', 404);
  if (currentJob()) return bad('A video is being made right now. Wait for it to finish.', 409);
  if (!p.config.prompt.trim()) return bad('Describe the video first.');
  let b: { useModel?: boolean } = {}; try { b = await request.json(); } catch { /* empty */ }
  try {
    const plan = await generatePlan(id, { useModel: b.useModel !== false, signal: AbortSignal.timeout(170_000) });
    return NextResponse.json({ success: true, plan, pending: pendingReview(plan.copy).length });
  } catch (e) { return bad(e instanceof Error ? e.message.slice(0, 200) : 'Planning failed.', 500); }
}

/** Approve / edit / skip suggested lines. body: { planId, approved: copyId[], edits?: {copyId: text} } */
export async function PATCH(request: NextRequest) {
  const id = idOf(request), p = getProject(id); if (!p || !p.creative) return bad('No creative plan for this project yet.', 404);
  let b: Record<string, unknown>; try { b = await request.json(); } catch { return bad('Invalid JSON body.'); }
  if (b.planId !== p.creative.id) return bad('That plan is out of date. Generate the plan again.', 409);
  const valid = new Set(pendingReview(p.creative.copy).map((c) => c.id));
  if (!Array.isArray(b.approved) || !b.approved.every((x) => typeof x === 'string' && valid.has(x))) return bad('approved must list ids of suggested lines in this plan.');
  const edits: Record<string, string> = {};
  if (b.edits !== undefined) {
    if (!b.edits || typeof b.edits !== 'object' || Array.isArray(b.edits)) return bad('edits must be an object.');
    for (const [k, v] of Object.entries(b.edits as Record<string, unknown>)) { if (!valid.has(k) || typeof v !== 'string' || v.length > 80) return bad('invalid edit.'); if (v.trim()) edits[k] = v.trim(); }
  }
  const q = updateProject(id, (x) => { x.config = { ...x.config, copyApproval: { planId: x.creative!.id, approved: b.approved as string[], edits } }; });
  return NextResponse.json({ success: true, project: q });
}
