import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getCachedTranscript, generateClipWebVTT, generateClipSRT } from '@/lib/intelligence/transcription-service';
import { getClipById } from '@/lib/db';
import { videoStore } from '@/lib/store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clipId = searchParams.get('clipId');
    const sourceId = searchParams.get('sourceId');
    const format = searchParams.get('format') || 'vtt'; // 'vtt' | 'srt'

    // If sourceId directly requested (full video transcript subtitles)
    if (sourceId && !clipId) {
      const transcript = getCachedTranscript(sourceId);
      if (!transcript) {
        return new NextResponse('Transcript not found', { status: 404 });
      }

      if (format === 'srt') {
        return new NextResponse(transcript.srt, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${sourceId}.srt"`,
          },
        });
      }

      return new NextResponse(transcript.vtt, {
        headers: {
          'Content-Type': 'text/vtt; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (!clipId) {
      return new NextResponse('Missing clipId or sourceId', { status: 400 });
    }

    let clip = videoStore.getClip(clipId) || getClipById(clipId) || undefined;

    if (!clip) {
      return new NextResponse('Clip not found', { status: 404 });
    }

    const transcript = getCachedTranscript(clip.sourceId);
    if (!transcript) {
      return new NextResponse('Transcript not available for this source', { status: 404 });
    }

    if (format === 'srt') {
      const srt = generateClipSRT(transcript, clip.startTime, clip.endTime);
      return new NextResponse(srt, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${clip.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.srt"`,
        },
      });
    }

    const vtt = generateClipWebVTT(transcript, clip.startTime, clip.endTime);
    return new NextResponse(vtt, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new NextResponse((err as Error).message, { status: 500 });
  }
}
