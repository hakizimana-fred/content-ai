import fs from 'fs';
import { EventEmitter } from 'events';
import { videoStore } from '@/lib/store';
import { getProjectById, getContentAnalysisReport, upsertContentAnalysisReport } from '@/lib/db';
import { analyzeAudioSignal } from './signal-analyzer';
import { scoreCandidateMoments } from './attention-scorer';
import { getCachedTranscript } from './transcription-service';
import { ContentAnalysisReport, AnalyzeRequest } from './types';

class IntelligenceEventEmitter extends EventEmitter {}
export const intelligenceEvents = new IntelligenceEventEmitter();
intelligenceEvents.setMaxListeners(50);

/**
 * Executes or retrieves content analysis report for a video project
 */
export async function analyzeVideoContent(
  req: AnalyzeRequest,
  onProgress?: (percent: number, stage: string) => void
): Promise<ContentAnalysisReport> {
  const { sourceId, minDuration = 22, maxDuration = 70, targetCount = 5, forceReanalyze = false } = req;

  // 1. Resolve source video from memory or database
  let source = videoStore.getSource(sourceId);
  if (!source || !fs.existsSync(source.localPath)) {
    const dbProject = getProjectById(sourceId);
    if (dbProject && fs.existsSync(dbProject.localPath)) {
      source = dbProject;
      videoStore.setSource(source);
    }
  }

  if (!source || !fs.existsSync(source.localPath)) {
    throw new Error(`Source video not found on disk for analysis: ${sourceId}`);
  }

  // 2. Check cached report
  if (!forceReanalyze) {
    const cached = getContentAnalysisReport(sourceId);
    if (cached) {
      onProgress?.(100, 'Loaded cached content intelligence report.');
      return cached;
    }
  }

  const startTime = Date.now();

  // 3. Acoustic Signal Intelligence Pass
  const rawSignal = await analyzeAudioSignal(
    source.localPath,
    source.metadata.duration,
    (pct, stage) => {
      onProgress?.(pct, stage);
      intelligenceEvents.emit(`progress:${sourceId}`, { percent: pct, stage });
    }
  );

  onProgress?.(95, 'Running Attention Scoring & Boundary Snapping Engine...');

  // 4. Attention & Moment Scoring
  const candidates = scoreCandidateMoments(
    rawSignal.silenceIntervals,
    rawSignal.loudnessSamples,
    source.metadata.duration,
    {
      sourceId: source.id,
      minDuration,
      maxDuration,
      targetCount,
      // Use a transcript only if one already exists; analysis never blocks on ASR.
      transcript: getCachedTranscript(source.id)?.segments,
    }
  );

  const executionTimeMs = Date.now() - startTime;

  // 5. Construct Report
  const report: ContentAnalysisReport = {
    id: `report_${source.id}_${Date.now()}`,
    sourceId: source.id,
    videoDuration: source.metadata.duration,
    metrics: rawSignal.metrics,
    silenceIntervals: rawSignal.silenceIntervals,
    loudnessSamples: rawSignal.loudnessSamples,
    candidates,
    analyzedAt: Date.now(),
    executionTimeMs,
  };

  // 6. Persist report in database
  upsertContentAnalysisReport(report);

  onProgress?.(100, `Identified ${candidates.length} engaging candidate moments in ${(executionTimeMs / 1000).toFixed(1)}s.`);
  intelligenceEvents.emit(`complete:${sourceId}`, report);

  return report;
}
