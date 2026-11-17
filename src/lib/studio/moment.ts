/** Pick the moment that best fits a target duration. Pure and deterministic. */
export interface MomentLike { id: string; startTime: number; endTime: number; duration: number; score: number; title?: string }

export function chooseMoment<T extends MomentLike>(candidates: T[], targetSeconds: number): { moment: T; start: number; end: number; trimmed: boolean } | null {
  if (!candidates.length) return null;
  // Score 0-100; every second away from the target costs 0.5 points, so a great 60s moment still beats a mediocre 45s one.
  const fit = (m: T) => m.score - 0.5 * Math.abs(m.duration - targetSeconds);
  const best = [...candidates].sort((a, b) => fit(b) - fit(a))[0];
  const tooLong = best.duration > targetSeconds + 8;
  return { moment: best, start: best.startTime, end: tooLong ? best.startTime + targetSeconds : best.endTime, trimmed: tooLong };
}
