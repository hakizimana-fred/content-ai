import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { UPLOADS_DIR, initStorageDirs } from './paths';
import { extractYouTubeVideoId } from './youtube';
import { probeVideo } from './ffmpeg';
import { videoStore } from './store';
import {
  getProjectByYouTubeId,
  upsertProject,
  getIngestionJob,
  upsertIngestionJob,
  getLatestActiveIngestionJob,
} from './db';
import {
  IngestionJob,
  IngestionStageId,
  IngestionStageInfo,
  IngestionErrorCode,
  VideoProject,
} from '@/types/video';

const YT_DLP_BIN =
  process.env.YT_DLP_PATH ||
  (fs.existsSync('/home/fred/.local/bin/yt-dlp') ? '/home/fred/.local/bin/yt-dlp' : 'yt-dlp');

class IngestionEventEmitter extends EventEmitter {}

// Global in-memory emitter & job map (persisted to storage/database.json)
const jobEmitter = new IngestionEventEmitter();
jobEmitter.setMaxListeners(100);

const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

function createInitialStages(): IngestionStageInfo[] {
  return [
    {
      id: 'initializing',
      label: 'Initializing video ingestion',
      description: 'Validating YouTube URL and checking local project registry',
      status: 'pending',
    },
    {
      id: 'metadata',
      label: 'Retrieving video metadata',
      description: 'Fetching title, author, thumbnail, and stream manifest',
      status: 'pending',
    },
    {
      id: 'downloading',
      label: 'Fetching video streams & downloading',
      description: 'Downloading highest quality video and audio streams',
      status: 'pending',
    },
    {
      id: 'processing_assets',
      label: 'Preparing video assets',
      description: 'Muxing streams into fast-seekable MP4 and probing with FFprobe',
      status: 'pending',
    },
    {
      id: 'preparing_workspace',
      label: 'Preparing editing workspace',
      description: 'Registering project in database and setting up editor timeline',
      status: 'pending',
    },
  ];
}

function updateJobStage(
  job: IngestionJob,
  stageId: IngestionStageId,
  status: 'active' | 'completed' | 'error'
) {
  job.currentStage = stageId;
  const stage = job.stages.find((s) => s.id === stageId);
  if (stage) {
    stage.status = status;
    if (status === 'active' && !stage.startedAt) {
      stage.startedAt = Date.now();
    }
    if (status === 'completed') {
      stage.completedAt = Date.now();
    }
  }

  // Mark all previous stages as completed
  const stageIndex = job.stages.findIndex((s) => s.id === stageId);
  for (let i = 0; i < stageIndex; i++) {
    if (job.stages[i].status !== 'completed') {
      job.stages[i].status = 'completed';
      if (!job.stages[i].completedAt) {
        job.stages[i].completedAt = Date.now();
      }
    }
  }

  job.lastActivityAt = Date.now();
  upsertIngestionJob(job);
  jobEmitter.emit(`job:${job.id}`, job);
}

function classifyError(stderr: string, stdout: string): { code: IngestionErrorCode; title: string; message: string } {
  const combined = (stderr + '\n' + stdout).toLowerCase();

  // Extract the most relevant error line (e.g. ERROR: [youtube] ...)
  const allLines = (stderr + '\n' + stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('WARNING:'));

  const errorLine = allLines.find((l) => l.startsWith('ERROR:')) || allLines[allLines.length - 1] || '';
  const cleanErrorLine = errorLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').trim();

  if (
    combined.includes('private video') ||
    combined.includes('sign in to confirm your age') ||
    combined.includes('members-only') ||
    combined.includes('confirm your age') ||
    combined.includes('requires authentication')
  ) {
    return {
      code: 'video_restricted',
      title: 'Video Restricted or Private',
      message: cleanErrorLine || 'This video is private, age-restricted, or requires login credentials to access.',
    };
  }

  if (
    combined.includes('video is unavailable') ||
    combined.includes('video unavailable') ||
    combined.includes('this video is not available') ||
    combined.includes('does not exist') ||
    combined.includes('not found') ||
    combined.includes('unavailable')
  ) {
    return {
      code: 'video_unavailable',
      title: 'Video Unavailable',
      message: cleanErrorLine || 'The requested YouTube video does not exist, has been removed, or is inaccessible.',
    };
  }

  if (
    combined.includes('network is unreachable') ||
    combined.includes('connection reset') ||
    combined.includes('incompleteread') ||
    combined.includes('timed out') ||
    combined.includes('temporary failure in name resolution')
  ) {
    return {
      code: 'network_interruption',
      title: 'Network Interruption',
      message: 'Network connection was interrupted while streaming media from YouTube. Please try again.',
    };
  }

  if (combined.includes('no space left on device')) {
    return {
      code: 'insufficient_storage',
      title: 'Insufficient Storage',
      message: 'The server ran out of disk space while saving the media streams.',
    };
  }

  if (
    combined.includes('requested format is not available') ||
    combined.includes('no video formats found')
  ) {
    return {
      code: 'stream_extraction_failed',
      title: 'Stream Extraction Failed',
      message: 'Could not extract suitable video and audio streams for this video.',
    };
  }

  return {
    code: 'generic',
    title: 'Ingestion Error',
    message: cleanErrorLine || 'An error occurred during video processing.',
  };
}

/**
 * Rapidly fetch basic metadata via YouTube oEmbed
 */
async function fetchOEmbedMetadata(url: string): Promise<{ title?: string; author?: string; thumbnailUrl?: string } | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title,
      author: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return null;
  }
}

/**
 * Starts or returns an existing background ingestion job
 */
export async function startIngestion(
  url: string,
  confirmedOwnership: boolean,
  forceReimport = false
): Promise<IngestionJob> {
  initStorageDirs();

  const cleanUrl = url.trim();
  const videoId = extractYouTubeVideoId(cleanUrl);

  if (!videoId) {
    throw new Error('Please enter a valid YouTube video or shorts URL.');
  }

  if (!confirmedOwnership) {
    throw new Error('You must confirm ownership or authorization to process this video.');
  }

  // Check if existing project is already in database and local file exists
  if (!forceReimport) {
    const existingProject = getProjectByYouTubeId(videoId);
    if (existingProject && fs.existsSync(existingProject.localPath)) {
      const existingJobId = `job_${videoId}_existing`;
      const completedJob: IngestionJob = {
        id: existingJobId,
        url: cleanUrl,
        videoId,
        title: existingProject.title,
        author: 'Library',
        thumbnailUrl: existingProject.thumbnailUrl,
        duration: existingProject.metadata.duration,
        status: 'completed',
        currentStage: 'preparing_workspace',
        stages: createInitialStages().map((s) => ({
          ...s,
          status: 'completed',
          completedAt: Date.now(),
        })),
        progress: 100,
        startedAt: existingProject.createdAt,
        lastActivityAt: Date.now(),
        completedAt: Date.now(),
        project: existingProject,
      };
      upsertIngestionJob(completedJob);
      videoStore.setSource(existingProject);
      return completedJob;
    }
  }

  // Check if there is an active job currently running for this video
  const existingActive = getLatestActiveIngestionJob();
  if (existingActive && existingActive.videoId === videoId && existingActive.status === 'processing') {
    return existingActive;
  }

  const jobId = `job_${videoId}_${Date.now()}`;
  const stages = createInitialStages();

  const job: IngestionJob = {
    id: jobId,
    url: cleanUrl,
    videoId,
    status: 'processing',
    currentStage: 'initializing',
    stages,
    progress: 0,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  upsertIngestionJob(job);

  // Run the ingestion pipeline asynchronously in the background
  runIngestionPipeline(job).catch((err) => {
    console.error(`Unhandled error in ingestion pipeline for job ${job.id}:`, err);
  });

  return job;
}

/**
 * Background pipeline runner
 */
async function runIngestionPipeline(job: IngestionJob) {
  const { id, url, videoId } = job;
  const targetId = `yt_${videoId}_${Date.now()}`;
  const outputTemplate = path.join(UPLOADS_DIR, `${targetId}.%(ext)s`);

  try {
    // Stage 1: Initializing
    updateJobStage(job, 'initializing', 'active');
    await new Promise((r) => setTimeout(r, 400));
    updateJobStage(job, 'initializing', 'completed');

    // Stage 2: Retrieving video metadata
    updateJobStage(job, 'metadata', 'active');

    // Fast oEmbed probe
    const oembed = await fetchOEmbedMetadata(url);
    if (oembed) {
      if (oembed.title) job.title = oembed.title;
      if (oembed.author) job.author = oembed.author;
      if (oembed.thumbnailUrl) job.thumbnailUrl = oembed.thumbnailUrl;
      job.lastActivityAt = Date.now();
      upsertIngestionJob(job);
      jobEmitter.emit(`job:${job.id}`, job);
    } else {
      // Default fallback thumbnail if oembed failed
      job.thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    updateJobStage(job, 'metadata', 'completed');

    // Stage 3: Fetching streams & downloading
    updateJobStage(job, 'downloading', 'active');

    const downloadResult = await new Promise<{
      finalFilePath: string;
      title: string;
      thumbnailUrl?: string;
    }>((resolve, reject) => {
      // yt-dlp arguments for highest quality <= 1080p with live progress
      const args = [
        '-f',
        'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '--newline',
        '--print',
        'after_move:filepath',
        '--print',
        'title',
        '--print',
        'thumbnail',
        '-o',
        outputTemplate,
        url,
      ];

      const proc = spawn(YT_DLP_BIN, args);
      activeProcesses.set(id, proc);

      let stdout = '';
      let stderr = '';
      let lastProgressUpdate = 0;

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;

        // Parse yt-dlp progress lines:
        // [download]  45.2% of ~  12.50MiB at    2.45MiB/s ETA 00:03
        // [download]  50.0% of 10.00MiB at 3.00MiB/s ETA 00:02
        const lines = text.split('\n');
        for (const line of lines) {
          const dlMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+(?:~?\s*([0-9.]+[A-Za-z]+))(?:\s+at\s+([0-9.]+[A-Za-z]+\/s))?(?:\s+ETA\s+([0-9:]+))?/);
          if (dlMatch) {
            const percent = parseFloat(dlMatch[1]);
            const totalStr = dlMatch[2];
            const speedStr = dlMatch[3];
            const etaStr = dlMatch[4];

            if (!isNaN(percent)) {
              job.progress = Math.min(99.9, Math.max(job.progress, percent));
            }
            if (speedStr) job.speed = speedStr;
            if (etaStr) job.eta = etaStr;

            // Throttle database writes and socket emits to max once every 250ms
            const now = Date.now();
            if (now - lastProgressUpdate > 250) {
              lastProgressUpdate = now;
              job.lastActivityAt = now;
              upsertIngestionJob(job);
              jobEmitter.emit(`job:${job.id}`, job);
            }
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        activeProcesses.delete(id);
        reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
      });

      proc.on('close', (code) => {
        activeProcesses.delete(id);

        if (code !== 0) {
          const errorInfo = classifyError(stderr, stdout);
          const err = new Error(errorInfo.message);
          (err as any).errorInfo = errorInfo;
          return reject(err);
        }

        const lines = stdout.trim().split('\n').filter(Boolean);
        let finalFilePath = '';
        let videoTitle = job.title || 'YouTube Video';
        let thumb = job.thumbnailUrl;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            thumb = trimmed;
          } else if (trimmed.includes(targetId)) {
            finalFilePath = trimmed;
          } else if (!videoTitle || videoTitle === 'YouTube Video') {
            if (!trimmed.startsWith('[download]') && !trimmed.startsWith('[Merger]')) {
              videoTitle = trimmed;
            }
          }
        }

        // Fallback file search if filepath line wasn't matched
        if (!finalFilePath || !fs.existsSync(finalFilePath)) {
          const matches = fs.readdirSync(UPLOADS_DIR).filter((f) => f.startsWith(targetId));
          if (matches.length > 0) {
            finalFilePath = path.join(UPLOADS_DIR, matches[0]);
          }
        }

        if (!finalFilePath || !fs.existsSync(finalFilePath)) {
          return reject(new Error('Downloaded video asset could not be located on disk.'));
        }

        resolve({
          finalFilePath,
          title: videoTitle,
          thumbnailUrl: thumb,
        });
      });
    });

    job.progress = 100;
    job.speed = undefined;
    job.eta = undefined;
    updateJobStage(job, 'downloading', 'completed');

    // Stage 4: Preparing video assets
    updateJobStage(job, 'processing_assets', 'active');

    // Run FFprobe to extract duration, fps, resolution, bitrate
    const metadata = await probeVideo(downloadResult.finalFilePath);
    const filename = path.basename(downloadResult.finalFilePath);

    updateJobStage(job, 'processing_assets', 'completed');

    // Stage 5: Preparing editing workspace
    updateJobStage(job, 'preparing_workspace', 'active');

    const project: VideoProject = {
      id: `yt_${videoId}`,
      title: downloadResult.title || job.title || 'YouTube Video',
      filename,
      localPath: downloadResult.finalFilePath,
      streamUrl: `/api/video/stream?type=source&filename=${encodeURIComponent(filename)}`,
      metadata,
      sourceOrigin: 'youtube',
      youtubeVideoId: videoId,
      youtubeUrl: url,
      thumbnailUrl: downloadResult.thumbnailUrl || job.thumbnailUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    upsertProject(project);
    videoStore.setSource(project);

    job.project = project;
    job.duration = metadata.duration;
    job.title = project.title;
    job.thumbnailUrl = project.thumbnailUrl;
    job.status = 'completed';
    job.completedAt = Date.now();
    updateJobStage(job, 'preparing_workspace', 'completed');

    jobEmitter.emit(`job:${job.id}`, job);
  } catch (err: any) {
    console.error(`Ingestion error for job ${job.id}:`, err);
    activeProcesses.delete(id);

    const errorInfo: { code: IngestionErrorCode; title: string; message: string } =
      err.errorInfo || {
        code: 'generic',
        title: 'Processing Failed',
        message: err.message || 'Failed to process YouTube video.',
      };

    job.status = 'error';
    job.error = errorInfo;
    job.lastActivityAt = Date.now();

    // Mark current active stage as error
    const activeStage = job.stages.find((s) => s.id === job.currentStage);
    if (activeStage) {
      activeStage.status = 'error';
    }

    upsertIngestionJob(job);
    jobEmitter.emit(`job:${job.id}`, job);
  }
}

/**
 * Cancel an ongoing ingestion job
 */
export function cancelIngestion(jobId: string): boolean {
  const proc = activeProcesses.get(jobId);
  if (proc) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    activeProcesses.delete(jobId);
  }

  const job = getIngestionJob(jobId);
  if (job && job.status === 'processing') {
    job.status = 'error';
    job.error = {
      code: 'generic',
      title: 'Import Cancelled',
      message: 'Video ingestion was cancelled by the user.',
    };
    upsertIngestionJob(job);
    jobEmitter.emit(`job:${job.id}`, job);
    return true;
  }
  return false;
}

/**
 * Subscribe to real-time events for a job
 */
export function subscribeToJob(
  jobId: string,
  listener: (job: IngestionJob) => void
): () => void {
  const eventName = `job:${jobId}`;
  jobEmitter.on(eventName, listener);
  return () => {
    jobEmitter.off(eventName, listener);
  };
}
