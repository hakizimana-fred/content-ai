import { NextRequest, NextResponse } from 'next/server';
import { getCreator, removeCreator, updateCreator } from '@/lib/radar/store';

type Ctx = { params: Promise<{ id: string }> };
const nf = () => NextResponse.json({ success: false, error: 'Creator not found' }, { status: 404 });

export async function GET(_r: NextRequest, { params }: Ctx) {
  const c = getCreator((await params).id);
  return c ? NextResponse.json({ success: true, creator: c }) : nf();
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const patch = await request.json().catch(() => null);
  if (!patch || typeof patch !== 'object') return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  if (patch.monitoring && !['active', 'paused'].includes(patch.monitoring)) return NextResponse.json({ success: false, error: 'Invalid monitoring status' }, { status: 400 });
  const c = updateCreator((await params).id, patch);
  return c ? NextResponse.json({ success: true, creator: c }) : nf();
}

export async function DELETE(_r: NextRequest, { params }: Ctx) {
  return removeCreator((await params).id) ? NextResponse.json({ success: true }) : nf();
}
