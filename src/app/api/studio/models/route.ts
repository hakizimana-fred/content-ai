import { NextRequest, NextResponse } from 'next/server';
import { detectHardware } from '@/lib/studio/hardware';
import { MODEL_CATALOG, checkFit } from '@/lib/studio/models';
import { modelFile, runtimeAvailable, LLAMA_SERVER_BIN } from '@/lib/studio/llama-runtime';
import { downloadStates, findModel, isInstalled, removeModel, startDownload, systemSnapshot } from '@/lib/studio/models-admin';
import { getPreferredPlannerId, setPreferredPlannerId } from '@/lib/studio/settings';
import { DEFAULT_PLANNER_ID, modelServerRssMB, plannerStatus, resourceStatus, testPlanner } from '@/lib/studio/service';
import fs from 'node:fs';

/** Model catalog with install state, hardware fit, licence info and a live resource snapshot. */
export async function GET() {
  const hw = detectHardware(0);
  const dl = downloadStates();
  const preferred = getPreferredPlannerId() ?? DEFAULT_PLANNER_ID;
  const models = MODEL_CATALOG.map((m) => ({
    ...m, installed: isInstalled(m), fit: checkFit(m, hw, { requireCommercial: true }), preferred: m.id === preferred, download: dl[m.id] ?? null,
    fileSizeMB: isInstalled(m) ? Math.round(fs.statSync(modelFile(m)).size / 1048576) : null,
    runtime: runtimeAvailable(m),
  }));
  const rm = resourceStatus();
  return NextResponse.json({
    success: true, hardware: hw, models, runtimeBinary: { path: LLAMA_SERVER_BIN, present: fs.existsSync(LLAMA_SERVER_BIN) },
    resources: { ...systemSnapshot(), modelServerRssMB: modelServerRssMB(), ...rm, planner: plannerStatus().usable },
  });
}

/** POST { id, action: 'download' | 'select' | 'test' } — every action is explicit; nothing downloads automatically. */
export async function POST(request: NextRequest) {
  let body: { id?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }
  const spec = typeof body.id === 'string' ? findModel(body.id) : null;
  if (!spec) return NextResponse.json({ success: false, error: 'Unknown model.' }, { status: 404 });
  const hw = detectHardware(0);
  if (body.action === 'download') {
    const r = startDownload(spec, hw.diskFreeMB);
    return r.ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: r.error }, { status: r.status });
  }
  if (body.action === 'select') {
    const fit = checkFit(spec, hw, { requireCommercial: true });
    if (!fit.ok) return NextResponse.json({ success: false, error: `Cannot select: ${fit.reason}` }, { status: 400 });
    if (!isInstalled(spec)) return NextResponse.json({ success: false, error: 'Install the model first.' }, { status: 400 });
    setPreferredPlannerId(spec.id); return NextResponse.json({ success: true });
  }
  if (body.action === 'test') {
    const rt = runtimeAvailable(spec); if (!rt.ok) return NextResponse.json({ success: false, error: rt.reason }, { status: 400 });
    const fit = checkFit(spec, hw, { requireCommercial: true }); if (!fit.ok) return NextResponse.json({ success: false, error: fit.reason }, { status: 400 });
    return NextResponse.json({ success: true, result: await testPlanner(spec) });
  }
  return NextResponse.json({ success: false, error: 'action must be download, select or test.' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const spec = findModel(new URL(request.url).searchParams.get('id') ?? '');
  if (!spec) return NextResponse.json({ success: false, error: 'Unknown model.' }, { status: 404 });
  return removeModel(spec) ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: 'Model is not installed.' }, { status: 404 });
}
