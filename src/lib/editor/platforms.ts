/**
 * Target platforms: preview geometry + approximate UI safe areas.
 * Safe-area numbers are percentages of the 9:16 frame and are APPROXIMATIONS of each app's
 * current overlay layout (platforms change their UI often). They are guidance, not a spec.
 */
export type PlatformId = 'tiktok' | 'reels' | 'shorts' | 'youtube';

export interface UnsafeZone {
  id: string;
  label: string;
  /** percent of frame: left, top, width, height */
  x: number; y: number; w: number; h: number;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  short: string;
  orientation: 'vertical' | 'landscape';
  aspect: number; // width / height
  ratioLabel: string;
  zones: UnsafeZone[];
  /** Bottom edge (percent from top) of the lowest area where captions are safe, and top edge of the safe band. */
  captionSafe: { top: number; bottom: number };
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  tiktok: {
    id: 'tiktok', label: 'TikTok', short: 'TikTok', orientation: 'vertical', aspect: 9 / 16, ratioLabel: '9:16',
    zones: [
      { id: 'top', label: 'Search / Following tabs', x: 0, y: 0, w: 100, h: 9 },
      { id: 'rail', label: 'Like · Comment · Share', x: 84, y: 44, w: 16, h: 38 },
      { id: 'bottom', label: 'Username · description · sound', x: 0, y: 78, w: 84, h: 22 },
    ],
    captionSafe: { top: 12, bottom: 76 },
  },
  reels: {
    id: 'reels', label: 'Instagram Reels', short: 'Reels', orientation: 'vertical', aspect: 9 / 16, ratioLabel: '9:16',
    zones: [
      { id: 'top', label: 'Reels header', x: 0, y: 0, w: 100, h: 10 },
      { id: 'rail', label: 'Like · Comment · Share', x: 85, y: 50, w: 15, h: 34 },
      { id: 'bottom', label: 'Profile · caption · audio', x: 0, y: 80, w: 85, h: 20 },
    ],
    captionSafe: { top: 13, bottom: 78 },
  },
  shorts: {
    id: 'shorts', label: 'YouTube Shorts', short: 'Shorts', orientation: 'vertical', aspect: 9 / 16, ratioLabel: '9:16',
    zones: [
      { id: 'top', label: 'Search / menu', x: 0, y: 0, w: 100, h: 8 },
      { id: 'rail', label: 'Like · Dislike · Comment · Share', x: 85, y: 46, w: 15, h: 40 },
      { id: 'bottom', label: 'Channel · title · Subscribe', x: 0, y: 82, w: 85, h: 18 },
    ],
    captionSafe: { top: 11, bottom: 80 },
  },
  youtube: {
    id: 'youtube', label: 'YouTube Landscape', short: 'YouTube', orientation: 'landscape', aspect: 16 / 9, ratioLabel: '16:9',
    zones: [{ id: 'controls', label: 'Player controls', x: 0, y: 88, w: 100, h: 12 }],
    captionSafe: { top: 5, bottom: 86 },
  },
};

export const PLATFORM_ORDER: PlatformId[] = ['tiktok', 'reels', 'shorts', 'youtube'];
