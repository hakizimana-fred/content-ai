import { NextRequest, NextResponse } from 'next/server';
import { analyzeVideoContent } from '@/lib/intelligence/intelligence-service';
import { getContentAnalysisReport } from '@/lib/db';
import { AnalyzeRequest } from '@/lib/intelligence/types';

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { sourceId } = body;

    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId is required' }, { status: 400 });
    }

    const report = await analyzeVideoContent(body);

    return NextResponse.json({
      success: true,
      report,
      candidates: report.candidates,
      metrics: report.metrics,
    });
  } catch (err: any) {
    console.error('Content analysis error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to analyze video content' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId');

    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId is required' }, { status: 400 });
    }

    const report = getContentAnalysisReport(sourceId);
    if (!report) {
      return NextResponse.json({ success: false, error: 'No analysis found for this video' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      report,
      candidates: report.candidates,
      metrics: report.metrics,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
