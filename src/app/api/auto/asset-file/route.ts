import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { assetsDir, getProject, isAssetId } from '@/lib/auto/store';
import { serveFile } from '@/lib/auto/serve';

/** GET ?project=ID&asset=ID[&thumb=1] -> the stored media (or its thumbnail) for the media tray / preview. */
export async function GET(request: NextRequest) {
  const u = new URL(request.url), pid = u.searchParams.get('project') ?? '', aid = u.searchParams.get('asset') ?? '';
  const p = getProject(pid), a = isAssetId(aid) ? p?.assets.find((x) => x.id === aid) : null; if (!p || !a) return new Response('Not found', { status: 404 });
  const rel = u.searchParams.get('thumb') === '1' ? a.thumb : a.file; if (!rel) return new Response('No thumbnail', { status: 404 });
  const f = path.join(assetsDir(pid), path.basename(rel)); return fs.existsSync(f) ? serveFile(request, f) : new Response('Not found', { status: 404 });
}
