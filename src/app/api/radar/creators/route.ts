import { NextRequest, NextResponse } from 'next/server';
import { addCreator, listCreators } from '@/lib/radar/store';

export async function GET() {
  return NextResponse.json({ success: true, creators: listCreators() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const r = addCreator(body ?? {});
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    return NextResponse.json({ success: true, creator: r.creator }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 400 });
  }
}
