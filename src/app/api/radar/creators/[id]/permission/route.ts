import { NextRequest, NextResponse } from 'next/server';
import { grantPermission, revokePermission } from '@/lib/radar/store';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const body = await request.json().catch(() => ({}));
  const r = grantPermission((await params).id, body);
  return r.ok ? NextResponse.json({ success: true, creator: r.creator }) : NextResponse.json({ success: false, error: r.error }, { status: r.status });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const body = await request.json().catch(() => ({}));
  const c = revokePermission((await params).id, body?.reason);
  return c ? NextResponse.json({ success: true, creator: c }) : NextResponse.json({ success: false, error: 'Creator not found' }, { status: 404 });
}
