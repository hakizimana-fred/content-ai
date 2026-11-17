import { NextResponse } from 'next/server';
import { detectHardware } from '@/lib/studio/hardware';
import { MODEL_CATALOG, checkFit } from '@/lib/studio/models';

/** Hardware profile plus, per catalog model, whether it fits this machine. Read-only; downloads nothing. */
export async function GET() {
  const hardware = detectHardware();
  const models = MODEL_CATALOG.map((m) => ({ ...m, fit: checkFit(m, hardware) }));
  return NextResponse.json({ success: true, hardware, models });
}
