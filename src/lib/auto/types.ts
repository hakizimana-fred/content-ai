/** AUTO STUDIO data model. Plain JSON so a project can be saved in SQLite and sent to the browser unchanged. */
export type AssetKind = 'photo' | 'video' | 'audio';
export type Format = '9:16' | '16:9' | '1:1';
export type StyleChoice = 'auto' | 'commercial' | 'cinematic' | 'documentary' | 'social';
export type AudioMode = 'auto' | 'library' | 'generate' | 'original' | 'none';

export interface Face { x: number; y: number; w: number; h: number }
export interface Subject { cx: number; cy: number; w: number; h: number; confidence: number; source: 'face' | 'saliency' }

export interface PhotoAnalysis {
  sharpness: number; brightness: number; contrast: number; color: [number, number, number]; hash: string;
  faces: Face[]; subject: Subject; thirds: number;
  /** 0..1 heuristic: sharpness (log scale) x exposure x composition. Not an aesthetic judgement. */
  quality: number; orientation: 'landscape' | 'portrait' | 'square';
}
export interface SceneInfo {
  start: number; end: number; score: number; sharpness: number; brightness: number; motion: number;
  faceFraction: number; faceCenterX: number | null; speaking: boolean; speechFraction: number;
}
export interface VideoAnalysis {
  scenes: SceneInfo[]; silences: { start: number; end: number }[]; speechFraction: number; faceFraction: number;
  quality: number; level: 'full' | 'basic'; notes: string[];
}
export interface AudioAnalysis { bpm: number | null; beatOffset: number; confidence: number }

export interface AutoAsset {
  id: string; kind: AssetKind; name: string; file: string; thumb: string | null; bytes: number;
  width: number; height: number; duration: number; hasAudio: boolean; order: number;
  photo?: PhotoAnalysis; video?: VideoAnalysis; audio?: AudioAnalysis;
}

export interface AutoConfig {
  prompt: string; format: Format; durationSec: number; style: StyleChoice; audioMode: AudioMode;
  soundtrackId?: string; headline?: string; cta?: string; identityId?: string;
  /** keep the user's tray order instead of letting the director arrange shots */
  keepOrder: boolean; captions: boolean;
  /** use the local language model to interpret the instruction (slower on CPU); rules always run first */
  useModel?: boolean;
  /** refinement knobs, all optional so older projects still load */
  variation?: number; musicVariation?: number; musicGain?: number; transitionFeel?: 'auto' | 'smooth' | 'punchy'; textScale?: number; openingBoost?: boolean;
  /** units removed by the user, as `${assetId}@${srcStart.toFixed(1)}` */
  excludeUnits?: string[];
}

export type MotionType = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' | 'ken_burns' | 'subject_focus';
export interface Shot {
  id: string; assetId: string; kind: 'photo' | 'video';
  /** timeline time (s) at which this shot becomes fully visible / is fully replaced by the next */
  start: number; len: number; cutAt: number;
  srcStart: number; srcLen: number;
  motion?: MotionType; layout: 'fill' | 'layered'; focus: { cx: number; cy: number; w: number; h: number } | null;
  videoFraming?: 'crop' | 'blur'; videoCenterX?: number;
  transitionOut: { type: string; dur: number } | null;
  role: 'opening' | 'body' | 'closing'; why: string;
}
export interface Timeline {
  shots: Shot[]; total: number; fps: number; w: number; h: number;
  bpm: number | null; beatOffset: number; beatSeconds: number | null; musicMood: string | null; musicSeed: number | null;
  dropped: { assetId: string; why: string }[]; notes: string[];
  text: { headline?: string; cta?: string };
}
export interface StageState { id: string; label: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; detail?: string; progress?: number; ms?: number }
export interface RenderState {
  jobId: string | null; stages: StageState[]; running: boolean; error?: string;
  outputFile?: string; outputUrl?: string; outputSeconds?: number; startedAt?: number; finishedAt?: number;
  applied?: string[]; skipped?: string[];
}
export interface AutoProject {
  id: string; name: string; assets: AutoAsset[]; config: AutoConfig;
  plan?: unknown; timeline?: Timeline; render: RenderState; history: { at: number; text: string }[];
  createdAt: number; updatedAt: number;
}
export const FORMAT_DIMS: Record<Format, { w: number; h: number }> = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 }, '1:1': { w: 1080, h: 1080 } };
export const DEFAULT_CONFIG: AutoConfig = { prompt: '', format: '9:16', durationSec: 30, style: 'auto', audioMode: 'auto', keepOrder: false, captions: true, useModel: false };
