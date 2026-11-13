import type {
  SilenceInterval,
  LoudnessSample,
  CandidateMoment,
  AttentionFactors,
  TranscriptSegmentLike,
} from './types.ts';
import { scoreWindowText, snapToSpeechBoundaries } from './text-features.ts';

/** Max share of the final score text may carry; scaled down by transcript reliability. */
const MAX_TEXT_WEIGHT = 0.4;

interface ScorerOptions {
  sourceId: string;
  minDuration?: number; // default: 22s
  maxDuration?: number; // default: 70s
  targetCount?: number; // default: 5
  /** Optional ASR segments. Absent or unreliable => pure acoustic scoring. */
  transcript?: TranscriptSegmentLike[];
}

/**
 * Evaluates candidate windows using explainable mathematical attention and acoustic signal analysis.
 */
export function scoreCandidateMoments(
  silenceIntervals: SilenceInterval[],
  loudnessSamples: LoudnessSample[],
  videoDuration: number,
  options: ScorerOptions
): CandidateMoment[] {
  const {
    sourceId,
    minDuration = 22,
    maxDuration = 70,
    targetCount = 5,
    transcript,
  } = options;

  if (videoDuration <= 0 || loudnessSamples.length === 0) {
    return [];
  }

  // If the total video is shorter than maxDuration, the whole video is candidate #1
  if (videoDuration <= maxDuration) {
    const singleCandidate = evaluateWindow(
      0,
      videoDuration,
      silenceIntervals,
      loudnessSamples,
      sourceId,
      1,
      transcript
    );
    return singleCandidate ? [singleCandidate] : [];
  }


  // 1. Identify natural candidate start points from silence boundaries
  // High potential moments begin right after a pause (t_start = silence.end)
  const candidateStarts: number[] = [0];
  for (const s of silenceIntervals) {
    if (s.duration >= 0.25 && s.end < videoDuration - minDuration) {
      candidateStarts.push(s.end);
    }
  }

  // 2. Identify acoustic energy peaks (moments of high loudness, laughter, or vocal emphasis)
  const validSamples = loudnessSamples.filter((s) => s.momentaryLufs > -60);
  const avgLufs =
    validSamples.length > 0
      ? validSamples.reduce((acc, s) => acc + s.momentaryLufs, 0) / validSamples.length
      : -24;

  const energyPeaks = loudnessSamples
    .filter((s) => s.momentaryLufs >= avgLufs + 3.0 && s.timestamp > 5 && s.timestamp < videoDuration - 5)
    .sort((a, b) => b.momentaryLufs - a.momentaryLufs);

  // Combine starts derived from silence boundaries and energy peaks
  const potentialAnchorPoints = new Set<number>();
  candidateStarts.forEach((pt) => potentialAnchorPoints.add(Math.round(pt * 2) / 2));

  // Add preceding silence before top energy peaks for context
  for (const peak of energyPeaks.slice(0, 20)) {
    // Find the nearest silence before this peak (within 10s to 35s)
    const prevSilence = silenceIntervals
      .filter((s) => s.end <= peak.timestamp && peak.timestamp - s.end <= 35)
      .sort((a, b) => b.end - a.end)[0];

    if (prevSilence) {
      potentialAnchorPoints.add(Math.round(prevSilence.end * 2) / 2);
    } else {
      potentialAnchorPoints.add(Math.max(0, Math.round((peak.timestamp - 15) * 2) / 2));
    }
  }

  // 3. For each anchor point, find optimal boundary snapping to a resolving silence
  let idCounter = 1;
  const evaluatedWindows: CandidateMoment[] = [];

  for (const start of Array.from(potentialAnchorPoints)) {
    if (start >= videoDuration - minDuration) continue;

    // Look for natural ending pauses between minDuration and maxDuration
    const possibleEnds = silenceIntervals
      .filter((s) => s.start > start + minDuration && s.start <= start + maxDuration)
      .map((s) => s.start);

    // If no exact silence pause is found in range, test the target sweet spot (around 40s - 50s)
    if (possibleEnds.length === 0) {
      const defaultTarget = Math.min(videoDuration, start + Math.min(45, maxDuration));
      possibleEnds.push(defaultTarget);
    }

    for (const rawEnd of possibleEnds) {
      if (rawEnd - start < minDuration || rawEnd - start > maxDuration) continue;

      // Never cut mid-sentence; pull in setup context when the opener depends on it.
      const snapped = transcript?.length
        ? snapToSpeechBoundaries(transcript, start, rawEnd, { minDuration, maxDuration, videoDuration })
        : { start, end: rawEnd, contextAdded: 0 };

      const evaluated = evaluateWindow(
        snapped.start,
        snapped.end,
        silenceIntervals,
        loudnessSamples,
        sourceId,
        idCounter++,
        transcript,
        snapped.contextAdded
      );

      if (evaluated && evaluated.score >= 45) {
        evaluatedWindows.push(evaluated);
      }
    }
  }

  // Sort candidate windows by score descending
  evaluatedWindows.sort((a, b) => b.score - a.score);

  // 4. Non-Maximum Suppression (NMS) to eliminate heavy temporal overlaps (> 40%)
  const selected: CandidateMoment[] = [];

  for (const candidate of evaluatedWindows) {
    if (selected.length >= targetCount) break;

    const hasSignificantOverlap = selected.some((existing) => {
      const overlapStart = Math.max(candidate.startTime, existing.startTime);
      const overlapEnd = Math.min(candidate.endTime, existing.endTime);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const minLen = Math.min(candidate.duration, existing.duration);
      return overlap / minLen > 0.4; // 40% overlap threshold
    });

    if (!hasSignificantOverlap) {
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Mathematical scoring function for an individual candidate time window
 */
function evaluateWindow(
  start: number,
  end: number,
  silenceIntervals: SilenceInterval[],
  loudnessSamples: LoudnessSample[],
  sourceId: string,
  index: number,
  transcript?: TranscriptSegmentLike[],
  contextAdded = 0
): CandidateMoment | null {
  const duration = end - start;
  if (duration <= 0) return null;

  // Window loudness samples
  const windowSamples = loudnessSamples.filter(
    (s) => s.timestamp >= start && s.timestamp <= end && s.momentaryLufs > -70
  );

  if (windowSamples.length === 0) return null;

  const lufsValues = windowSamples.map((s) => s.momentaryLufs);
  const avgLufs = lufsValues.reduce((a, b) => a + b, 0) / lufsValues.length;
  const maxLufs = Math.max(...lufsValues);
  const minLufs = Math.min(...lufsValues);

  // Standard deviation of loudness (emotional dynamism / contrast)
  const variance = lufsValues.reduce((acc, val) => acc + Math.pow(val - avgLufs, 2), 0) / lufsValues.length;
  const stdDev = Math.sqrt(variance);

  // Peak timestamp in window
  const peakSample = windowSamples.find((s) => s.momentaryLufs === maxLufs) || windowSamples[0];
  const peakTimestamp = peakSample.timestamp;

  // 1. OPENING STRENGTH (First 3.5 seconds)
  const openingSamples = windowSamples.filter((s) => s.timestamp <= start + 3.5);
  let openingStrength = 50;
  if (openingSamples.length > 0) {
    const openingAvg = openingSamples.reduce((a, b) => a + b.momentaryLufs, 0) / openingSamples.length;
    // Higher opening vocal energy compared to baseline (-24 LUFS) yields high hook rating
    const delta = openingAvg - (-24);
    openingStrength = Math.min(100, Math.max(25, 60 + delta * 3.5));
  }

  // 2. ENERGY CONTRAST (Dynamic variation, shifts between calm discussion and peak emphasis)
  // stdDev typically ranges between 1.0 (flat monotone) to 7.0+ (dynamic dialogue / laughter)
  const energyContrast = Math.min(100, Math.max(30, Math.round(stdDev * 12.5 + 20)));

  // 3. SPEECH DENSITY & TURNS
  const windowSilences = silenceIntervals.filter((s) => s.end >= start && s.start <= end);
  let windowSilenceSecs = 0;
  for (const s of windowSilences) {
    const sStart = Math.max(start, s.start);
    const sEnd = Math.min(end, s.end);
    if (sEnd > sStart) {
      windowSilenceSecs += sEnd - sStart;
    }
  }

  const speechDensityRatio = Math.max(0, (duration - windowSilenceSecs) / duration);
  // Ideal conversational short-form density is between 70% and 88%
  let speechDensityScore = 70;
  if (speechDensityRatio >= 0.7 && speechDensityRatio <= 0.9) {
    speechDensityScore = 95;
  } else if (speechDensityRatio > 0.9) {
    speechDensityScore = 80; // slightly high, might feel breathlessly rushed
  } else {
    speechDensityScore = Math.max(20, Math.round(speechDensityRatio * 100));
  }

  // 4. STORY COMPLETENESS (Snaps to natural resolution pause)
  const endsNearSilence = silenceIntervals.some(
    (s) => Math.abs(s.start - end) <= 0.6 || (end >= s.start && end <= s.end)
  );
  const storyCompleteness = endsNearSilence ? 92 : 62;

  // 5. RETENTION CURVE (Peak location: ideal short-form climax is between 40% and 80% into the clip)
  const peakFraction = (peakTimestamp - start) / duration;
  let retentionPotential = 65;
  if (peakFraction >= 0.35 && peakFraction <= 0.85) {
    retentionPotential = 92;
  } else if (peakFraction < 0.2) {
    retentionPotential = 60; // climax happened too early, risk of user drop-off
  } else {
    retentionPotential = 72;
  }

  // ACOUSTIC COMPOSITE (0 - 100)
  const acousticScore = Math.round(
    openingStrength * 0.25 +
    energyContrast * 0.25 +
    speechDensityScore * 0.20 +
    storyCompleteness * 0.15 +
    retentionPotential * 0.15
  );

  // TEXT FUSION: loud != interesting. Meaning counts, but only as much as the ASR can be trusted.
  const text = transcript?.length ? scoreWindowText(transcript, start, end) : null;
  const textWeight = text ? MAX_TEXT_WEIGHT * text.reliability : 0;
  const compositeScore = Math.round(acousticScore * (1 - textWeight) + (text?.score ?? 0) * textWeight);

  const factors: AttentionFactors = {
    openingStrength: Math.round(openingStrength),
    energyContrast: Math.round(energyContrast),
    speechDensity: Math.round(speechDensityScore),
    retentionPotential: Math.round(retentionPotential),
    storyCompleteness: Math.round(storyCompleteness),
  };

  // Generate explainable descriptive tags
  const tags: string[] = [];
  if (openingStrength >= 80) tags.push('High Hook Impact');
  if (energyContrast >= 75) tags.push('Dynamic Dialogue');
  if (retentionPotential >= 85) tags.push('Punchy Climax');
  if (speechDensityScore >= 85) tags.push('Rapid Exchange');
  if (tags.length === 0) tags.push('Balanced Discussion');

  // Explainable description
  if (text && text.reliability >= 0.35) {
    if (text.hookStrength >= 70) tags.push('Strong Opening Line');
    if (text.curiosity >= 70) tags.push('Question & Answer');
    if (text.humour >= 70) tags.push('Humorous');
  }
  let explanation = `${tags.join(', ')}: Peak audio contrast of ${(maxLufs - minLufs).toFixed(1)} LUFS at ${formatSec(
    peakTimestamp - start
  )}s with natural thought resolution.`;
  if (text) {
    explanation += ` Text signal ${text.score}/100 (transcript trust ${(text.reliability * 100).toFixed(0)}%, weight ${(textWeight * 100).toFixed(0)}%)${
      text.reasons.length ? `: ${text.reasons.join('; ')}` : ''
    }.`;
  }
  if (contextAdded > 0) explanation += ` Started ${contextAdded.toFixed(1)}s earlier to include setup context.`;

  // Multilingual hook suggestions (English, Swahili, Luganda)
  const recommendedHook = generateMultilingualHook(tags, index);

  return {
    id: `moment_${index}_${Math.round(start)}_${Math.round(end)}`,
    sourceId,
    title: `Candidate Moment #${index} (${Math.round(duration)}s)`,
    startTime: Number(start.toFixed(2)),
    endTime: Number(end.toFixed(2)),
    duration: Number(duration.toFixed(2)),
    score: compositeScore,
    factors,
    tags,
    explanation,
    recommendedHook,
    peakTimestamp: Number(peakTimestamp.toFixed(2)),
    acousticScore,
    ...(text ? { text } : {}),
    ...(contextAdded > 0 ? { contextAdded } : {}),
  };
}

function formatSec(seconds: number): string {
  return seconds.toFixed(1);
}

/**
 * Deterministic multilingual hook generator covering English, Swahili, and Luganda
 */
function generateMultilingualHook(tags: string[], index: number): { english: string; swahili: string; luganda: string } {
  const isHighHook = tags.includes('High Hook Impact');
  const isDynamic = tags.includes('Dynamic Dialogue');

  if (isHighHook && isDynamic) {
    return {
      english: 'Wait until you hear how this heated exchange begins...',
      swahili: 'Tazama jinsi mazungumzo haya ya kusisimua yalivyoanza...',
      luganda: 'Laba enjogera eno bweyatandise n\'ebigambo eby\'amaanyi...',
    };
  }

  if (isHighHook) {
    return {
      english: 'This single statement changed the entire conversation.',
      swahili: 'Kauli hii moja ilibadilisha mwelekeo mzima wa mazungumzo.',
      luganda: 'Ekigambo kino kyokka kyakusizzaamu ensonga zonna.',
    };
  }

  if (isDynamic) {
    return {
      english: 'Nobody expected this reaction in the middle of the discussion.',
      swahili: 'Hakuna aliyetarajia jibu hili katikati ya mjadala.',
      luganda: 'Tewali yasuubira kuddamu kuno mu mboozi eno.',
    };
  }

  return {
    english: `Must-watch moment #${index}: What happened next?`,
    swahili: `Sehemu muhimu ya kutazama #${index}: Nini kilitokea baadaye?`,
    luganda: `Ekitundu eky\'omugaso #${index}: Kiki ekyaddiridde wano?`,
  };
}
