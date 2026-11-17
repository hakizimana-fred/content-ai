import { NextRequest, NextResponse } from 'next/server';
import { createPlan, plannerStatus, resourceStatus } from '@/lib/studio/service';
import { validatePlan } from '@/lib/studio/plan';
import { getIdentity } from '@/lib/studio/identity-store';
import { applyIdentityToPlan } from '@/lib/studio/identity';

/** POST { instruction, basePlan?, useModel?, identityId? } -> validated editing plan. Fully offline. */
export async function POST(request: NextRequest) {
  let body: { instruction?: unknown; basePlan?: unknown; useModel?: unknown; identityId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  if (typeof body.instruction !== 'string' || !body.instruction.trim()) return NextResponse.json({ success: false, error: 'instruction is required.' }, { status: 400 });
  if (body.instruction.length > 2000) return NextResponse.json({ success: false, error: 'instruction is too long (max 2000 characters).' }, { status: 400 });
  let base;
  if (body.basePlan !== undefined) {
    const v = validatePlan(body.basePlan);
    if (!v.ok) return NextResponse.json({ success: false, error: `basePlan invalid: ${v.errors.join('; ')}` }, { status: 400 });
    base = v.plan;
  }
  try {
    const result = await createPlan(body.instruction, { base, useModel: body.useModel !== false });
    let identity = null;
    if (typeof body.identityId === 'string' && body.identityId) {
      identity = getIdentity(body.identityId);
      if (!identity) return NextResponse.json({ success: false, error: 'identity not found.' }, { status: 404 });
      // Identity fills what the user did not say; explicit words always win.
      result.plan = applyIdentityToPlan(result.plan, identity, result.explicit);
    }
    return NextResponse.json({ success: true, ...result, identity });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Director failed.' }, { status: 500 });
  }
}

/** GET -> planner model status and resource manager state. */
export async function GET() {
  const { spec, usable, reason } = plannerStatus();
  return NextResponse.json({ success: true, planner: { id: spec.id, usable, reason }, resources: resourceStatus() });
}
