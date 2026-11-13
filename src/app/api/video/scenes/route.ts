import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { THUMBS_DIR, initStorageDirs } from '@/lib/paths';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const cachePath = (id: string) => path.join(THUMBS_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}_scenes.json`);
const inFlight = new Map<string, Promise<number[]>>();

/** GET -> cached scene boundaries (404 if never computed). */
export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('sourceId');
  if (!id) return NextResponse.json({ success: false, error: 'sourceId required' }, { status: 400 });
  initStorageDirs();
  const f = cachePath(id);
  if (!fs.existsSync(f)) return NextResponse.json({ success: false, error: 'Not computed' }, { status: 404 });
  return NextResponse.json({ success: true, scenes: JSON.parse(fs.readFileSync(f, 'utf8')) });
}

/**
 * POST -> detect scene changes. Looks at keyframes only (encoders place keyframes on cuts), so it
 * stays fast on long videos; boundaries are therefore approximate to the nearest keyframe.
 */
export async function POST(request: NextRequest) {
  const { sourceId } = await request.json();
  const source = sourceId ? (videoStore.getSource(sourceId) ?? getProjectById(sourceId)) : null;
  if (!source || !fs.existsSync(source.localPath)) return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });
  initStorageDirs();

  let job = inFlight.get(sourceId);
  if (!job) {
    job = new Promise<number[]>((resolve, reject) => {
      const times: number[] = [];
      const p = spawn(FFMPEG, ['-v', 'info', '-skip_frame', 'nokey', '-i', source.localPath, '-an', '-vf', "scale=160:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-']);
      p.stderr.on('data', (d) => {
        for (const m of d.toString().matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(parseFloat(m[1]).toFixed(2)));
      });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve(times) : reject(new Error(`ffmpeg exited ${c}`))));
    }).finally(() => inFlight.delete(sourceId));
    inFlight.set(sourceId, job);
  }
  try {
    const scenes = await job;
    fs.writeFileSync(cachePath(sourceId), JSON.stringify(scenes));
    return NextResponse.json({ success: true, scenes });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
