import { NextRequest, NextResponse } from 'next/server';
import { listSessions } from '@/lib/radar/store';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return NextResponse.json({ success: true, sessions: listSessions({ creatorId: sp.get('creatorId') ?? undefined, limit: Number(sp.get('limit')) || 200 }) });
}
