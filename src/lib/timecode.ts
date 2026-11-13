/**
 * Strict timecode parsing, formatting and selection validation.
 * Pure functions (no React / DOM) so they are shared by the UI and the cut API,
 * and can be unit-tested with plain Node.
 *
 * Rule: invalid input is REPORTED, never silently corrected.
 */

export const MIN_CLIP_SECONDS = 0.5;       // below this the encoder output is unreliable -> error
export const SHORT_CLIP_WARN_SECONDS = 3;  // below this -> warning
export const LONG_CLIP_WARN_SECONDS = 600; // above this -> warning (long re-encode)
/** Half a frame at 30fps. Absorbs float noise / container-vs-stream duration drift only. */
export const DURATION_EPSILON = 0.034;

export type ParseResult = { ok: true; seconds: number } | { ok: false; error: string };

/** Format seconds as HH:MM:SS.mmm (rounded to the nearest millisecond, carries correctly). */
export function formatTimecode(seconds: number, withMs = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p2 = (n: number) => n.toString().padStart(2, '0');
  const base = `${p2(h)}:${p2(m)}:${p2(s)}`;
  return withMs ? `${base}.${ms.toString().padStart(3, '0')}` : base;
}

/** Human duration: "01:27" (MM:SS) or "1:02:03" past an hour; sub-second precision when short. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  if (seconds < 10 && seconds > 0) return `${seconds.toFixed(2)}s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p2 = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

/**
 * Accepts: "135", "135.5", "2:15", "2:15.250", "00:02:15", "00:02:15.250", "1:02:15,250".
 * Rejects: empty, negative, letters, >3 parts, minutes/seconds >= 60 in multi-part forms,
 * more than 3 fractional digits.
 */
export function parseTimecodeStrict(input: string): ParseResult {
  const raw = (input ?? '').trim().replace(',', '.');
  if (raw === '') return { ok: false, error: 'Enter a time, e.g. 00:02:15.000' };
  if (raw.startsWith('-')) return { ok: false, error: 'Time cannot be negative' };

  const parts = raw.split(':');
  if (parts.length > 3) return { ok: false, error: 'Use HH:MM:SS or HH:MM:SS.mmm' };

  const num = /^\d+(\.\d{1,3})?$/;
  const whole = /^\d+$/;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    if (!(last ? num : whole).test(parts[i])) {
      return { ok: false, error: /\.\d{4,}/.test(raw) ? 'At most 3 decimal places (milliseconds)' : 'Use HH:MM:SS or HH:MM:SS.mmm' };
    }
  }

  const nums = parts.map(Number);
  if (parts.length > 1) {
    const secs = nums[nums.length - 1];
    const mins = parts.length === 3 ? nums[1] : nums[0];
    if (secs >= 60) return { ok: false, error: 'Seconds must be below 60' };
    if (parts.length === 3 && mins >= 60) return { ok: false, error: 'Minutes must be below 60' };
  }

  let seconds: number;
  if (parts.length === 1) seconds = nums[0];
  else if (parts.length === 2) seconds = nums[0] * 60 + nums[1];
  else seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  return { ok: true, seconds: Math.round(seconds * 1000) / 1000 };
}

export interface SelectionValidation {
  ok: boolean;
  /** Per-field problems (shown under the matching input). */
  startError?: string;
  endError?: string;
  /** Problem with the pair (e.g. start >= end, too short). */
  rangeError?: string;
  /** Non-blocking advice. */
  warnings: string[];
  duration: number;
}

/** Validate a start/end pair (in seconds) against the video duration. */
export function validateSelection(start: number | null, end: number | null, videoDuration: number): SelectionValidation {
  const res: SelectionValidation = { ok: false, warnings: [], duration: 0 };
  if (start === null) res.startError = 'Set a start time';
  if (end === null) res.endError = 'Set an end time';
  if (start === null || end === null) return res;

  if (start < 0) res.startError = 'Start cannot be negative';
  if (start > videoDuration + DURATION_EPSILON) res.startError = `Start is beyond the end of the video (${formatTimecode(videoDuration)})`;
  if (end < 0) res.endError = 'End cannot be negative';
  if (end > videoDuration + DURATION_EPSILON) res.endError = `End is beyond the end of the video (${formatTimecode(videoDuration)})`;
  if (res.startError || res.endError) return res;

  if (start === end) {
    res.rangeError = 'Start and end are the same, so the clip would be empty';
    return res;
  }
  if (start > end) {
    res.rangeError = 'Start must be before end';
    return res;
  }

  res.duration = end - start;
  if (res.duration < MIN_CLIP_SECONDS) {
    res.rangeError = `Clip is too short (${res.duration.toFixed(2)}s). Minimum is ${MIN_CLIP_SECONDS}s`;
    return res;
  }
  if (res.duration < SHORT_CLIP_WARN_SECONDS) res.warnings.push('Very short clip');
  if (res.duration > LONG_CLIP_WARN_SECONDS) res.warnings.push('Long clip: it will take longer to process');
  res.ok = true;
  return res;
}
