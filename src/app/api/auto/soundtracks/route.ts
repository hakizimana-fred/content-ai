import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/auto/store';
import { interpretIntent } from '@/lib/auto/profiles';
import { recommend } from '@/lib/auto/soundtrack';
import { listEntries } from '@/lib/studio/library';

/** GET ?project=ID -> library tracks ranked for this video's wording, with the reasons shown to the user. */
export async function GET(request: NextRequest) {
  const p = getProject(new URL(request.url).searchParams.get('project') ?? ''); if (!p) return NextResponse.json({ success: false, error: 'project not found' }, { status: 404 });
  const intent = interpretIntent(p.config.prompt, p.config.style);
  return NextResponse.json({ success: true, intent: { style: intent.style, mood: intent.mood, intensity: intent.intensity }, recommendations: recommend(intent, p.config.durationSec, listEntries(), 8).map((r) => ({ ...r, entry: r.entry })) });
}
