/**
 * Title card / end card / brand wordmark as ASS subtitle events, so they render through the SAME libass path the
 * captions already use (no new ffmpeg filter graph). Works with or without a transcript.
 */
export interface OverlaySpec {
  title?: { text: string; seconds: number };
  endCard?: { text: string; seconds: number };
  brand?: { text: string; corner: 'tl' | 'tr' | 'bl' | 'br' };
  accent: string; text: string; fontFamily: string;
  /** multiplies title / end-card / brand sizes (default 1) */
  scale?: number;
}

const assColor = (hex: string, alpha = 0) => {
  const h = hex.replace('#', '').padStart(6, '0');
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const ts = (sec: number) => { const t = Math.max(0, sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
const esc = (t: string) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ').slice(0, 90);

export function buildOverlay(o: OverlaySpec, resX: number, resY: number, clipSeconds: number): { styles: string; events: string } {
  const k = (resX / 1080) * (o.scale ?? 1), font = o.fontFamily;
  const style = (name: string, size: number, primary: string, outline: string, ow: number, bold = -1) =>
    `Style: ${name},${font},${Math.round(size * k)},${primary},${primary},${outline},&H64000000,${bold},0,0,0,100,100,2,0,1,${(ow * k).toFixed(1)},${(1.5 * k).toFixed(1)},5,40,40,0,1`;
  const styles = [style('OvTitle', 92, assColor(o.text), assColor('#000000'), 6), style('OvEnd', 84, assColor(o.accent), assColor('#000000'), 6), style('OvBrand', 34, assColor(o.text, 60), assColor('#000000'), 2)].join('\n');
  const ev: string[] = [];
  const line = (style: string, a: number, b: number, x: number, y: number, text: string, fad = '\\fad(350,350)') =>
    ev.push(`Dialogue: 5,${ts(a)},${ts(b)},${style},,0,0,0,,{\\an5\\pos(${Math.round(x)},${Math.round(y)})${fad}}${esc(text)}`);
  if (o.title?.text) line('OvTitle', 0.15, Math.min(clipSeconds, o.title.seconds + 0.15), resX / 2, resY * 0.3, o.title.text.toUpperCase());
  if (o.endCard?.text && clipSeconds > o.endCard.seconds + 1) line('OvEnd', clipSeconds - o.endCard.seconds, clipSeconds - 0.05, resX / 2, resY * 0.45, o.endCard.text.toUpperCase());
  if (o.brand?.text) {
    const mx = resX * 0.07, top = resY * 0.13, bot = resY * 0.8;
    const pos = { tl: [mx + 0, top], tr: [resX - mx, top], bl: [mx, bot], br: [resX - mx, bot] }[o.brand.corner];
    const w = Math.min(resX * 0.4, o.brand.text.length * 20 * k); // approximate half-width for \an5 anchoring
    line('OvBrand', 0.2, clipSeconds - 0.1, o.brand.corner.endsWith('l') ? pos[0] + w / 2 : pos[0] - w / 2, pos[1], o.brand.text.toUpperCase(), '\\fad(500,300)');
  }
  return { styles, events: ev.join('\n') };
}

/** Merge overlay styles/events into an existing ASS document, or create a minimal one when there are no captions. */
export function composeAss(base: string | null, o: OverlaySpec, resX: number, resY: number, clipSeconds: number): string {
  const ov = buildOverlay(o, resX, resY, clipSeconds);
  if (!ov.events) return base ?? '';
  if (base) {
    const lines = base.split('\n'); let lastStyle = -1;
    lines.forEach((l, i) => { if (l.startsWith('Style:')) lastStyle = i; });
    if (lastStyle >= 0) lines.splice(lastStyle + 1, 0, ov.styles);
    return lines.join('\n').replace(/\s*$/, '\n') + ov.events + '\n';
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${resX}\nPlayResY: ${resY}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${ov.styles}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ov.events}\n`;
}
