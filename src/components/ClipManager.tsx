'use client';

import React from 'react';
import {
  Scissors,
  Download,
  Trash2,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  HardDrive,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { ClipSegment } from '@/types/video';
import { formatTime, formatBytes } from '@/lib/format';

interface ClipManagerProps {
  clips: ClipSegment[];
  onOpenPreviewModal: (clip: ClipSegment, autoPlay?: boolean) => void;
  onCutClip: (clipId: string) => void;
  onCutAllClips: () => void;
  onDeleteClip: (clipId: string) => void;
  onUpdateClipName: (clipId: string, newName: string) => void;
  isCuttingAny: boolean;
}

export const ClipManager: React.FC<ClipManagerProps> = ({
  clips,
  onOpenPreviewModal,
  onCutClip,
  onCutAllClips,
  onDeleteClip,
  onUpdateClipName,
  isCuttingAny,
}) => {
  const pendingClipsCount = clips.filter((c) => c.status === 'draft' || c.status === 'error').length;
  const completedClipsCount = clips.filter((c) => c.status === 'completed').length;

  const handleDownloadClip = (e: React.MouseEvent, clip: ClipSegment) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clip.outputFilename) return;

    const safeName = (clip.name || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp4';
    const downloadUrl = `/api/video/download?type=clip&filename=${encodeURIComponent(
      clip.outputFilename
    )}&downloadName=${encodeURIComponent(safeName)}`;

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

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-300">
            <Scissors className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <h3 className="font-semibold text-sm text-zinc-100">
            Clips Queue ({clips.length})
          </h3>
          {completedClipsCount > 0 && (
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
              {completedClipsCount} ready
            </span>
          )}
        </div>

        {/* Action: Cut All Draft Clips */}
        {pendingClipsCount > 0 && (
          <button
            onClick={onCutAllClips}
            disabled={isCuttingAny}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/25 transition-all disabled:opacity-50"
          >
            {isCuttingAny ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Cutting...</span>
              </>
            ) : (
              <>
                <Scissors className="w-3.5 h-3.5" />
                <span>Cut All ({pendingClipsCount})</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Empty State */}
      {clips.length === 0 ? (
        <div className="py-8 px-4 text-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/40">
          <Scissors className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-zinc-300">No clips created yet</p>
          <p className="text-xs text-zinc-500 mt-1">
            Set In [I] and Out [O] points on the timeline, then click <strong className="text-zinc-300">Add Clip</strong>.
          </p>
        </div>
      ) : (
        /* Clips List: Clickable Assets */
        <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
          {clips.map((clip, index) => {
            const clipDuration = Math.max(0, clip.endTime - clip.startTime);
            const isProcessing = clip.status === 'processing';
            const isCompleted = clip.status === 'completed';
            const isFailed = clip.status === 'error';
            const isDraft = clip.status === 'draft';

            return (
              <div
                key={clip.id}
                onClick={() => onOpenPreviewModal(clip, false)}
                className={`group p-3 rounded-lg border transition-all cursor-pointer relative select-none ${
                  isProcessing
                    ? 'bg-zinc-950/80 border-indigo-500/50 ring-1 ring-indigo-500/30'
                    : isCompleted
                    ? 'bg-zinc-950/70 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-zinc-900/80'
                    : isFailed
                    ? 'bg-red-950/15 border-red-800/40 hover:border-red-700/60'
                    : 'bg-zinc-950/60 border-zinc-800 hover:border-indigo-500/40 hover:bg-zinc-900/80'
                }`}
              >
                {/* Top: Name & Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-5 h-5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-center shrink-0">
                      #{index + 1}
                    </span>
                    <input
                      type="text"
                      value={clip.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onUpdateClipName(clip.id, e.target.value)}
                      disabled={isProcessing}
                      className="text-xs font-semibold text-zinc-200 bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:outline-none truncate w-full cursor-text"
                      placeholder="Clip Name"
                    />
                  </div>

                  {/* Status Badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isProcessing && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 bg-indigo-950/70 border border-indigo-800/60 px-2 py-0.5 rounded-full">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{clip.progress || 0}%</span>
                      </span>
                    )}

                    {isCompleted && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Completed</span>
                      </span>
                    )}

                    {isFailed && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-950/70 border border-red-800/60 px-2 py-0.5 rounded-full">
                        <AlertCircle className="w-3 h-3" />
                        <span>Failed</span>
                      </span>
                    )}

                    {isDraft && (
                      <span className="text-[11px] font-medium text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">
                        Draft
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar during FFmpeg processing */}
                {isProcessing && (
                  <div className="mt-2.5 w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${clip.progress || 0}%` }}
                      className="bg-indigo-500 h-full transition-all duration-200"
                    />
                  </div>
                )}

                {/* Error message */}
                {isFailed && (
                  <p className="mt-2 text-[11px] text-red-400 truncate">{clip.error}</p>
                )}

                {/* Metadata & Actions */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/50 text-xs">
                  {/* Time info */}
                  <div className="flex items-center gap-2.5 text-zinc-400 font-mono text-[11px]">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span>{formatTime(clip.startTime, true)} → {formatTime(clip.endTime, true)}</span>
                    </div>

                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-300 font-medium">{formatTime(clipDuration, true)}</span>

                    {/* File Size if completed */}
                    {isCompleted && clip.outputSize && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <div className="flex items-center gap-1 text-emerald-400 font-medium">
                          <HardDrive className="w-3 h-3" />
                          <span>{formatBytes(clip.outputSize)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Buttons */}
                  <div className="flex items-center gap-1.5">
                    {/* Play / Open Independent Preview Modal */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPreviewModal(clip, true);
                      }}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-indigo-600 hover:text-white text-zinc-300 transition-colors"
                      title="Open clip preview & play"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>

                    {/* Cut / Retry button if draft or failed */}
                    {(isDraft || isFailed) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCutClip(clip.id);
                        }}
                        disabled={isCuttingAny}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                        title={isFailed ? 'Retry cutting clip' : 'Cut clip with FFmpeg'}
                      >
                        {isFailed ? <RotateCcw className="w-3 h-3" /> : <Scissors className="w-3 h-3" />}
                        <span>{isFailed ? 'Retry' : 'Cut'}</span>
                      </button>
                    )}

                    {/* Export / Download button if completed */}
                    {isCompleted && clip.outputFilename && (
                      <button
                        type="button"
                        onClick={(e) => handleDownloadClip(e, clip)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors shadow-md shadow-emerald-600/20 cursor-pointer"
                        title="Export & Download MP4"
                      >
                        <Download className="w-3 h-3" />
                        <span>Export</span>
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteClip(clip.id);
                      }}
                      disabled={isProcessing}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Delete Clip"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
