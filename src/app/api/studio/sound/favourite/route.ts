import { NextRequest, NextResponse } from 'next/server';
import { setFavourite } from '@/lib/studio/library';

/** POST { id, on } -> mark / unmark a library track as a favourite. */
export async function POST(request: NextRequest) {
  let b: { id?: unknown; on?: unknown }; try { b = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  if (typeof b.id !== 'string' || typeof b.on !== 'boolean') return NextResponse.json({ success: false, error: 'id and on are required.' }, { status: 400 });
  return setFavourite(b.id, b.on) ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: 'Track not found.' }, { status: 404 });
}
