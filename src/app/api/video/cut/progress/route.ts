import { NextRequest } from 'next/server';
import { videoStore } from '@/lib/store';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clipId = searchParams.get('clipId');

  if (!clipId) {
    return new Response('clipId parameter is required', { status: 400 });
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Send updates periodically until finished or connection closes
  let isClosed = false;
  let notFoundAttempts = 0;

  const interval = setInterval(async () => {
    if (isClosed) return;
    try {
      const clip = videoStore.getClip(clipId);
      if (!clip) {
        notFoundAttempts += 1;
        // Allow up to 20 ticks (5 seconds) for the POST cut request to register the clip
        if (notFoundAttempts > 20) {
          clearInterval(interval);
          await writer.write(encoder.encode(`data: ${JSON.stringify({ error: 'Clip not found' })}\n\n`));
          await writer.close();
        }
        return;
      }

      await writer.write(encoder.encode(`data: ${JSON.stringify(clip)}\n\n`));

      if (clip.status === 'completed' || clip.status === 'error') {
        clearInterval(interval);
        setTimeout(async () => {
          try {
            await writer.close();
          } catch {
            // ignore
          }
        }, 500);
      }
    } catch {
      clearInterval(interval);
      isClosed = true;
    }
  }, 250);

  request.signal.addEventListener('abort', () => {
    isClosed = true;
    clearInterval(interval);
    try {
      writer.close();
    } catch {
      // ignore
    }
  });

  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
