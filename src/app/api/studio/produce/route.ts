import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { THUMBS_DIR } from '@/lib/paths';
import { analyzeVideoContent } from '@/lib/intelligence/intelligence-service';
import { getCachedTranscript } from '@/lib/intelligence/transcription-service';
import { createPlan } from '@/lib/studio/service';
import { getIdentity } from '@/lib/studio/identity-store';
import { applyIdentityToPlan } from '@/lib/studio/identity';
import { chooseMoment } from '@/lib/studio/moment';
import { productionFromPlan } from '@/lib/studio/produce';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';

/**
 * Autonomous production, step 1: instruction -> plan -> best moment -> render-ready clip spec.
 * The page then runs the spec through the normal export flow (same progress UI, same ffmpeg renderer).
 * POST { sourceId, instruction, identityId?, start?, end?, useModel? }
 */
export async function POST(request: NextRequest) {
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  const sourceId = typeof b.sourceId === 'string' ? b.sourceId : '', instruction = typeof b.instruction === 'string' ? b.instruction.trim() : '';
  if (!sourceId || !instruction) return NextResponse.json({ success: false, error: 'sourceId and instruction are required.' }, { status: 400 });
  const source = videoStore.getSource(sourceId) ?? getProjectById(sourceId);
  if (!source || !fs.existsSync(source.localPath)) return NextResponse.json({ success: false, error: 'Source video not found.' }, { status: 404 });
  const steps: string[] = [];
  try {
    // 1. understand the instruction
    const planned = await createPlan(instruction, { useModel: b.useModel !== false });
    let plan = planned.plan, identity = null;
    if (typeof b.identityId === 'string' && b.identityId) {
      identity = getIdentity(b.identityId);
      if (!identity) return NextResponse.json({ success: false, error: 'identity not found.' }, { status: 404 });
      plan = applyIdentityToPlan(plan, identity, planned.explicit); steps.push(`applied identity "${identity.name}"`);
    }
    steps.push(`plan from ${planned.source === 'hybrid' ? 'local model + rules' : 'rules'}`);

    // 2. choose the range: the user's own selection wins, otherwise the best analysed moment for the target length
    let start: number, end: number, title = 'Short', momentId: string | null = null;
    if (Number.isFinite(b.start) && Number.isFinite(b.end) && (b.end as number) > (b.start as number)) {
      start = b.start as number; end = Math.min(b.end as number, source.metadata.duration); steps.push('used your selected range');
      if (end - start > plan.duration_target + 8) { end = start + plan.duration_target; steps.push(`trimmed to the ${plan.duration_target}s target`); }
    } else {
      const report = await analyzeVideoContent({ sourceId, targetCount: 6, minDuration: Math.min(22, plan.duration_target), maxDuration: Math.max(70, plan.duration_target + 15) });
      const pick = chooseMoment(report.candidates, plan.duration_target);
      if (!pick) return NextResponse.json({ success: false, error: 'No candidate moments found in this video.' }, { status: 422 });
      start = pick.start; end = pick.end; momentId = pick.moment.id; title = pick.moment.recommendedHook?.english || pick.moment.title;
      steps.push(`picked moment "${pick.moment.title}" (score ${pick.moment.score})${pick.trimmed ? `, trimmed to ${plan.duration_target}s` : ''}`);
    }
    if (end > source.metadata.duration) end = source.metadata.duration;

    // 3. gather render inputs that already exist locally
    const transcript = getCachedTranscript(sourceId);
    const sceneFile = path.join(THUMBS_DIR, `${sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}_scenes.json`);
    const scenes: number[] = fs.existsSync(sceneFile) ? JSON.parse(fs.readFileSync(sceneFile, 'utf8')) : [];
    const sceneTimesInClip = scenes.filter((t) => t > start + 1 && t < end - 1).map((t) => +(t - start).toFixed(2));
    let track: { t: number; x: number }[] | null = null;
    if (plan.framing === 'speaker_tracking' && plan.format !== 'landscape_16_9') {
      try {
        const r = await fetch(new URL('/api/video/framing', request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, start, end: Math.min(end, start + 180) }) });
        const d = await r.json(); if (d.success && Array.isArray(d.keyframes) && d.keyframes.length) { track = d.keyframes; steps.push(`tracked the speaker (${d.keyframes.length} keyframes)`); } else steps.push(`speaker tracking unavailable (${d.error ?? 'no face found'}); centre framing`);
      } catch { steps.push('speaker tracking unavailable; centre framing'); }
    }

    // 4. translate the plan into what the renderer understands
    const result = productionFromPlan(plan, { identity, title, hasTranscript: !!transcript, sceneTimesInClip, seed: Math.abs(hash(`${sourceId}|${instruction}`)) % 9000 + 1, track });
    return NextResponse.json({ success: true, plan, identity, source: planned.source, steps, clip: { name: title.slice(0, 60), startTime: start, endTime: end, momentId, production: result.production }, applied: result.applied, skipped: result.skipped, warnings: planned.warnings });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Production failed.', steps }, { status: 500 });
  }
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
