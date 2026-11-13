import { NextRequest, NextResponse } from 'next/server';
import {
  startIngestion,
  cancelIngestion,
} from '@/lib/ingestion-service';
import {
  getIngestionJob,
  getLatestActiveIngestionJob,
} from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, confirmedOwnership, forceReimport } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'YouTube URL is required.' }, { status: 400 });
    }

    const job = await startIngestion(url, Boolean(confirmedOwnership), Boolean(forceReimport));

    return NextResponse.json({
      success: true,
      job,
      reused: job.status === 'completed' && Boolean(job.project),
      source: job.project,
    });
  } catch (err: any) {
    console.error('YouTube ingestion start error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to start YouTube video ingestion.' },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const active = searchParams.get('active');

    if (active === 'true') {
      const activeJob = getLatestActiveIngestionJob();
      return NextResponse.json({ success: true, job: activeJob });
    }

    if (id) {
      const job = getIngestionJob(id);
      if (!job) {
        return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, job });
    }

    return NextResponse.json({ success: false, error: 'Missing job ID' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
