export interface SilenceInterval {
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
}

export interface LoudnessSample {
  timestamp: number; // in seconds
  momentaryLufs: number; // LUFS (typically -70 to 0)
}

export interface AttentionFactors {
  openingStrength: number;   // 0 - 100 (impact of first 3-5 seconds)
  energyContrast: number;    // 0 - 100 (dynamic variance, passion, tension)
  speechDensity: number;     // 0 - 100 (conversational pacing and turn taking)
  retentionPotential: number;// 0 - 100 (sustained interest without flatlines)
  storyCompleteness: number; // 0 - 100 (natural thought boundary ending)
}

/** Minimal transcript segment shape (compatible with faster-whisper output). */
export interface TranscriptSegmentLike {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

/** Explainable transcript-derived attention signal (see text-features.ts). */
export interface TextSignal {
  score: number;        // 0 - 100
  reliability: number;  // 0 - 1, trust in the ASR text for this window
  hookStrength: number;
  curiosity: number;
  stakes: number;
  humour: number;
  selfContained: number;
  pace: number;
  needsPrecedingContext: boolean;
  reasons: string[];
}

export interface CandidateMoment {
  id: string;
  sourceId: string;
  title: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  duration: number;  // in seconds
  score: number;     // 0 - 100 overall composite attention score
  factors: AttentionFactors;
  tags: string[];    // e.g. ["High Hook Impact", "Dynamic Dialogue", "Punchy Climax"]
  explanation: string;
  recommendedHook: {
    english: string;
    swahili: string;
    luganda: string;
  };
  peakTimestamp: number;
  /** Audio-only composite, kept so experiments can compare signal sources. */
  acousticScore?: number;
  text?: TextSignal;
  /** Seconds of preceding context pulled in so the clip makes sense standalone. */
  contextAdded?: number;
}

export interface VideoSignalMetrics {
  integratedLoudness: number; // LUFS
  loudnessRange: number;      // LU (LRA)
  maxMomentaryLufs: number;
  minMomentaryLufs: number;
  totalSilenceDuration: number;
  silenceRatio: number; // 0.0 to 1.0
  turnTakingFrequency: number; // conversational turns per minute
}

export interface ContentAnalysisReport {
  id: string;
  sourceId: string;
  videoDuration: number;
  metrics: VideoSignalMetrics;
  silenceIntervals: SilenceInterval[];
  loudnessSamples: LoudnessSample[];
  candidates: CandidateMoment[];
  analyzedAt: number;
  executionTimeMs: number;
}

export interface AnalyzeRequest {
  sourceId: string;
  minDuration?: number; // default: 20
  maxDuration?: number; // default: 75
  targetCount?: number; // default: 5
  forceReanalyze?: boolean;
}
