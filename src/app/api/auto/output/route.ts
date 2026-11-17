import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getProject, renderDir } from '@/lib/auto/store';
import { serveFile } from '@/lib/auto/serve';

/** GET ?project=ID&file=video_123.mp4[&download=1] -> the finished video (Range-capable for the preview player). */
export async function GET(request: NextRequest) {
  const u = new URL(request.url), pid = u.searchParams.get('project') ?? '', file = path.basename(u.searchParams.get('file') ?? '');
  if (!getProject(pid) || !/^video_\d+\.mp4$/.test(file)) return new Response('Not found', { status: 404 });
  const f = path.join(renderDir(pid), file); if (!fs.existsSync(f)) return new Response('Not found', { status: 404 });
  return serveFile(request, f, u.searchParams.get('download') === '1' ? { download: `${(getProject(pid)!.name || 'video').slice(0, 40)}.mp4` } : {});
}
