import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { THUMBS_DIR, initStorageDirs } from '@/lib/paths';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/** GET /api/video/frame?sourceId=&t=seconds -> 480px JPEG still (fast keyframe seek; cached on disk). */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const sourceId = sp.get('sourceId');
  const t = Number(sp.get('t'));
  if (!sourceId || !Number.isFinite(t) || t < 0) return NextResponse.json({ success: false, error: 'sourceId and t required' }, { status: 400 });
  const source = videoStore.getSource(sourceId) ?? getProjectById(sourceId);
  if (!source || !fs.existsSync(source.localPath)) return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });

  initStorageDirs();
  const dir = path.join(THUMBS_DIR, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const at = Math.min(Math.max(0, t), Math.max(0, source.metadata.duration - 0.1));
  const file = path.join(dir, `${sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Math.round(at * 10)}.jpg`);

  if (!fs.existsSync(file)) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(FFMPEG, ['-v', 'error', '-ss', at.toFixed(2), '-i', source.localPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-y', file]);
      p.on('error', () => resolve(false));
      p.on('close', (c) => resolve(c === 0 && fs.existsSync(file)));
    });
    if (!ok) return NextResponse.json({ success: false, error: 'Could not extract frame' }, { status: 500 });
  }
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' } });
}
