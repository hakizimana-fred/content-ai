import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { getIdentity } from '@/lib/studio/identity-store';
import { MIME, logoFile, removeLogo, saveLogo } from '@/lib/studio/logo-store';

const idOf = (r: NextRequest) => new URL(r.url).searchParams.get('id') ?? '';

/** POST ?id=<identityId>  body = raw image bytes (PNG/JPEG/WebP, max 2 MB). */
export async function POST(request: NextRequest) {
  const buf = Buffer.from(await request.arrayBuffer());
  const r = saveLogo(idOf(request), buf);
  return r.ok ? NextResponse.json({ success: true, identity: getIdentity(idOf(request)) }) : NextResponse.json({ success: false, error: r.error }, { status: r.status });
}
export async function GET(request: NextRequest) {
  const f = logoFile(idOf(request)); if (!f) return NextResponse.json({ success: false, error: 'no logo' }, { status: 404 });
  const ext = getIdentity(idOf(request))!.logo!.ext;
  return new NextResponse(new Uint8Array(fs.readFileSync(f)), { headers: { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' } });
}
export async function DELETE(request: NextRequest) {
  return removeLogo(idOf(request)) ? NextResponse.json({ success: true, identity: getIdentity(idOf(request)) }) : NextResponse.json({ success: false, error: 'identity not found' }, { status: 404 });
}
