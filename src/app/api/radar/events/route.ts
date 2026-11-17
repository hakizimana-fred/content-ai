import { NextRequest } from 'next/server';
import { bus } from '@/lib/radar/events';

/** Server-sent events: the browser subscribes once and the backend pushes every change. No frontend polling. */
export async function GET(request: NextRequest) {
  const enc = new TextEncoder();
  let off: (() => void) | null = null, hb: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { cleanup(); } };
      const cleanup = () => { off?.(); off = null; if (hb) clearInterval(hb); hb = null; try { controller.close(); } catch { /* already closed */ } };
      send({ type: 'hello' });
      off = bus.subscribe(send);
      hb = setInterval(() => { try { controller.enqueue(enc.encode(': keep-alive\n\n')); } catch { cleanup(); } }, 25_000);
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() { off?.(); if (hb) clearInterval(hb); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
