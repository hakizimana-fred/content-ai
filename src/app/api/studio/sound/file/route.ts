import { NextRequest } from 'next/server';
import fs from 'node:fs';
import { MIME_OF, audioFile, getItem } from '@/lib/studio/library';

/** Streams a library WAV for auditioning, with Range support so the browser can seek. */
export async function GET(request: NextRequest) {
  const f = audioFile(new URL(request.url).searchParams.get('id') ?? '');
  if (!f) return new Response('Not found', { status: 404 });
  const p = f.path;
  const dl = new URL(request.url).searchParams.get('download') === '1';
  const size = fs.statSync(p).size, range = request.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  const headers: Record<string, string> = { 'Content-Type': MIME_OF[f.ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  if (dl) { const it = getItem(new URL(request.url).searchParams.get('id') ?? ''); headers['Content-Disposition'] = `attachment; filename="${(it?.label ?? 'track').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60)}.${f.ext}"`; }
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response('Bad range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const buf = Buffer.alloc(end - start + 1), fd = fs.openSync(p, 'r'); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
    return new Response(buf, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length) } });
  }
  return new Response(fs.readFileSync(p), { headers: { ...headers, 'Content-Length': String(size) } });
}
