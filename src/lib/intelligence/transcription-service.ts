import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  probability: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  words: WordTimestamp[];
}

export interface AfricanContext {
  swahili_count: number;
  luganda_count: number;
  detected_african_dialects: string[];
  is_code_switching: boolean;
}

export interface TranscriptResult {
  sourceId: string;
  language: string;
  language_probability: number;
  duration: number;
  transcript: string;
  segment_count: number;
  segments: TranscriptSegment[];
  srt: string;
  vtt: string;
  african_context: AfricanContext;
  createdAt: number;
}

const TRANSCRIPTS_DIR = path.join(process.cwd(), 'storage', 'transcripts');

/**
 * Ensures the transcripts cache directory exists
 */
function ensureTranscriptsDir() {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
}

/**
 * Gets cached transcript if available
 */
export function getCachedTranscript(sourceId: string): TranscriptResult | null {
  ensureTranscriptsDir();
  const filePath = path.join(TRANSCRIPTS_DIR, `${sourceId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as TranscriptResult;
  } catch {
    return null;
  }
}

/**
 * Runs faster-whisper transcription on a media file
 */
export async function transcribeMedia(
  sourceId: string,
  mediaFilePath: string,
  model: 'base' | 'tiny' = 'base',
  language?: string
): Promise<TranscriptResult> {
  const cached = getCachedTranscript(sourceId);
  if (cached) {
    return cached;
  }

  ensureTranscriptsDir();
  const outputJsonPath = path.join(TRANSCRIPTS_DIR, `${sourceId}.json`);
  const scriptPath = path.join(process.cwd(), 'src', 'lib', 'intelligence', 'transcribe.py');
  const pythonBin = path.join(process.cwd(), '.venv', 'bin', 'python3');

  const binToUse = fs.existsSync(pythonBin) ? pythonBin : 'python3';

  return new Promise((resolve, reject) => {
    const args = [
      scriptPath,
      '--input', mediaFilePath,
      '--output', outputJsonPath,
      '--model', model,
    ];

    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    const proc = spawn(binToUse, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn transcription worker: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Transcription worker failed with code ${code}: ${stderr.slice(-400)}`));
      }

      try {
        const raw = fs.readFileSync(outputJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        const result: TranscriptResult = {
          sourceId,
          ...parsed,
          createdAt: Date.now(),
        };
        // Re-save with sourceId and timestamp
        fs.writeFileSync(outputJsonPath, JSON.stringify(result, null, 2), 'utf8');
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse transcript output: ${(e as Error).message}`));
      }
    });
  });
}

/**
 * Generates a sliced WebVTT for a specific clip timeframe [startTime, endTime]
 * Re-bases timestamps so they start at 00:00:00.000 for independent clip preview
 */
export function generateClipWebVTT(
  transcript: TranscriptResult,
  startTime: number,
  endTime: number
): string {
  const clipSegments = transcript.segments.filter(
    (s) => s.end > startTime && s.start < endTime
  );

  let vtt = "WEBVTT\n\n";
  let index = 1;

  for (const s of clipSegments) {
    const relativeStart = Math.max(0, s.start - startTime);
    const relativeEnd = Math.min(endTime - startTime, s.end - startTime);

    if (relativeEnd <= relativeStart) continue;

    const startStr = formatVttTime(relativeStart);
    const endStr = formatVttTime(relativeEnd);

    vtt += `${index}\n${startStr} --> ${endStr}\n${s.text.trim()}\n\n`;
    index++;
  }

  return vtt;
}

/**
 * Generates a sliced SRT for a specific clip timeframe
 */
export function generateClipSRT(
  transcript: TranscriptResult,
  startTime: number,
  endTime: number
): string {
  const clipSegments = transcript.segments.filter(
    (s) => s.end > startTime && s.start < endTime
  );

  let srt = "";
  let index = 1;

  for (const s of clipSegments) {
    const relativeStart = Math.max(0, s.start - startTime);
    const relativeEnd = Math.min(endTime - startTime, s.end - startTime);

    if (relativeEnd <= relativeStart) continue;

    const startStr = formatSrtTime(relativeStart);
    const endStr = formatSrtTime(relativeEnd);

    srt += `${index}\n${startStr} --> ${endStr}\n${s.text.trim()}\n\n`;
    index++;
  }

  return srt;
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
