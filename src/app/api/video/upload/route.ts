import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { UPLOADS_DIR, initStorageDirs, sanitizeFilename } from '@/lib/paths';
import { probeVideo } from '@/lib/ffmpeg';
import { videoStore } from '@/lib/store';
import { VideoSource } from '@/types/video';

// In Next.js App Router, body parser supports multipart formData
export async function POST(request: NextRequest) {
  try {
    initStorageDirs();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No video file provided.' }, { status: 400 });
    }

    // Validate type / extension
    const ext = path.extname(file.name).toLowerCase();
    const allowedExtensions = ['.mp4', '.mov', '.webm', '.m4v', '.mkv'];
    if (!allowedExtensions.includes(ext) && !file.type.startsWith('video/')) {
      return NextResponse.json(
        { success: false, error: `Invalid file type (${ext || file.type}). Please upload a valid MP4/video file.` },
        { status: 400 }
      );
    }

    const id = `vid_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const safeBase = sanitizeFilename(path.parse(file.name).name);
    const filename = `${id}_${safeBase}${ext || '.mp4'}`;
    const destinationPath = path.join(UPLOADS_DIR, filename);

    // Stream file to disk efficiently
    const stream = file.stream();
    // @ts-expect-error Readable.fromWeb works in Node 18+
    const nodeStream = Readable.fromWeb(stream);
    const writeStream = fs.createWriteStream(destinationPath);
    await pipeline(nodeStream, writeStream);

    // Extract metadata using FFprobe
    const metadata = await probeVideo(destinationPath);

    if (metadata.duration <= 0) {
      fs.unlinkSync(destinationPath);
      return NextResponse.json(
        { success: false, error: 'The uploaded file is not a valid playable video.' },
        { status: 400 }
      );
    }

    const source: VideoSource = {
      id,
      title: file.name,
      filename,
      localPath: destinationPath,
      streamUrl: `/api/video/stream?type=source&filename=${encodeURIComponent(filename)}`,
      metadata,
      sourceOrigin: 'upload',
      createdAt: Date.now(),
    };

    videoStore.setSource(source);

    return NextResponse.json({ success: true, source });
  } catch (err) {
    console.error('Video upload error:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to process uploaded video.' },
      { status: 500 }
    );
  }
}
