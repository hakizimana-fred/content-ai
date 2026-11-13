/**
 * Formats seconds into HH:MM:SS or HH:MM:SS.ms format
 */
export function formatTime(seconds: number, includeMs = false): string {
  if (isNaN(seconds) || seconds < 0) return includeMs ? '00:00:00.00' : '00:00:00';

  const totalSecs = Math.floor(seconds);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;

  if (includeMs) {
    const ms = Math.floor((seconds % 1) * 100);
    return `${timeStr}.${pad(ms)}`;
  }

  return timeStr;
}

/**
 * Parses timecode string (HH:MM:SS, MM:SS, or seconds) into number of seconds
 */
export function parseTimecode(str: string): number {
  if (!str) return 0;
  const trimmed = str.trim();

  // If purely number
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  const parts = trimmed.split(':').map((p) => parseFloat(p) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Formats bytes to human-readable size
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Formats video resolution into standard badge (e.g. 1080p, 4K)
 */
export function formatResolution(width: number, height: number): string {
  if (!width || !height) return 'Unknown';
  if (width >= 3840 || height >= 2160) return `4K (${width}x${height})`;
  if (width >= 2560 || height >= 1440) return `1440p (${width}x${height})`;
  if (width >= 1920 || height >= 1080) return `1080p FHD (${width}x${height})`;
  if (width >= 1280 || height >= 720) return `720p HD (${width}x${height})`;
  return `${width}x${height}`;
}
