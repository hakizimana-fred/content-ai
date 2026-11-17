import { NextRequest, NextResponse } from 'next/server';
import { createIdentity, deleteIdentity, listIdentities, updateIdentity } from '@/lib/studio/identity-store';
import { IDENTITY_TEMPLATES } from '@/lib/studio/identity';
import { removeLogo } from '@/lib/studio/logo-store';

const bad = (errors: string[], status = 400) => NextResponse.json({ success: false, error: errors.join('; '), errors }, { status });
async function body(request: NextRequest) { try { return await request.json(); } catch { return null; } }

export async function GET() {
  return NextResponse.json({ success: true, identities: listIdentities(), templates: Object.entries(IDENTITY_TEMPLATES).map(([key, t]) => ({ key, name: t.name })) });
}
/** POST { identity } or { template } */
export async function POST(request: NextRequest) {
  const b = await body(request); if (!b) return bad(['Invalid JSON body.']);
  const input = typeof b.template === 'string' ? IDENTITY_TEMPLATES[b.template] : b.identity;
  if (!input) return bad(['identity or a known template is required.']);
  const r = createIdentity(input); return r.ok ? NextResponse.json({ success: true, identity: r.identity }) : bad(r.errors);
}
export async function PUT(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? ''; const b = await body(request); if (!b) return bad(['Invalid JSON body.']);
  const r = updateIdentity(id, b.identity); return r.ok ? NextResponse.json({ success: true, identity: r.identity }) : bad(r.errors, r.notFound ? 404 : 400);
}
export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  removeLogo(id); // its image file goes with it
  return deleteIdentity(id) ? NextResponse.json({ success: true }) : bad(['identity not found'], 404);
}
