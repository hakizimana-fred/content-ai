'use client';

import React, { useState, useRef } from 'react';
import { Upload, Sparkles, AlertCircle, FileVideo, ShieldCheck, Loader2, PlayCircle } from 'lucide-react';
import { VideoSource, VideoProject, ClipSegment, IngestionJob } from '@/types/video';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface ImportZoneProps {
  onVideoLoaded: (source: VideoSource) => void;
  onDuplicateDetected?: (project: VideoProject, clips: ClipSegment[]) => void;
  onStartYouTubeIngestion?: (url: string, confirmedOwnership: boolean) => void;
  activeIngestionJob?: IngestionJob | null;
  onOpenIngestionModal?: () => void;
  onLoadSample: () => void;
  isLoadingSample?: boolean;
}

export const ImportZone: React.FC<ImportZoneProps> = ({
  onVideoLoaded,
  onDuplicateDetected,
  onStartYouTubeIngestion,
  activeIngestionJob,
  onOpenIngestionModal,
  onLoadSample,
  isLoadingSample = false,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'youtube'>('youtube');
  const [isDragging, setIsDragging] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [confirmedOwnership, setConfirmedOwnership] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    setIsUploading(true);
    setErrorMessage(null);
    setStatusMessage('Uploading and extracting video metadata...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/video/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload video');
      }

      onVideoLoaded(data.source);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsUploading(false);
      setStatusMessage(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFileUpload(file);
    }
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    if (!confirmedOwnership) {
      setErrorMessage('Please confirm you own or have rights to process this video.');
      return;
    }

    setErrorMessage(null);

    // 1. Check duplicate project
    try {
      if (onDuplicateDetected) {
        const checkRes = await fetch('/api/projects/check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: youtubeUrl.trim() }),
        });
        const checkData = await checkRes.json();

        if (checkData.success && checkData.exists && checkData.project) {
          onDuplicateDetected(checkData.project, checkData.clips || []);
          return;
        }
      }

      // 2. Delegate to YouTube ingestion pipeline
      if (onStartYouTubeIngestion) {
        onStartYouTubeIngestion(youtubeUrl.trim(), confirmedOwnership);
      }
    } catch (err) {
      setErrorMessage((err as Error).message);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto my-auto p-4 sm:p-6">
      {/* Container */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/60 p-1.5">
          <button
            onClick={() => {
              setActiveTab('upload');
              setErrorMessage(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
            }`}
          >
            <Upload className="w-4 h-4 text-indigo-400" />
            <span>Upload File (MP4)</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('youtube');
              setErrorMessage(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'youtube'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
            }`}
          >
            <YoutubeIcon className="w-4 h-4 text-red-500" />
            <span>YouTube URL</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6 sm:p-8">
          {errorMessage && (
            <div className="mb-6 p-3.5 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-3 text-red-200 text-xs sm:text-sm">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isUploading && (
            <div className="mb-6 p-4 bg-indigo-950/30 border border-indigo-800/40 rounded-xl flex items-center gap-3 text-indigo-200 text-xs sm:text-sm animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
              <span>{statusMessage || 'Processing upload with FFmpeg...'}</span>
            </div>
          )}

          {/* Active Background Job Notice */}
          {activeIngestionJob && activeIngestionJob.status === 'processing' && (
            <div className="mb-6 p-4 bg-indigo-950/40 border border-indigo-500/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                </span>
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-white truncate max-w-xs sm:max-w-md">
                    Ingesting: {activeIngestionJob.title || 'YouTube Stream'}
                  </p>
                  <p className="text-[11px] text-indigo-300">
                    {activeIngestionJob.stages.find((s) => s.id === activeIngestionJob.currentStage)?.label || 'Processing video streams...'}
                    {activeIngestionJob.progress > 0 && ` (${activeIngestionJob.progress.toFixed(0)}%)`}
                  </p>
                </div>
              </div>

              {onOpenIngestionModal && (
                <button
                  type="button"
                  onClick={onOpenIngestionModal}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow flex items-center gap-1.5 self-end sm:self-center"
                >
                  <span>View Pipeline</span>
                  <PlayCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {activeTab === 'upload' ? (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`cursor-pointer border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-all flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-zinc-700/70 hover:border-zinc-500 bg-zinc-950/40 hover:bg-zinc-950/70'
                } ${isUploading ? 'pointer-events-none opacity-50' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />

                <div className="w-14 h-14 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300 shadow-inner group-hover:scale-105 transition-transform">
                  <FileVideo className="w-7 h-7 text-indigo-400" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-200">
                    Drag and drop your video here, or <span className="text-indigo-400 underline underline-offset-2">browse</span>
                  </p>
                  <p className="text-xs text-zinc-400">Supports MP4, MOV, WebM (up to 1080p / 4K)</p>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleYoutubeSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">YouTube Video or Short URL</label>
                <div className="relative">
                  <input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    disabled={isUploading}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Ownership Confirmation Requirement */}
              <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex items-start gap-3">
                <input
                  id="ownership-check"
                  type="checkbox"
                  checked={confirmedOwnership}
                  onChange={(e) => setConfirmedOwnership(e.target.checked)}
                  disabled={isUploading}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500 bg-zinc-900 cursor-pointer"
                />
                <label htmlFor="ownership-check" className="text-xs text-zinc-400 cursor-pointer select-none leading-relaxed">
                  <span className="text-zinc-200 font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Ownership Verification
                  </span>
                  I confirm that I own this video or have explicit permission from the rights holder to download and edit it.
                </label>
              </div>

              <button
                type="submit"
                disabled={isUploading || !youtubeUrl.trim() || !confirmedOwnership}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs sm:text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <YoutubeIcon className="w-4 h-4 text-red-500" />
                <span>Start Video Ingestion</span>
              </button>
            </form>
          )}

          {/* Quick Sample video bar */}
          <div className="mt-6 pt-5 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
            <span>Want to test the editor without uploading?</span>
            <button
              onClick={onLoadSample}
              disabled={isUploading || isLoadingSample}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors disabled:opacity-50 font-medium"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{isLoadingSample ? 'Generating sample...' : 'Load Instant Sample Video'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
