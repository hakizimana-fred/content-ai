import { spawn } from 'child_process';
import fs from 'fs';
import type { SilenceInterval, LoudnessSample, VideoSignalMetrics } from './types.ts';

const FFMPEG_BIN = process.env.FFMPEG_PATH || (fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg');

export interface SignalAnalysisRawResult {
  metrics: VideoSignalMetrics;
  silenceIntervals: SilenceInterval[];
  loudnessSamples: LoudnessSample[];
}

/**
 * High-speed native FFmpeg acoustic signal analyzer.
 * Extracts loudness timeline and silence boundary intervals at 40x-80x realtime on CPU.
 */
export async function analyzeAudioSignal(
  filePath: string,
  totalDuration: number,
  onProgress?: (percent: number, message: string) => void
): Promise<SignalAnalysisRawResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for analysis: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    onProgress?.(5, 'Initializing acoustic signal analysis...');

    // Combine ebur128 (loudness) and silencedetect in a single non-rendering pass
    const args = [
      '-hide_banner',
      '-vn', // Audio only
      '-i', filePath,
      '-af', 'ebur128=metadata=1,silencedetect=noise=-30dB:d=0.25,ametadata=print:key=lavfi.r128.M:file=-',
      '-f', 'null',
      '-',
    ];

    const proc = spawn(FFMPEG_BIN, args);

    const silenceIntervals: SilenceInterval[] = [];
    const loudnessSamples: LoudnessSample[] = [];

    let currentSilenceStart: number | null = null;
    let integratedLoudness = -24.0;
    let loudnessRange = 5.0;
    let lastSampleTime = -1;
    let maxMomentary = -120;
    let minMomentary = 0;

    let pendingPtsTime: number | null = null;
    let stderrBuffer = '';

    // Parse stdout for ametadata (pts_time and lavfi.r128.M)
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        // Detect pts_time for momentary loudness
        const ptsMatch = line.match(/pts_time:([0-9.]+)/);
        if (ptsMatch) {
          pendingPtsTime = parseFloat(ptsMatch[1]);
        }

        // Detect lavfi.r128.M (Momentary LUFS)
        const lufsMatch = line.match(/lavfi\.r128\.M=([-0-9.]+)/);
        if (lufsMatch && pendingPtsTime !== null) {
          const lufs = parseFloat(lufsMatch[1]);
          // Sample every ~0.25 seconds to preserve high resolution while keeping array lean
          if (pendingPtsTime - lastSampleTime >= 0.25) {
            lastSampleTime = pendingPtsTime;
            loudnessSamples.push({
              timestamp: Number(pendingPtsTime.toFixed(2)),
              momentaryLufs: Number(lufs.toFixed(1)),
            });

            if (lufs > maxMomentary && lufs < 0) maxMomentary = lufs;
            if (lufs < minMomentary && lufs > -100) minMomentary = lufs;
          }
          pendingPtsTime = null;
        }
      }
    });

    // Parse stderr for silencedetect, progress time, and ebur128 summary
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;

      // Report progress from time=00:01:23.45
      const timeMatch = text.match(/time=([0-9:.]+)/);
      if (timeMatch && totalDuration > 0) {
        const parts = timeMatch[1].split(':');
        let currentSeconds = 0;
        if (parts.length === 3) {
          currentSeconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
        }
        const pct = Math.min(95, Math.max(5, Math.round((currentSeconds / totalDuration) * 90)));
        onProgress?.(pct, `Scanning audio energy (${pct}% complete)...`);
      }

      // Process lines in chunk
      const lines = text.split('\n');
      for (const line of lines) {
        // 1. Detect silence start
        const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
        if (startMatch) {
          currentSilenceStart = parseFloat(startMatch[1]);
        }

        // 2. Detect silence end
        const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
        if (endMatch) {
          const end = parseFloat(endMatch[1]);
          const duration = parseFloat(endMatch[2]);
          const start = currentSilenceStart !== null ? currentSilenceStart : Math.max(0, end - duration);
          silenceIntervals.push({ start, end, duration });
          currentSilenceStart = null;
        }

        // 3. Detect Summary values at conclusion
        const iMatch = line.match(/I:\s*([-0-9.]+)\s*LUFS/);
        if (iMatch) integratedLoudness = parseFloat(iMatch[1]);

        const lraMatch = line.match(/LRA:\s*([-0-9.]+)\s*LU/);
        if (lraMatch) loudnessRange = parseFloat(lraMatch[1]);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg signal analysis failed to spawn: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(`FFmpeg signal analysis failed with exit code ${code}: ${stderrBuffer.slice(-300)}`)
        );
      }

      onProgress?.(98, 'Synthesizing conversational metrics...');

      // Calculate aggregated metrics
      const totalSilence = silenceIntervals.reduce((acc, s) => acc + s.duration, 0);
      const safeDuration = Math.max(1, totalDuration);
      const silenceRatio = Math.min(1.0, Math.max(0.0, totalSilence / safeDuration));

      // Conversational turns: pauses between 0.25s and 0.9s often indicate dialogue turnover
      const conversationalTurns = silenceIntervals.filter((s) => s.duration >= 0.25 && s.duration <= 0.9).length;
      const turnTakingFrequency = Number(((conversationalTurns / safeDuration) * 60).toFixed(1));

      const metrics: VideoSignalMetrics = {
        integratedLoudness: Number(integratedLoudness.toFixed(1)),
        loudnessRange: Number(loudnessRange.toFixed(1)),
        maxMomentaryLufs: Number(maxMomentary.toFixed(1)),
        minMomentaryLufs: Number((minMomentary === 0 ? -70 : minMomentary).toFixed(1)),
        totalSilenceDuration: Number(totalSilence.toFixed(2)),
        silenceRatio: Number(silenceRatio.toFixed(3)),
        turnTakingFrequency,
      };

      resolve({
        metrics,
        silenceIntervals,
        loudnessSamples,
      });
    });
  });
}
