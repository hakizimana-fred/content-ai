import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { UPLOADS_DIR, initStorageDirs } from '@/lib/paths';
import { probeVideo } from '@/lib/ffmpeg';
import { videoStore } from '@/lib/store';
import { VideoSource } from '@/types/video';

export async function GET() {
  try {
    initStorageDirs();
    const sampleFilename = 'sample-preview.mp4';
    const samplePath = path.join(UPLOADS_DIR, sampleFilename);

    if (!fs.existsSync(samplePath)) {
      // Generate sample 15s test pattern video with timecode and audio
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-f', 'lavfi', '-i', 'testsrc=duration=20:size=1280x720:rate=30',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          samplePath,
          '-y',
        ]);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Failed to generate sample video, code ${code}`));
        });
        proc.on('error', reject);
      });
    }

    const metadata = await probeVideo(samplePath);
    const id = 'sample_video_default';

    const source: VideoSource = {
      id,
      title: 'Sample Test Video (720p 30fps)',
      filename: sampleFilename,
      localPath: samplePath,
      streamUrl: `/api/video/stream?type=source&filename=${encodeURIComponent(sampleFilename)}`,
      metadata,
      sourceOrigin: 'sample',
      createdAt: Date.now(),
    };

    videoStore.setSource(source);

    return NextResponse.json({ success: true, source });
  } catch (err) {
    console.error('Sample video error:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to load sample video' },
      { status: 500 }
    );
  }
}
