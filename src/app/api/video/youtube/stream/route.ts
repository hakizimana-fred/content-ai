import { NextRequest } from 'next/server';
import { getIngestionJob } from '@/lib/db';
import { subscribeToJob } from '@/lib/ingestion-service';
import { IngestionJob } from '@/types/video';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('id');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'Job ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const initialJob = getIngestionJob(jobId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: IngestionJob) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller might already be closed
        }
      };

      // Send initial state immediately
      if (initialJob) {
        sendEvent('update', initialJob);
        if (initialJob.status === 'completed' || initialJob.status === 'error') {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // ignore
            }
          }, 300);
          return;
        }
      }

      // Subscribe to real-time updates
      const unsubscribe = subscribeToJob(jobId, (updatedJob) => {
        sendEvent('update', updatedJob);

        if (updatedJob.status === 'completed' || updatedJob.status === 'error') {
          setTimeout(() => {
            unsubscribe();
            try {
              controller.close();
            } catch {
              // ignore
            }
          }, 500);
        }
      });

      // Keepalive heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
