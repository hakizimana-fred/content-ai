/** AUTO STUDIO data model. Plain JSON so a project can be saved in SQLite and sent to the browser unchanged. */
export type AssetKind = 'photo' | 'video' | 'audio';
export type Format = '9:16' | '16:9' | '1:1';
export type StyleChoice = 'auto' | 'commercial' | 'cinematic' | 'documentary' | 'social';
/** How the video is made: from uploaded videos, from photos, from an idea alone, or from uploads plus generated scenes. */
export type Mode = 'video' | 'image' | 'idea' | 'mixed';
export type SceneKind = 'intro' | 'text' | 'quote' | 'product' | 'infographic' | 'outro' | 'image' | 'footage' | 'abstract' | 'diagram' | 'showcase' | 'product3d' | 'title3d' | 'journey3d' | 'scenery25' | 'photo25d' | 'logo3d';
export type BgType = 'gradient' | 'aurora' | 'grid' | 'particles' | 'waves' | 'solid' | 'asset' | 'mesh' | 'bokeh' | 'contours' | 'beams' | 'geo' | 'sky';
export type Motif = 'rings' | 'diagonals' | 'dots' | 'blocks' | 'orbits' | 'none';
export type Composition = 'default' | 'slam' | 'stack' | 'left' | 'split' | 'wave' | 'bar' | 'cards' | 'bignum' | 'donuts';
/** How a scene gets its depth. Kept separate on purpose: real3d = meshes + camera + lighting (render3d.py); depth25d = flat layers moved at different rates / perspective-warped images; flat2d = everything else. */
export type Technique = 'flat2d' | 'depth25d' | 'real3d';
export type Shape3D = 'bottle' | 'dumbbell' | 'coin' | 'gem' | 'sphere' | 'torus' | 'knot' | 'cube' | 'phone' | 'text' | 'logo' | 'glb';
export interface Object3D { shape: Shape3D; color?: string; size?: number; metal?: number; gloss?: number; spin?: { axis?: 'x' | 'y' | 'z'; dps?: number; start?: number }; tilt?: number; pos?: [number, number, number]; text?: string; depth?: number; file?: string; delay?: number; pop?: boolean; phase?: number }
export interface ThreeSpec {
  objects: Object3D[]; environment?: 'terrain'; floor?: number | null; reflection?: boolean; shadow?: boolean; particles?: number; particleSize?: number; seed?: number;
  camera?: { orbit?: [number, number] | number; dolly?: [number, number] | number; height?: number; fov?: number; speed?: number; target?: [number, number, number] };
  light?: { key?: [number, number, number]; color?: string; intensity?: number };
}
export interface SceneFx { grain: number; leak: number; blur: number; vignette: number; bars: boolean }
export type TypeFont = 'modern' | 'elegant' | 'tech' | 'bold';
export interface SceneStat { label: string; value: number; suffix?: string; max?: number }
/** One independently configured generated scene. Text only ever comes from the user's words. */
export interface SceneSpec {
  id: string; kind: SceneKind; weight: number; bg: BgType; creativeAssetId?: string;
  title?: string; subtitle?: string; lines?: string[]; quote?: string; attribution?: string; cta?: string; bullets?: string[]; stats?: SceneStat[]; steps?: string[];
  /** Brand logo placement for this scene (decided by the Brand Director; the logo image itself is never altered). file/ver are bound at render time. */
  logo?: { role: 'opening' | 'closing'; reveal: 'fade' | 'rise' | 'sweep'; scale: number; hero?: boolean; extrude?: boolean; file?: string; ver?: number };
  three?: ThreeSpec; scenery?: 'mountains' | 'city';
  composition?: Composition; motion?: 'push' | 'zoom_out' | 'pan_left' | 'pan_right';
  /** where each text field came from; absent = the user's own words */
  prov?: Partial<Record<'title' | 'subtitle' | 'cta' | 'quote' | 'attribution' | 'bullets' | 'steps', TextSource>>;
}
export type TextSource = 'user' | 'suggested';
export interface SceneLook { colors: string[]; accent: string; text: string; font: TypeFont; upper: boolean; anim: 'words' | 'letters' | 'fade_up' | 'scale'; speed: number; dim: number; name: string; direction?: string; fx?: SceneFx; motif?: Motif; fontFile?: string; fontName?: string }
export type SceneEdit = Partial<Pick<SceneSpec, 'title' | 'subtitle' | 'cta' | 'quote' | 'attribution' | 'bullets' | 'lines' | 'bg'>>;
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
  soundtrackId?: string; /** style ingredients for a composed soundtrack (ids from blend.ts) and how many alternatives to compose */ soundtrackStyles?: string[]; soundtrackVariations?: number; headline?: string; cta?: string; identityId?: string;
  /** keep the user's tray order instead of letting the director arrange shots */
  keepOrder: boolean; captions: boolean;
  /** use the local language model to interpret the instruction (slower on CPU); rules always run first */
  useModel?: boolean;
  /** refinement knobs, all optional so older projects still load */
  variation?: number; musicVariation?: number; musicGain?: number; transitionFeel?: 'auto' | 'smooth' | 'punchy'; textScale?: number; openingBoost?: boolean;
  /** units removed by the user, as `${assetId}@${srcStart.toFixed(1)}` */
  excludeUnits?: string[];
  /** creation mode; absent on older projects (treated as video/image from what was uploaded) */
  mode?: Mode;
  /** 'preview' renders at half resolution for fast iteration; 'final' at full export resolution */
  quality?: 'preview' | 'final';
  /** per-scene text overrides, keyed by scene id (Idea-to-Video / Mixed) */
  sceneEdits?: Record<string, SceneEdit>;
  /** look overrides from refinement */
  look?: { bg?: BgType; font?: TypeFont; accent?: string; light?: boolean; anim?: SceneLook['anim'] };
  /** local creative-library assets (backgrounds / footage / overlays) to feature as scenes */
  creativeAssetIds?: string[];
  /** copy the user approved (or edited) in the creative plan, keyed by copy id; only these suggested lines may be rendered */
  copyApproval?: { planId: string; approved: string[]; edits?: Record<string, string> };
  /** uploaded font (creative library id, kind 'font'); falls back to the bundled fonts */
  fontAssetId?: string;
  fps?: 24 | 30;
  /** the user declared that this video is for commercial use: unknown-licence assets are then blocked */
  commercial?: boolean;
}

export type CopySource = 'user' | 'suggested' | 'label';
/** One piece of on-screen text with its origin. 'label' = a structural word chosen by the system (e.g. a step number), never a claim. */
export interface CopyItem { id: string; sceneId: string; field: string; text: string; source: CopySource; status: 'ok' | 'needs_review' | 'rejected'; reason?: string }
export interface CreativePlan {
  /** made automatically at render time (never shown for review): suggested copy is left out */
  auto?: boolean;
  id: string; createdAt: number; source: 'model' | 'keywords'; model?: string; ms?: number; fallbackReason?: string;
  originalPrompt: string;
  concept: string; audience: string; objective: string; direction: string; mood: string[]; ending: string;
  soundtrack: { mood?: string; notes: string }; sfx: string[];
  scenes: SceneSpec[]; look: SceneLook; copy: CopyItem[]; notes: string[]; decided: string[];
  /** brand profile this plan was made with (id + what the Brand Director decided) */
  brand?: { id: string; name: string; decisions: string[]; updatedAt: number };
}

export type MotionType = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' | 'ken_burns' | 'subject_focus';
export interface Shot {
  id: string; assetId: string; kind: 'photo' | 'video' | 'scene';
  /** generated scene (kind === 'scene'); assetId is `scene:<id>` */
  scene?: SceneSpec;
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
  mode?: Mode; look?: SceneLook;
}
export interface StageState { id: string; label: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; detail?: string; progress?: number; ms?: number }
export interface RenderState {
  jobId: string | null; stages: StageState[]; running: boolean; error?: string;
  outputFile?: string; outputUrl?: string; outputSeconds?: number; startedAt?: number; finishedAt?: number;
  applied?: string[]; skipped?: string[];
  qc?: QcReport;
}
export interface QcCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail' | 'skipped'; detail: string }
export interface QcReport { at: number; file: string; verdict: 'pass' | 'warn' | 'fail'; checks: QcCheck[]; stats: Record<string, number | string | null> }
export interface AutoProject {
  id: string; name: string; assets: AutoAsset[]; config: AutoConfig;
  plan?: unknown; creative?: CreativePlan; timeline?: Timeline; render: RenderState; history: { at: number; text: string }[];
  createdAt: number; updatedAt: number;
}
export const FORMAT_DIMS: Record<Format, { w: number; h: number }> = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 }, '1:1': { w: 1080, h: 1080 } };
/** Output size: half resolution (even numbers) for previews, full export size otherwise. */
export function dimsFor(c: { format: Format; quality?: 'preview' | 'final' }): { w: number; h: number } {
  const d = FORMAT_DIMS[c.format]; if (c.quality !== 'preview') return d;
  return { w: Math.round(d.w / 4) * 2, h: Math.round(d.h / 4) * 2 };
}
export const DEFAULT_CONFIG: AutoConfig = { prompt: '', format: '9:16', durationSec: 30, style: 'auto', audioMode: 'auto', keepOrder: false, captions: true, useModel: false };
