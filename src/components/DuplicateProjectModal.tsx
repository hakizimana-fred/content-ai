'use client';

import React from 'react';
import { X, Film, Clock, Layers, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { VideoProject, ClipSegment } from '@/types/video';
import { formatTime } from '@/lib/format';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface DuplicateProjectModalProps {
  isOpen: boolean;
  project: VideoProject | null;
  clips: ClipSegment[];
  onReopen: (project: VideoProject, clips: ClipSegment[]) => void;
  onReimport: () => void;
  onCancel: () => void;
}

export const DuplicateProjectModal: React.FC<DuplicateProjectModalProps> = ({
  isOpen,
  project,
  clips,
  onReopen,
  onReimport,
  onCancel,
}) => {
  if (!isOpen || !project) return null;

  const completedClips = clips.filter((c) => c.status === 'completed');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <YoutubeIcon className="w-3.5 h-3.5 text-red-500" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-100">Existing Project Found</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <p className="text-xs text-zinc-300 leading-relaxed">
            This YouTube video was previously imported as a reusable project. You don&apos;t need to download or process it again!
          </p>

          {/* Project Preview Card */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 flex gap-3.5 items-start">
            {/* Thumbnail */}
            <div className="w-28 aspect-video bg-zinc-900 rounded-lg overflow-hidden shrink-0 relative border border-zinc-800">
              {project.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={project.thumbnailUrl}
                  alt={project.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600">
                  <Film className="w-6 h-6" />
                </div>
              )}
              <div className="absolute bottom-1 right-1 bg-black/80 font-mono text-[9px] px-1 py-0.5 rounded text-zinc-300">
                {formatTime(project.metadata.duration, false)}
              </div>
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1 flex flex-col gap-1 text-xs">
              <h4 className="font-semibold text-zinc-100 truncate">{project.title}</h4>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
                <YoutubeIcon className="w-3 h-3 text-red-500" />
                <span>ID: {project.youtubeVideoId}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-1">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-500" />
                  <span>{formatTime(project.metadata.duration, false)}</span>
                </div>
                <div className="flex items-center gap-1 text-indigo-400 font-medium">
                  <Layers className="w-3 h-3" />
                  <span>
                    {clips.length} {clips.length === 1 ? 'clip' : 'clips'} ({completedClips.length} ready)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-zinc-400 bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Reopening will instantly restore your timeline playhead and all {clips.length} previously saved clip segments without waiting for a re-download.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-2">
          <button
            onClick={onReimport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Re-import Fresh</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onReopen(project, clips)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/30"
            >
              <span>Reopen Project</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
