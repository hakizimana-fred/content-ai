import type { PlatformSpec } from './platforms';

export type CaseMode = 'upper' | 'lower' | 'sentence' | 'original';
export type AnimationMode = 'word' | 'karaoke' | 'line' | 'static';
export type EntranceMode = 'none' | 'fade' | 'pop' | 'slide';
export type PositionPreset = 'top' | 'center' | 'bottom' | 'custom';

export interface CaptionStyle {
  fontFamily: string;
  fontWeight: number;
  /** Size in px on a 1080px-wide frame (scales with the preview). */
  fontSize: number;
  caseMode: CaseMode;
  position: PositionPreset;
  /** Vertical centre of the caption block, % from top (used when position === 'custom'). */
  customY: number;
  textColor: string;
  highlightColor: string;
  bgColor: string;
  bgOpacity: number; // 0..1
  outlineColor: string;
  outlineWidth: number; // px on 1080 frame
  shadow: number; // 0..1 strength
  animation: AnimationMode;
  entrance: EntranceMode;
  wordsPerLine: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Poppins', fontWeight: 800, fontSize: 64, caseMode: 'upper',
  position: 'bottom', customY: 70, textColor: '#FFFFFF', highlightColor: '#FACC15',
  bgColor: '#000000', bgOpacity: 0, outlineColor: '#000000', outlineWidth: 6, shadow: 0.5,
  animation: 'word', entrance: 'pop', wordsPerLine: 3,
};

export interface CaptionPreset { id: string; name: string; style: CaptionStyle; builtIn: boolean }

const P = (id: string, name: string, s: Partial<CaptionStyle>): CaptionPreset => ({
  id, name, builtIn: true, style: { ...DEFAULT_CAPTION_STYLE, ...s },
});

export const BUILTIN_PRESETS: CaptionPreset[] = [
  P('classic', 'Classic', { fontFamily: 'Poppins', fontWeight: 800, textColor: '#FFFFFF', highlightColor: '#FACC15', outlineWidth: 6, animation: 'word', entrance: 'pop' }),
  P('beast', 'Beast', { fontFamily: 'Anton', fontWeight: 400, fontSize: 78, textColor: '#FFFFFF', highlightColor: '#22C55E', outlineWidth: 9, shadow: 0.8, animation: 'word', entrance: 'pop', wordsPerLine: 2 }),
  P('karaoke', 'Karaoke', { fontFamily: 'Montserrat', fontWeight: 900, textColor: '#9CA3AF', highlightColor: '#FFFFFF', outlineWidth: 5, animation: 'karaoke', entrance: 'none', wordsPerLine: 4 }),
  P('minimal', 'Minimal', { fontFamily: 'Inter', fontWeight: 600, fontSize: 52, caseMode: 'sentence', textColor: '#FFFFFF', highlightColor: '#FFFFFF', outlineWidth: 0, shadow: 0.9, animation: 'line', entrance: 'fade', wordsPerLine: 6 }),
  P('boxed', 'Boxed', { fontFamily: 'Montserrat', fontWeight: 800, fontSize: 56, textColor: '#FFFFFF', highlightColor: '#38BDF8', bgColor: '#111827', bgOpacity: 0.85, outlineWidth: 0, shadow: 0, animation: 'word', entrance: 'slide', wordsPerLine: 4 }),
  P('neon', 'Neon', { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 84, textColor: '#F0ABFC', highlightColor: '#22D3EE', outlineColor: '#4C1D95', outlineWidth: 8, shadow: 1, animation: 'word', entrance: 'pop', wordsPerLine: 3 }),
  P('podcast', 'Podcast', { fontFamily: 'Poppins', fontWeight: 700, fontSize: 54, caseMode: 'sentence', textColor: '#F8FAFC', highlightColor: '#FB923C', bgColor: '#000000', bgOpacity: 0.55, outlineWidth: 0, shadow: 0, animation: 'line', entrance: 'fade', wordsPerLine: 5, position: 'bottom' }),
  P('static', 'Static', { fontFamily: 'Montserrat', fontWeight: 700, fontSize: 50, caseMode: 'original', textColor: '#FFFFFF', highlightColor: '#FFFFFF', outlineWidth: 4, animation: 'static', entrance: 'none', wordsPerLine: 7 }),
];

export const FONT_FAMILIES = ['Poppins', 'Montserrat', 'Inter', 'Anton', 'Bebas Neue', 'Arial', 'Impact'];
export const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900];

/** CSS font stack for a family (web fonts are exposed through next/font CSS variables). */
export function cssFontFamily(family: string): string {
  const v: Record<string, string> = {
    Poppins: 'var(--font-poppins)', Montserrat: 'var(--font-montserrat)', Inter: 'var(--font-inter)',
    Anton: 'var(--font-anton)', 'Bebas Neue': 'var(--font-bebas)',
  };
  return `${v[family] ? `${v[family]}, ` : ''}"${family}", system-ui, sans-serif`;
}

export function applyCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'sentence': {
      const t = text.toLowerCase();
      return t.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, p, c: string) => p + c.toUpperCase());
    }
    default: return text;
  }
}

// ---- timed words & lines ----------------------------------------------------------------------

export interface TimedWord { text: string; start: number; end: number }
export interface CaptionLine { id: string; words: TimedWord[]; start: number; end: number }

export interface SegmentLike {
  start: number; end: number; text: string;
  words?: { word: string; start: number; end: number }[];
}

/** Flatten transcript segments to timed words; segments without word timing are spread evenly. */
export function toTimedWords(segments: SegmentLike[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const s of segments) {
    if (s.words?.length) {
      for (const w of s.words) {
        const t = w.word.trim();
        if (t) out.push({ text: t, start: w.start, end: Math.max(w.end, w.start + 0.05) });
      }
    } else {
      const parts = s.text.trim().split(/\s+/).filter(Boolean);
      const step = (s.end - s.start) / Math.max(1, parts.length);
      parts.forEach((t, i) => out.push({ text: t, start: s.start + i * step, end: s.start + (i + 1) * step }));
    }
  }
  return out;
}

/** Group words into display lines: at most N words, breaking early on sentence punctuation or long pauses. */
export function buildLines(words: TimedWord[], wordsPerLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length) lines.push({ id: `l${lines.length}`, words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && prev && w.start - prev.end > 0.9) flush();
    cur.push(w);
    if (cur.length >= wordsPerLine || /[.!?]$/.test(w.text)) flush();
  });
  flush();
  return lines;
}

/** Binary search for the line showing at time t (a line lingers briefly after its last word). */
export function lineAt(lines: CaptionLine[], t: number): CaptionLine | null {
  let lo = 0, hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = lines[mid];
    const next = lines[mid + 1];
    const hold = Math.min(l.end + 0.35, next ? next.start : Infinity);
    if (t < l.start) hi = mid - 1;
    else if (t >= hold) lo = mid + 1;
    else return l;
  }
  return null;
}

// ---- layout ----------------------------------------------------------------------------------

/** Vertical centre (% from top) of the caption block for a style on a platform. Presets stay inside the safe band. */
export function captionCenterY(style: CaptionStyle, platform: PlatformSpec): number {
  const { top, bottom } = platform.captionSafe;
  switch (style.position) {
    case 'top': return top + 8;
    case 'center': return 50;
    case 'bottom': return bottom - 8;
    default: return style.customY;
  }
}

/** Describe which platform UI zones a caption box (approximated by its centre and height) would sit under. */
export function captionOverlaps(style: CaptionStyle, platform: PlatformSpec, lineCount = 2): string[] {
  const centre = captionCenterY(style, platform);
  const heightPct = (style.fontSize * 1.25 * lineCount) / (1080 * (16 / 9)) * 100;
  const y0 = centre - heightPct / 2, y1 = centre + heightPct / 2;
  const hits: string[] = [];
  for (const z of platform.zones) {
    const overlapsY = y0 < z.y + z.h && y1 > z.y;
    // Captions span ~84% of the width, so only the full-width zones and the right rail matter horizontally.
    const overlapsX = z.x < 92 && z.x + z.w > 8;
    if (overlapsY && overlapsX) hits.push(z.label);
  }
  return hits;
}

// ---- persistence ----------------------------------------------------------------------------

const KEY = 'content-ai:caption-presets:v1';
export function loadUserPresets(): CaptionPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CaptionPreset[]) : [];
    return arr.map((p) => ({ ...p, builtIn: false, style: { ...DEFAULT_CAPTION_STYLE, ...p.style } }));
  } catch { return []; }
}
export function saveUserPresets(presets: CaptionPreset[]) {
  try { localStorage.setItem(KEY, JSON.stringify(presets.filter((p) => !p.builtIn))); } catch { /* storage unavailable */ }
}
