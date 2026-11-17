import fs from 'node:fs';
import path from 'node:path';

export const MIME_BY_EXT: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

/** Stream a file with HTTP Range support so <video>/<audio> can seek. Reads only the requested slice. */
export function serveFile(request: Request, file: string, opts: { download?: string } = {}): Response {
  const size = fs.statSync(file).size, type = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (opts.download) headers['Content-Disposition'] = `attachment; filename="${opts.download.replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
  const m = request.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0, end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response('Bad range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const len = Math.min(end - start + 1, 8 * 1024 * 1024), buf = Buffer.alloc(len), fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, len, start); fs.closeSync(fd);
    return new Response(new Uint8Array(buf), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${start + len - 1}/${size}`, 'Content-Length': String(len) } });
  }
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { ...headers, 'Content-Length': String(size) } });
}
