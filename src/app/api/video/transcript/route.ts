import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getCachedTranscript, transcribeMedia } from '@/lib/intelligence/transcription-service';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';
import { UPLOADS_DIR } from '@/lib/paths';
import { probeVideo } from '@/lib/ffmpeg';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId');

    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId required' }, { status: 400 });
    }

    const transcript = getCachedTranscript(sourceId);
    if (!transcript) {
      return NextResponse.json({ success: false, error: 'Transcript not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, transcript });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceId, model = 'base', language } = body;

    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId required' }, { status: 400 });
    }

    // Check cached first
    const cached = getCachedTranscript(sourceId);
    if (cached) {
      return NextResponse.json({ success: true, transcript: cached, cached: true });
    }

    // Locate source file
    let source = videoStore.getSource(sourceId);
    if (!source || !fs.existsSync(source.localPath)) {
      const dbProject = getProjectById(sourceId);
      if (dbProject && fs.existsSync(dbProject.localPath)) {
        source = dbProject;
        videoStore.setSource(source);
      }
    }

    if (!source || !fs.existsSync(source.localPath)) {
      const uploadFiles = fs.readdirSync(UPLOADS_DIR);
      const matched = uploadFiles.find(
        (f) =>
          f.includes(sourceId) ||
          (sourceId === 'sample_video_default' && f === 'sample-preview.mp4')
      );

      if (matched) {
        const fullPath = path.join(UPLOADS_DIR, matched);
        const meta = await probeVideo(fullPath);
        source = {
          id: sourceId,
          title: matched,
          filename: matched,
          localPath: fullPath,
          streamUrl: `/api/video/stream?type=source&filename=${encodeURIComponent(matched)}`,
          metadata: meta,
          sourceOrigin: 'upload',
          createdAt: Date.now(),
        };
        videoStore.setSource(source);
      }
    }

    if (!source || !fs.existsSync(source.localPath)) {
      return NextResponse.json({ success: false, error: 'Source media file not found' }, { status: 404 });
    }

    // Run transcription (runs faster-whisper locally with int8 CPU)
    const transcript = await transcribeMedia(sourceId, source.localPath, model, language);

    return NextResponse.json({ success: true, transcript, cached: false });
  } catch (err) {
    console.error('Transcription route error:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Transcription failed' },
      { status: 500 }
    );
  }
}
