/**
 * Pacing: silence removal + speed change as a pure TIME MAP. Everything that is tied to clip time (captions, face-track keyframes,
 * sound cues, title/end cards) is remapped through the same map, so nothing drifts after retiming.
 * Times are CLIP-relative seconds (0 = start of the selected segment).
 */
export interface Silence { start: number; end: number }
export interface Seg { src0: number; src1: number; out0: number }
export interface TimeMap { segs: Seg[]; speed: number; outDuration: number; removedSeconds: number }

export interface PlanOptions { minSilence?: number; keepPad?: number }

/** Keep-intervals after shortening every silence longer than `minSilence` to `2 * keepPad` (natural-sounding gap). */
export function planKeep(silences: Silence[], duration: number, o: PlanOptions = {}): [number, number][] {
  const minSilence = o.minSilence ?? 0.7, pad = o.keepPad ?? 0.18;
  const cuts: [number, number][] = [];
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, s.start), end = Math.min(duration, s.end);
    if (end - start < minSilence) continue;
    const a = start <= 0.01 ? 0 : start + pad, b = end >= duration - 0.01 ? duration : end - pad; // leading/trailing silence is removed outright
    if (b - a > 0.05 && (!cuts.length || a >= cuts[cuts.length - 1][1])) cuts.push([a, b]);
  }
  const keep: [number, number][] = []; let cur = 0;
  for (const [a, b] of cuts) { if (a > cur + 0.02) keep.push([cur, a]); cur = b; }
  if (duration > cur + 0.02) keep.push([cur, duration]);
  return keep.length ? keep : [[0, duration]];
}

export function buildTimeMap(keep: [number, number][], speed = 1, duration?: number): TimeMap {
  if (!(speed >= 0.5 && speed <= 2)) throw new Error('speed must be between 0.5 and 2');
  const segs: Seg[] = []; let acc = 0, removed = 0, prevEnd = 0;
  for (const [a, b] of keep) { removed += Math.max(0, a - prevEnd); segs.push({ src0: a, src1: b, out0: acc / speed }); acc += b - a; prevEnd = b; }
  if (duration !== undefined) removed = Math.max(0, duration - acc); // includes trailing silence
  return { segs, speed, outDuration: acc / speed, removedSeconds: removed };
}

/** Is retiming needed at all? (Avoids a pointless re-encode.) */
export const isIdentityMap = (m: TimeMap, duration: number) => m.speed === 1 && m.segs.length === 1 && m.segs[0].src0 <= 0.01 && m.segs[0].src1 >= duration - 0.01;

/** Source clip time -> output time. Times inside a removed gap map to the cut point. */
export function mapTime(m: TimeMap, t: number): number {
  for (let i = 0; i < m.segs.length; i++) {
    const s = m.segs[i];
    if (t < s.src0) return s.out0;                      // in the gap before this segment
    if (t <= s.src1) return s.out0 + (t - s.src0) / m.speed;
  }
  return m.outDuration;
}

export interface TimedLike { text: string; start: number; end: number }
/** Remap words; a word that falls entirely inside removed time is dropped. Returns output-timeline words (clip start = 0). */
export function remapWords<T extends TimedLike>(words: T[], m: TimeMap, clipStart: number): T[] {
  const out: T[] = [];
  for (const w of words) {
    const a = w.start - clipStart, b = w.end - clipStart;
    const ns = mapTime(m, a), ne = mapTime(m, b);
    if (ne - ns < 0.02) continue;
    out.push({ ...w, start: ns, end: ne });
  }
  return out;
}

/** Remap source-absolute face-track keyframes to the output timeline (clip start = 0), dropping duplicates created by cuts. */
export function remapTrack(track: { t: number; x: number }[], m: TimeMap, clipStart: number): { t: number; x: number }[] {
  const out: { t: number; x: number }[] = [];
  for (const k of track) {
    const t = +mapTime(m, k.t - clipStart).toFixed(3);
    if (!out.length || t > out[out.length - 1].t + 0.01) out.push({ t, x: k.x });
  }
  return out;
}

/** Parse ffmpeg silencedetect output. */
export function parseSilences(stderr: string, duration: number): Silence[] {
  const out: Silence[] = []; let open: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const v = Math.max(0, Number(m[2]));
    if (m[1] === 'start') open = v; else { out.push({ start: open ?? 0, end: v }); open = null; }
  }
  if (open !== null) out.push({ start: open, end: duration }); // silence runs to the end of the clip
  return out;
}
