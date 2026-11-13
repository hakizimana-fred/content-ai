export type FramingMode = 'auto' | 'center' | 'left' | 'right' | 'manual';
export type LayoutMode = 'fill' | 'fit';

export interface FramingKeyframe { t: number; x: number } // x = subject centre, 0..1 of source width

export interface FramingSettings {
  mode: FramingMode;
  /** Manual horizontal position of the crop window centre, 0..1. */
  manualX: number;
  /** 1 = full-height crop, 2 = 2x punch-in. */
  zoom: number;
  layout: LayoutMode;
  /** Auto Track result for the current selection (source-time keyframes). */
  track: FramingKeyframe[] | null;
}

export const DEFAULT_FRAMING: FramingSettings = { mode: 'center', manualX: 0.5, zoom: 1, layout: 'fill', track: null };

/**
 * Where the crop window centre sits (0..1 of the source width) at time t.
 * The window is clamped so it never leaves the frame; `windowFrac` is its width as a fraction of the source.
 */
export function framingCenter(f: FramingSettings, t: number, windowFrac: number): number {
  let c = 0.5;
  switch (f.mode) {
    case 'left': c = windowFrac / 2; break;
    case 'right': c = 1 - windowFrac / 2; break;
    case 'manual': c = f.manualX; break;
    case 'auto': c = f.track?.length ? interpolate(f.track, t) : 0.5; break;
  }
  return Math.min(1 - windowFrac / 2, Math.max(windowFrac / 2, c));
}

export function interpolate(track: FramingKeyframe[], t: number): number {
  if (t <= track[0].t) return track[0].x;
  const last = track[track.length - 1];
  if (t >= last.t) return last.x;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t <= t) lo = m; else hi = m; }
  const a = track[lo], b = track[hi];
  return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t || 1);
}

/** Width of the 9:16 crop window as a fraction of a landscape source (or 1 if the source is already portrait). */
export function windowFraction(srcW: number, srcH: number, zoom: number, targetAspect = 9 / 16): number {
  return Math.min(1, (srcH * targetAspect) / srcW / Math.max(1, zoom));
}
