import { NextRequest, NextResponse } from 'next/server';
import { cancelIngestion } from '@/lib/ingestion-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Job ID is required' }, { status: 400 });
    }

    const cancelled = cancelIngestion(jobId);
    return NextResponse.json({ success: true, cancelled });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
