import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VideoMetadata } from '@/types/video';

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe';

interface FFprobeOutput {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
    size?: string;
    format_name?: string;
    bit_rate?: string;
  };
}

/**
 * Extracts comprehensive video metadata using ffprobe
 */
export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn(FFPROBE_BIN, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`FFprobe spawn failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
      }

      try {
        const data: FFprobeOutput = JSON.parse(stdout);
        const videoStream = data.streams?.find((s) => s.codec_type === 'video');

        const formatDuration = data.format?.duration ? parseFloat(data.format.duration) : 0;
        const streamDuration = videoStream?.duration ? parseFloat(videoStream.duration) : 0;
        const duration = formatDuration || streamDuration || 0;

        const width = videoStream?.width || 1280;
        const height = videoStream?.height || 720;
        const size = data.format?.size ? parseInt(data.format.size, 10) : fs.statSync(filePath).size;
        const format = data.format?.format_name || 'mp4';
        const bitrate = data.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : undefined;

        // Calculate FPS
        let fps = 30;
        const fpsStr = videoStream?.r_frame_rate || videoStream?.avg_frame_rate;
        if (fpsStr && fpsStr.includes('/')) {
          const [num, den] = fpsStr.split('/').map(Number);
          if (den && den > 0 && num > 0) {
            fps = Math.round((num / den) * 100) / 100;
          }
        }

        resolve({
          duration,
          width,
          height,
          size,
          format,
          fps,
          bitrate,
        });
      } catch (e) {
        reject(new Error(`Failed to parse FFprobe output: ${(e as Error).message}`));
      }
    });
  });
}

export interface CutVideoOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  aspectRatio?: 'original' | 'portrait_blur' | 'portrait_crop';
  subtitlesPath?: string;
  /** ASS file (styled captions). Takes precedence over subtitlesPath. */
  assPath?: string;
  /** Directory of .ttf/.otf fonts for libass. */
  fontsDir?: string;
  /** Framing for portrait_crop: zoom >= 1 and an ffmpeg expression for the crop-window centre (0..1 of source width). */
  crop?: { zoom: number; centerExpr: string };
  onProgress?: (progressPercent: number) => void;
}

/**
 * Cuts a video segment using FFmpeg with high precision and faststart flag.
 * Supports 9:16 vertical blur background, 9:16 crop, and burned-in subtitles.
 * Reports real-time percentage progress.
 */
export async function cutVideoSegment(options: CutVideoOptions): Promise<void> {
  const { inputPath, outputPath, startTime, endTime, aspectRatio = 'original', subtitlesPath, assPath, fontsDir, crop, onProgress } = options;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const duration = Math.max(0.1, endTime - startTime);

  return new Promise((resolve, reject) => {
    // Frame-accurate cut. `-ss` BEFORE `-i` seeks to the previous keyframe quickly, and because we
    // re-encode (never `-c copy`) FFmpeg decodes from that keyframe and discards frames up to the
    // exact start, so boundaries are not snapped to keyframes. `-t` bounds the output duration.
    // `-movflags +faststart` puts the moov atom first so the clip streams in the browser.
    const args = [
      '-ss', startTime.toFixed(3),
      '-i', inputPath,
      '-t', duration.toFixed(3),
    ];

    const escapedSubtitlesPath = subtitlesPath ? subtitlesPath.replace(/'/g, "\\'") : '';
    // Filter-argument escaping for paths (':' and '\\' are special inside a filtergraph).
    const fq = (v: string) => v.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    // Styled ASS captions win over plain SRT; libass reads fonts from fontsDir when given.
    const assFilter = assPath ? `subtitles='${fq(assPath)}'${fontsDir ? `:fontsdir='${fq(fontsDir)}'` : ''}` : '';
    const subtitleStyle = "force_style='FontSize=18,FontName=Arial,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=35'";

    const captionFilter = assFilter || (escapedSubtitlesPath ? `subtitles='${escapedSubtitlesPath}':${subtitleStyle}` : '');

    if (aspectRatio === 'portrait_blur') {
      let filterComplex = '[0:v]split=2[in_fg][in_bg];[in_bg]scale=120:213:force_original_aspect_ratio=increase,crop=120:213,boxblur=4:1,scale=1080:1920:flags=bilinear[bg];[in_fg]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2';
      if (captionFilter) filterComplex += `,${captionFilter}`;
      filterComplex += '[outv]';
      args.push('-filter_complex', filterComplex, '-map', '[outv]', '-map', '0:a:0?');
    } else if (aspectRatio === 'portrait_crop') {
      // Crop window = 9:16 slice of the source (smaller with zoom); its centre follows centerExpr (static or tracked).
      // Clamped so the window never leaves the frame. `t` is clip time because -ss precedes -i.
      const z = Math.max(1, crop?.zoom ?? 1);
      const c = crop?.centerExpr ?? '0.5';
      let vf = `crop=w='ih/${z}*9/16':h='ih/${z}':x='max(0,min(iw-ow,(${c})*iw-ow/2))':y='(ih-oh)/2',scale=1080:1920:flags=lanczos`;
      if (captionFilter) vf += `,${captionFilter}`;
      args.push('-vf', vf, '-map', '0:v:0', '-map', '0:a:0?');
    } else {
      if (captionFilter) args.push('-vf', captionFilter);
      // `?` = optional: sources without an audio track must not fail the cut.
      args.push('-map', '0:v:0', '-map', '0:a:0?');
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-y',
      outputPath,
    );

    const proc = spawn(FFMPEG_BIN, args);

    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us') {
          const currentMicroseconds = parseInt(value, 10);
          if (!isNaN(currentMicroseconds) && duration > 0) {
            const currentSeconds = currentMicroseconds / 1_000_000;
            const percent = Math.min(99, Math.max(0, Math.round((currentSeconds / duration) * 100)));
            onProgress?.(percent);
          }
        } else if (key === 'progress' && value === 'end') {
          onProgress?.(100);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process failed to spawn: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
      }
    });
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`FFmpeg spawn failed: ${e.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-200)}`))));
  });
}

/**
 * Builds a single-row JPEG "filmstrip" (N tiles, each 48x72 px, centre-cropped) used as the
 * timeline background. Each tile is one fast keyframe seek (cost ~ O(tiles), independent of
 * video length: an 87-minute video takes seconds, not minutes), stitched with the tile filter.
 */
export async function generateFilmstrip(inputPath: string, outputPath: string, duration: number, tiles = 40): Promise<void> {
  if (!fs.existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filmstrip-'));
  try {
    const times = Array.from({ length: tiles }, (_, i) => ((i + 0.5) / tiles) * duration);
    const extract = (i: number) =>
      runFfmpeg(['-v', 'error', '-ss', times[i].toFixed(3), '-i', inputPath, '-an', '-frames:v', '1',
        '-vf', 'scale=-2:72,crop=48:72', '-q:v', '5', '-y', path.join(tmp, `${String(i).padStart(3, '0')}.jpg`)]);

    // Bounded concurrency so we don't fork 40 ffmpeg processes at once.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, tiles) }, async () => {
      while (next < tiles) await extract(next++);
    }));

    await runFfmpeg(['-v', 'error', '-framerate', '1', '-i', path.join(tmp, '%03d.jpg'),
      '-vf', `tile=${tiles}x1`, '-frames:v', '1', '-q:v', '5', '-y', outputPath]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
