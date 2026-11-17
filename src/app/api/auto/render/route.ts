import { NextRequest, NextResponse } from 'next/server';
import { cancelJob, startRender } from '@/lib/auto/pipeline';
import { transcribeMedia } from '@/lib/intelligence/transcription-service';
import { assetPath } from '@/lib/auto/store';

const idOf = (r: NextRequest) => new URL(r.url).searchParams.get('project') ?? '';

/** POST ?project=ID -> start making the video in the background (poll GET /api/auto/projects?id=ID for real stage progress). */
export async function POST(request: NextRequest) {
  const r = startRender(idOf(request), {
    transcribe: async (a, p) => { const t = await transcribeMedia(`auto_${a.id}`, assetPath(p, a), 'base'); return t.segments.length ? { segments: t.segments } : null; },
  });
  return r.ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: r.error }, { status: r.status });
}
export async function DELETE(request: NextRequest) {
  return cancelJob(idOf(request)) ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: 'Nothing is being made for this project.' }, { status: 404 });
}
