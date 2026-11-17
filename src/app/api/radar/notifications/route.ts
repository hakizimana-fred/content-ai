import { NextRequest, NextResponse } from 'next/server';
import { listNotifications, markNotificationsRead } from '@/lib/radar/store';

export async function GET() { return NextResponse.json({ success: true, notifications: listNotifications(100) }); }

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  markNotificationsRead(b?.ids === 'all' || !Array.isArray(b?.ids) ? 'all' : b.ids);
  return NextResponse.json({ success: true });
}
