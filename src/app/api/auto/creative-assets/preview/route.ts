import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creativeFile, getCreative } from '@/lib/auto/creative-assets';
import { PY, SCRIPT, run } from '@/lib/auto/media';

/** PNG specimen of a font (generated once, cached next to the font file). */
export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? ''; const a = getCreative(id); const f = a ? creativeFile(a) : null;
  if (!a || (a.kind !== 'font' && a.kind !== 'model') || !f || !fs.existsSync(f)) return NextResponse.json({ success: false, error: 'font not found' }, { status: 404 });
  const cache = path.join(os.tmpdir(), `content-ai-fontpreview-${id}-${Math.round(fs.statSync(f).mtimeMs)}.png`);
  if (!fs.existsSync(cache)) { try { await run(PY(), [SCRIPT(a.kind === 'model' ? 'glb_info.py' : 'font_preview.py')], { input: JSON.stringify({ file: f, out: cache }), timeoutMs: 30_000 }); } catch (e) { return NextResponse.json({ success: false, error: (e as Error).message.slice(-160) }, { status: 422 }); } }
  return new NextResponse(new Uint8Array(fs.readFileSync(cache)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
}
