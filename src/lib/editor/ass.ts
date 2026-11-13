import { CaptionLine, CaptionStyle, TimedWord, applyCase, buildLines, captionCenterY } from './captions';
import { PLATFORMS, PlatformId } from './platforms';

/** ASS colour: &HAABBGGRR (alpha 00 = opaque). */
const assColor = (hex: string, alpha = 0) => {
  const h = hex.replace('#', '').padStart(6, '0');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
};
const ts = (sec: number) => {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const esc = (t: string) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

export interface AssOptions {
  words: TimedWord[];   // source-time words
  clipStart: number;
  clipEnd: number;
  style: CaptionStyle;
  platform: PlatformId;
  playResX: number;
  playResY: number;
}

/**
 * Builds an ASS subtitle file that mirrors the live preview: same font/colours/case/position/animation.
 * Font sizes are authored for a 1080px-wide frame and scaled to the output width.
 */
export function buildAss(o: AssOptions): string {
  const { style, playResX, playResY } = o;
  const scale = playResX / 1080;
  const spec = PLATFORMS[o.platform];
  const cy = (captionCenterY(style, spec) / 100) * playResY;
  const cx = playResX / 2;
  const boxed = style.bgOpacity > 0;
  const primary = style.animation === 'karaoke' ? style.highlightColor : style.textColor;
  const secondary = style.animation === 'karaoke' ? style.textColor : style.textColor;
  const outlinePx = boxed ? 14 * scale : style.outlineWidth * scale;
  const outlineCol = boxed ? assColor(style.bgColor, Math.round((1 - style.bgOpacity) * 255)) : assColor(style.outlineColor);
  const shadow = boxed ? 0 : Math.round(style.shadow * 4 * scale * 10) / 10;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${style.fontFamily},${Math.round(style.fontSize * scale)},${assColor(primary)},${assColor(secondary)},${outlineCol},${assColor('#000000', 90)},${style.fontWeight >= 700 ? -1 : 0},0,0,0,100,100,0,0,${boxed ? 3 : 1},${outlinePx.toFixed(1)},${shadow},5,${Math.round(playResX * 0.06)},${Math.round(playResX * 0.06)},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Words inside the clip, re-based to clip time 0.
  const inClip = o.words
    .filter((w) => w.end > o.clipStart && w.start < o.clipEnd)
    .map((w) => ({ ...w, start: Math.max(0, w.start - o.clipStart), end: Math.min(o.clipEnd - o.clipStart, w.end - o.clipStart) }));

  const dur = o.clipEnd - o.clipStart;
  const lines: CaptionLine[] = style.animation === 'static'
    ? buildLines(inClip, Math.max(style.wordsPerLine, 7))
    : buildLines(inClip, style.wordsPerLine);

  const entrance = (() => {
    switch (style.entrance) {
      case 'fade': return '\\fad(150,0)';
      case 'pop': return '\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)';
      case 'slide': return `\\move(${cx},${cy + 28 * scale},${cx},${cy},0,150)`;
      default: return '';
    }
  })();
  const pos = style.entrance === 'slide' ? '' : `\\pos(${cx},${cy})`;
  const base = `{\\an5${pos}${entrance}}`;
  const W = (w: TimedWord) => esc(applyCase(w.text, style.caseMode));

  const events: string[] = [];
  const push = (start: number, end: number, text: string) => {
    if (end - start < 0.02) return;
    events.push(`Dialogue: 0,${ts(start)},${ts(Math.min(end, dur))},Cap,,0,0,0,,${text}`);
  };

  lines.forEach((line, li) => {
    const next = lines[li + 1];
    const lineEnd = Math.min(line.end + 0.35, next ? next.start : Infinity, dur);
    if (style.animation === 'word') {
      line.words.forEach((w, i) => {
        const s = i === 0 ? line.start : w.start;
        const e = i === line.words.length - 1 ? lineEnd : line.words[i + 1].start;
        const body = line.words.map((x, j) => (j === i ? `{\\c${assColor(style.highlightColor)}}${W(x)}{\\c${assColor(style.textColor)}}` : W(x))).join(' ');
        push(s, e, `${i === 0 ? base : `{\\an5${pos}}`}${body}`);
      });
    } else if (style.animation === 'karaoke') {
      const body = line.words.map((w) => `{\\kf${Math.max(1, Math.round((w.end - w.start) * 100))}}${W(w)}`).join(' ');
      push(line.start, lineEnd, `${base}${body}`);
    } else {
      push(line.start, lineEnd, `${base}${line.words.map(W).join(' ')}`);
    }
  });

  return header + events.join('\n') + '\n';
}
