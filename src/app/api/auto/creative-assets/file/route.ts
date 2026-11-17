import { NextRequest } from 'next/server';
import fs from 'node:fs';
import { creativeFile, getCreative } from '@/lib/auto/creative-assets';
import { serveFile } from '@/lib/auto/serve';

/** GET ?id=ca_... -> the stored creative asset (image/video) for the library preview. */
export async function GET(request: NextRequest) {
  const a = getCreative(new URL(request.url).searchParams.get('id') ?? ''), f = a ? creativeFile(a) : null;
  return f && fs.existsSync(f) ? serveFile(request, f) : new Response('Not found', { status: 404 });
}
