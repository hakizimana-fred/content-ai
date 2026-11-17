import { NextResponse } from 'next/server';
import { getMonitor, startMonitor } from '@/lib/radar/monitor';

export async function GET() {
  const m = getMonitor() ?? startMonitor();   // normally already running from instrumentation.ts
  return NextResponse.json({ success: true, monitor: m.status() });
}
