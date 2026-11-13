'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  Trash2,
  Scissors,
  RotateCcw,
  Clock,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Film,
  Subtitles,
  Share2,
  Smartphone,
  Tv,
} from 'lucide-react';
import { ClipSegment } from '@/types/video';
import { formatTime, formatBytes } from '@/lib/format';
import { SocialDistributionModal } from './SocialDistributionModal';

interface ClipPreviewModalProps {
  clip: ClipSegment | null;
  clipIndex: number;
  originalStreamUrl: string;
  sourceTitle?: string;
  isOpen: boolean;
  autoPlay?: boolean;
  onClose: () => void;
  onCutClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
}

const ClipPreviewModalInner: React.FC<ClipPreviewModalProps & { clip: ClipSegment }> = ({
  clip,
  clipIndex,
  originalStreamUrl,
  sourceTitle,
  isOpen,
  autoPlay = false,
  onClose,
  onCutClip,
  onDeleteClip,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isSocialDeskOpen, setIsSocialDeskOpen] = useState(false);

  const isCompleted = clip.status === 'completed';
  const isProcessing = clip.status === 'processing';
  const isFailed = clip.status === 'error';
  const isDraft = clip.status === 'draft';

  const clipDuration = Math.max(0.1, clip.endTime - clip.startTime);
  const videoSrc = isCompleted && clip.outputUrl ? clip.outputUrl : originalStreamUrl;

  // Independent playback setup
  useEffect(() => {
    setIsLoadingVideo(true);
    setVideoError(null);
    setCurrentTime(0);

    const video = videoRef.current;
    if (video) {
      video.load();
    }

    return () => {
      if (video) {
        video.pause();
      }
      setIsPlaying(false);
    };
  }, [clip.id, videoSrc]);

  const handleLoadedMetadata = () => {
    setIsLoadingVideo(false);
    setVideoError(null);
    const video = videoRef.current;
    if (!video) return;

    if (!isCompleted) {
      video.currentTime = clip.startTime;
    } else {
      video.currentTime = 0;
    }

    if (autoPlay) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clip.outputFilename) return;

    const safeName = (clip.name || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp4';
    const downloadUrl = `/api/video/download?type=clip&filename=${encodeURIComponent(
      clip.outputFilename
    )}&downloadName=${encodeURIComponent(safeName)}`;

    // Use a hidden iframe to prevent webview navigation
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // ignore
      }
    }, 10000);
  };

  const handleDownloadSubtitles = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const safeName = (clip.name || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_') + '.srt';
    const downloadUrl = `/api/video/subtitles?clipId=${encodeURIComponent(clip.id)}&format=srt`;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // ignore
      }
    }, 10000);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (!isCompleted && video.currentTime >= clip.endTime) {
        video.currentTime = clip.startTime;
      }
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    if (!isCompleted) {
      // Loop or stop boundary
      if (video.currentTime >= clip.endTime) {
        video.pause();
        video.currentTime = clip.startTime;
        setIsPlaying(false);
        setCurrentTime(0);
      } else if (video.currentTime < clip.startTime) {
        video.currentTime = clip.startTime;
        setCurrentTime(0);
      } else {
        setCurrentTime(video.currentTime - clip.startTime);
      }
    } else {
      // Processed clip: [0, clipDuration]
      setCurrentTime(video.currentTime);
      if (video.currentTime >= clipDuration) {
        setIsPlaying(false);
      }
    }
  };

  const handleSeek = (timeWithinClip: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(clipDuration, timeWithinClip));
    setCurrentTime(clamped);

    if (!isCompleted) {
      video.currentTime = clip.startTime + clamped;
    } else {
      video.currentTime = clamped;
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
      setIsMuted(newVolume === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.key === ' ' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isCompleted, clip.startTime, clip.endTime]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
          {/* Header Bar */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-950/70">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 font-mono text-xs flex items-center justify-center font-bold">
                #{clipIndex}
              </span>
              <div>
                <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                  <span>{clip.name}</span>
                  {clip.aspectRatio && clip.aspectRatio !== 'original' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 border border-pink-500/30 flex items-center gap-1">
                      <Smartphone className="w-2.5 h-2.5" />
                      <span>{clip.aspectRatio === 'portrait_blur' ? '9:16 Blur' : '9:16 Crop'}</span>
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono">
                  {formatTime(clip.startTime, true)} → {formatTime(clip.endTime, true)} ({clipDuration.toFixed(1)}s)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Status Badge */}
              {isCompleted && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-2.5 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Completed</span>
                </span>
              )}
              {isProcessing && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-2.5 py-0.5 rounded-full">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing {clip.progress}%</span>
                </span>
              )}
              {isDraft && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400 bg-amber-950/80 border border-amber-800/80 px-2.5 py-0.5 rounded-full">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Draft</span>
                </span>
              )}
              {isFailed && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-red-400 bg-red-950/80 border border-red-800/80 px-2.5 py-0.5 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Failed</span>
                </span>
              )}

              {/* Social Desk trigger */}
              <button
                onClick={() => setIsSocialDeskOpen(true)}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-pink-600/30 text-zinc-300 hover:text-pink-300 transition-colors border border-zinc-700/60 ml-1"
                title="Social Distribution Desk (TikTok, Shorts, Reels)"
              >
                <Share2 className="w-4 h-4" />
              </button>

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors ml-1"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Video Screen Area */}
          <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              className="w-full h-full object-contain cursor-pointer"
              onClick={togglePlay}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={() => setIsLoadingVideo(false)}
              onError={() => {
                setIsLoadingVideo(false);
                setVideoError('Unable to load video stream for this clip.');
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            >
              {/* Synchronized WebVTT subtitle track */}
              <track
                kind="subtitles"
                src={`/api/video/subtitles?clipId=${encodeURIComponent(clip.id)}`}
                srcLang="en"
                label="Subtitles"
                default
              />
            </video>

            {isLoadingVideo && !videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              </div>
            )}

            {videoError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-4 text-center z-10">
                <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
                <p className="text-xs text-rose-300 max-w-sm">{videoError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setVideoError(null);
                    videoRef.current?.load();
                  }}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white transition-colors"
                >
                  Retry Playback
                </button>
              </div>
            )}

            {/* Floating mode pill */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-zinc-700/50 px-2.5 py-1 rounded-md text-[10px] text-zinc-300 pointer-events-none">
              <Film className="w-3 h-3 text-indigo-400" />
              <span>{isCompleted ? 'Generated MP4 Asset' : 'Trim Range Preview'}</span>
            </div>
          </div>

          {/* Independent Player Controls */}
          <div className="bg-zinc-950 px-4 py-2 border-t border-zinc-800 flex flex-col gap-2">
            {/* Scrubber Bar */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-zinc-400 w-16 text-right">
                {formatTime(currentTime, true)}
              </span>
              <input
                type="range"
                min="0"
                max={clipDuration}
                step="0.05"
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="flex-1 h-1.5 accent-indigo-500 bg-zinc-800 rounded-lg cursor-pointer"
              />
              <span className="text-[11px] font-mono text-zinc-400 w-16">
                {formatTime(clipDuration, true)}
              </span>
            </div>

            {/* Transport buttons */}
            <div className="flex items-center justify-between text-xs pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-indigo-600/30"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  onClick={() => handleSeek(0)}
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                  title="Restart"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-14 h-1.5 accent-indigo-500 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Clip Metadata & Actions Bar */}
          <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            {/* Metadata chips */}
            <div className="flex flex-wrap items-center gap-3 text-zinc-400 font-mono text-[11px]">
              <div className="flex items-center gap-1 bg-zinc-950 px-2 py-1 rounded border border-zinc-800">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span>
                  {formatTime(clip.startTime, true)} → {formatTime(clip.endTime, true)}
                </span>
              </div>

              <div className="flex items-center gap-1 bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-200 font-medium">
                <span>Duration:</span>
                <span className="text-indigo-400">{clipDuration.toFixed(2)}s</span>
              </div>

              {isCompleted && clip.outputSize && (
                <div className="flex items-center gap-1 bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-emerald-400 font-medium">
                  <HardDrive className="w-3 h-3" />
                  <span>{formatBytes(clip.outputSize)}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {/* Cut / Retry button if not completed */}
              {(!isCompleted || isFailed) && (
                <button
                  onClick={() => onCutClip(clip.id)}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : isFailed ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Extraction</span>
                    </>
                  ) : (
                    <>
                      <Scissors className="w-3.5 h-3.5" />
                      <span>Process & Export MP4</span>
                    </>
                  )}
                </button>
              )}

              {/* Subtitles Download */}
              <button
                type="button"
                onClick={handleDownloadSubtitles}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors border border-zinc-700/60"
                title="Download .SRT subtitle file"
              >
                <Subtitles className="w-3.5 h-3.5 text-amber-400" />
                <span>.SRT</span>
              </button>

              {/* Export / Download MP4 Button */}
              {isCompleted && clip.outputFilename ? (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                  title="Export & Download MP4"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download MP4</span>
                </button>
              ) : (
                <button
                  disabled
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 font-medium cursor-not-allowed border border-zinc-700/50"
                  title="Process the clip first to enable download"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              )}

              {/* Delete button */}
              <button
                onClick={() => {
                  onDeleteClip(clip.id);
                  onClose();
                }}
                disabled={isProcessing}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-950/70 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-50"
                title="Delete Clip"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Social Distribution Desk */}
      <SocialDistributionModal
        isOpen={isSocialDeskOpen}
        onClose={() => setIsSocialDeskOpen(false)}
        clip={clip}
        sourceTitle={sourceTitle}
      />
    </>
  );
};

/**
 * Mounts the modal body only while open. (The body used to `return null` before its hooks,
 * which broke the Rules of Hooks and crashed the page when a finished clip opened.)
 * Mounting fresh per open also resets playback state for each clip.
 */
export const ClipPreviewModal: React.FC<ClipPreviewModalProps> = (props) =>
  props.clip && props.isOpen ? <ClipPreviewModalInner {...props} clip={props.clip} /> : null;
