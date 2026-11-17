export interface VideoMetadata {
  duration: number; // in seconds
  width: number;
  height: number;
  size: number; // in bytes
  format: string; // e.g. "mov,mp4,m4a,3gp,3g2,mj2"
  fps: number;
  bitrate?: number;
}

export interface VideoSource {
  id: string;
  title: string;
  filename: string;
  localPath: string;
  streamUrl: string;
  metadata: VideoMetadata;
  sourceOrigin: 'upload' | 'youtube' | 'sample';
  youtubeVideoId?: string;
  youtubeUrl?: string;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface VideoProject extends VideoSource {
  updatedAt: number;
  clipCount?: number;
  completedClipCount?: number;
  isAvailable?: boolean;
}

export type ClipStatus = 'draft' | 'queued' | 'processing' | 'completed' | 'error';

export type AspectRatioPreset = 'original' | 'portrait_blur' | 'portrait_crop';

export interface ClipSegment {
  id: string;
  name: string;
  sourceId: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  status: ClipStatus;
  progress: number; // 0 to 100
  aspectRatio?: AspectRatioPreset;
  burnSubtitles?: boolean;
  subtitlesUrl?: string;
  /** Platform/framing/caption settings applied when this clip is exported. */
  production?: ProductionSettings;
  outputFilename?: string;
  outputUrl?: string;
  outputSize?: number; // in bytes
  outputDuration?: number; // in seconds
  /** What the Creative Studio post-pass applied/skipped for this clip (sound design, grade). */
  studioReport?: { applied: string[]; skipped: string[]; ms?: number; error?: string };
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Everything the Style/Crop/Captions workspaces configured; the export reproduces the preview from this. */
export interface ProductionSettings {
  platform: 'tiktok' | 'reels' | 'shorts' | 'youtube';
  layout: 'fill' | 'fit';
  framing: { mode: string; manualX: number; zoom: number; track?: { t: number; x: number }[] | null };
  /** Present only when captions should be burned in. Shape = CaptionStyle (src/lib/editor/captions.ts). */
  captions?: Record<string, unknown> | null;
  /** Creative Studio extras: sound design / colour grade (post-pass), title/end-card overlays, and the plan that produced them. */
  studio?: {
    audioDesign?: import('@/lib/studio/audio-spec').AudioDesignSpec;
    overlays?: import('@/lib/studio/overlay').OverlaySpec;
    plan?: import('@/lib/studio/plan').EditingPlan;
    /** Colour detected keywords (numbers, names, strong words) in the burned captions. */
    keywordHighlight?: boolean;
    /** Silence removal and/or speed change, applied before captions so timing stays in sync. */
    pacing?: { removeSilence: boolean; speed: number };
    /** Non-9:16 social canvas for landscape sources: 1080x1080 or 1080x1350. */
    canvas?: 'square' | 'four_five';
    /** Identity logo image drawn in a corner of the whole clip. Resolved to a file at render time. */
    logo?: { identityId: string; corner: 'tl' | 'tr' | 'bl' | 'br' };
  };
}

export interface CutRequest {
  sourceId: string;
  sourceFilename?: string;
  clips: Array<{
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    aspectRatio?: AspectRatioPreset;
    burnSubtitles?: boolean;
    production?: ProductionSettings;
  }>;
}

export interface JobProgressMessage {
  jobId: string;
  clipId: string;
  status: ClipStatus;
  progress: number;
  outputUrl?: string;
  outputSize?: number;
  outputDuration?: number;
  error?: string;
}

export interface ProjectListResponse {
  success: boolean;
  projects: VideoProject[];
  total: number;
}

export interface ProjectDetailResponse {
  success: boolean;
  project: VideoProject;
  clips: ClipSegment[];
}

export interface CheckDuplicateResponse {
  success: boolean;
  exists: boolean;
  project?: VideoProject;
  clips?: ClipSegment[];
}

export type IngestionStageId =
  | 'initializing'
  | 'metadata'
  | 'downloading'
  | 'processing_assets'
  | 'preparing_workspace';

export type IngestionStageStatus = 'pending' | 'active' | 'completed' | 'error';

export interface IngestionStageInfo {
  id: IngestionStageId;
  label: string;
  description: string;
  status: IngestionStageStatus;
  startedAt?: number;
  completedAt?: number;
}

export type IngestionErrorCode =
  | 'video_unavailable'
  | 'video_restricted'
  | 'stream_extraction_failed'
  | 'network_interruption'
  | 'timeout'
  | 'insufficient_storage'
  | 'unsupported_format'
  | 'generic';

export interface IngestionErrorInfo {
  code: IngestionErrorCode;
  title: string;
  message: string;
}

export interface IngestionJob {
  id: string;
  url: string;
  videoId: string;
  title?: string;
  author?: string;
  thumbnailUrl?: string;
  duration?: number;
  status: 'processing' | 'completed' | 'error';
  currentStage: IngestionStageId;
  stages: IngestionStageInfo[];
  progress: number; // 0 to 100
  speed?: string;
  eta?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  startedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  error?: IngestionErrorInfo;
  project?: VideoProject;
}

export interface IngestionJobResponse {
  success: boolean;
  job?: IngestionJob;
  error?: string;
}
