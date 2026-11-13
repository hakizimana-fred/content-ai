import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { THUMBS_DIR, initStorageDirs } from '@/lib/paths';
import { generateFilmstrip } from '@/lib/ffmpeg';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';

const TILES = 40;
const inFlight = new Map<string, Promise<void>>();

/** GET /api/video/filmstrip?sourceId=... -> JPEG strip of 40 thumbnails (generated once, cached on disk). */
export async function GET(request: NextRequest) {
  const sourceId = new URL(request.url).searchParams.get('sourceId');
  if (!sourceId) return NextResponse.json({ success: false, error: 'sourceId is required' }, { status: 400 });

  const source = videoStore.getSource(sourceId) ?? getProjectById(sourceId);
  if (!source || !fs.existsSync(source.localPath)) {
    return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });
  }

  initStorageDirs();
  const out = path.join(THUMBS_DIR, `${path.basename(sourceId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${TILES}.jpg`);

  if (!fs.existsSync(out)) {
    // Coalesce concurrent requests for the same file.
    let job = inFlight.get(out);
    if (!job) {
      job = generateFilmstrip(source.localPath, out, source.metadata.duration, TILES).finally(() => inFlight.delete(out));
      inFlight.set(out, job);
    }
    try {
      await job;
    } catch (err) {
      return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
    }
  }

  return new Response(fs.readFileSync(out), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
}
