import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from './paths';

// Look for yt-dlp in PATH or local bin
const YT_DLP_BIN = process.env.YT_DLP_PATH ||
  (fs.existsSync('/home/fred/.local/bin/yt-dlp') ? '/home/fred/.local/bin/yt-dlp' : 'yt-dlp');

/**
 * Extracts and normalizes the 11-character YouTube video ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // If already an 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Regex for standard youtube watch, shorts, youtu.be, embed
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|watch\?.+&v=))([\w-]{11})/
  );

  return match ? match[1] : null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractYouTubeVideoId(url) !== null;
}

export interface YouTubeDownloadResult {
  localPath: string;
  filename: string;
  title: string;
  videoId: string;
  thumbnailUrl?: string;
}

/**
 * Downloads a YouTube video using yt-dlp
 */
export async function downloadYouTubeVideo(
  url: string,
  onProgress?: (message: string) => void
): Promise<YouTubeDownloadResult> {
  const cleanUrl = url.trim();
  const videoId = extractYouTubeVideoId(cleanUrl);

  if (!videoId) {
    throw new Error('Invalid YouTube URL. Please provide a valid YouTube watch or shorts URL.');
  }

  const id = `yt_${videoId}_${Date.now()}`;
  const outputTemplate = path.join(UPLOADS_DIR, `${id}.%(ext)s`);

  return new Promise((resolve, reject) => {
    onProgress?.('Fetching video metadata and starting download...');

    // Download best mp4 video or format <= 1080p for fast editing
    const args = [
      '-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--print', 'after_move:filepath',
      '--print', 'title',
      '--print', 'thumbnail',
      '-o', outputTemplate,
      cleanUrl,
    ];

    const proc = spawn(YT_DLP_BIN, args);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // Extract percentage if available
      const match = text.match(/\[download\]\s+([0-9.]+)%/);
      if (match) {
        onProgress?.(`Downloading: ${match[1]}%`);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp failed to spawn: ${err.message}. Make sure yt-dlp is installed.`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(`Failed to download YouTube video (${code}): ${stderr.slice(-300) || stdout.slice(-300)}`)
        );
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      let finalFilePath = '';
      let videoTitle = 'YouTube Video';
      let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // We printed: title, thumbnail, filepath (in order or reverse depending on output)
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
          thumbnailUrl = trimmedLine;
        } else if (trimmedLine.includes(id)) {
          finalFilePath = trimmedLine;
        } else if (!videoTitle || videoTitle === 'YouTube Video') {
          videoTitle = trimmedLine;
        }
      }

      // If stdout filepath wasn't directly found, check directory for matching id
      if (!finalFilePath || !fs.existsSync(finalFilePath)) {
        const files = fs.readdirSync(UPLOADS_DIR).filter((f) => f.startsWith(id));
        if (files.length > 0) {
          finalFilePath = path.join(UPLOADS_DIR, files[0]);
        }
      }

      if (!finalFilePath || !fs.existsSync(finalFilePath)) {
        return reject(new Error('Downloaded video file could not be found.'));
      }

      const filename = path.basename(finalFilePath);

      resolve({
        localPath: finalFilePath,
        filename,
        title: videoTitle,
        videoId,
        thumbnailUrl,
      });
    });
  });
}
