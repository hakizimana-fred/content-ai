import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeVideoId } from '@/lib/youtube';
import { getProjectByYouTubeId, getClipsByProjectId } from '@/lib/db';
import fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
    }

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'Invalid YouTube URL or video ID' },
        { status: 400 }
      );
    }

    const existingProject = getProjectByYouTubeId(videoId);

    if (existingProject) {
      // Check if original video file is still on disk
      const isFileAvailable = fs.existsSync(existingProject.localPath);

      if (isFileAvailable) {
        const clips = getClipsByProjectId(existingProject.id);
        return NextResponse.json({
          success: true,
          exists: true,
          videoId,
          project: {
            ...existingProject,
            isAvailable: true,
          },
          clips,
        });
      }
    }

    return NextResponse.json({
      success: true,
      exists: false,
      videoId,
    });
  } catch (err) {
    console.error('Error checking duplicate video:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to check duplicate video' },
      { status: 500 }
    );
  }
}
