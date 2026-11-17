import type { EditingPlan } from './plan.ts';
import type { SfxKind, Recipe } from './sonic.ts';

export type Grade = 'none' | 'cinematic' | 'documentary' | 'clean' | 'warm';

/** Everything the render needs to design a clip's sound (and optional colour grade). Plain JSON, safe to send from the browser. */
export interface AudioDesignSpec {
  mood: EditingPlan['audio']['mood'];
  intensity: EditingPlan['audio']['intensity'];
  music: boolean;
  musicVolume: number; // 0..1, relative level of the music bed before ducking
  soundEffects: boolean;
  ducking: boolean;
  ending: EditingPlan['ending']['style'];
  seed: number;
  /** Source-independent clip-time cues (e.g. scene changes) that get a transition sound. */
  sfxCues: { t: number; kind: SfxKind }[];
  signatureSeed?: number;
  overrides?: Partial<Recipe>;
  grade: Grade;
  /** Use this existing audio file (library or uploaded track) as the music bed instead of rendering one. Looped/trimmed to fit. */
  musicFile?: string;
  /** Minimum seconds between transition cues (default 2.5; auto-edited videos with short shots use less). */
  cueGap?: number;
}

export const GRADE_FILTERS: Record<Exclude<Grade, 'none'>, string> = {
  cinematic: 'eq=contrast=1.1:saturation=0.92:gamma=0.96,colorbalance=rs=-0.04:bs=0.06:rh=0.05:bh=-0.04,vignette=PI/6',
  documentary: 'eq=contrast=1.05:saturation=0.82:gamma=1.0,vignette=PI/8',
  clean: 'eq=contrast=1.06:saturation=1.12:brightness=0.01',
  warm: 'eq=contrast=1.04:saturation=1.08,colorbalance=rs=0.05:gs=0.01:bs=-0.05',
};

export function hasAudioWork(s: AudioDesignSpec): boolean {
  return (s.music && (s.mood !== 'none' || !!s.musicFile)) || s.soundEffects || s.ending !== 'none' || s.sfxCues.length > 0 || s.grade !== 'none';
}
