'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  X,
  Minimize2,
  HardDrive,
  Cpu,
  Radio,
  FileCheck,
  Sparkles,
} from 'lucide-react';
import { IngestionJob, IngestionStageId, VideoProject } from '@/types/video';
import { formatTime } from '@/lib/format';

interface IngestionProgressModalProps {
  job: IngestionJob | null;
  isOpen: boolean;
  onClose: () => void;
  onContinueInBackground: () => void;
  onRetry: (url: string) => void;
  onReady: (project: VideoProject) => void;
  onOpenWorkspacePreview?: (job: IngestionJob) => void;
}

export const IngestionProgressModal: React.FC<IngestionProgressModalProps> = ({
  job,
  isOpen,
  onClose,
  onContinueInBackground,
  onRetry,
  onReady,
  onOpenWorkspacePreview,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live timer for elapsed time
  useEffect(() => {
    if (!job || job.status !== 'processing') return;

    const updateTimer = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
      setElapsedSeconds(elapsed);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [job?.startedAt, job?.status]);

  if (!isOpen || !job) return null;

  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'error';
  const isProcessing = job.status === 'processing';

  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStageIcon = (stageId: IngestionStageId, status: string) => {
    if (status === 'completed') {
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    }
    if (status === 'error') {
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    }
    if (status === 'active') {
      return (
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
        </span>
      );
    }

    switch (stageId) {
      case 'initializing':
        return <Radio className="w-3.5 h-3.5 text-zinc-600" />;
      case 'metadata':
        return <Sparkles className="w-3.5 h-3.5 text-zinc-600" />;
      case 'downloading':
        return <HardDrive className="w-3.5 h-3.5 text-zinc-600" />;
      case 'processing_assets':
        return <Cpu className="w-3.5 h-3.5 text-zinc-600" />;
      case 'preparing_workspace':
        return <FileCheck className="w-3.5 h-3.5 text-zinc-600" />;
      default:
        return <div className="w-2 h-2 rounded-full bg-zinc-700" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isCompleted
                  ? 'bg-emerald-500 ring-4 ring-emerald-500/20'
                  : isFailed
                  ? 'bg-rose-500 ring-4 ring-rose-500/20'
                  : 'bg-indigo-500 ring-4 ring-indigo-500/20 animate-pulse'
              }`}
            />
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                YouTube Ingestion Pipeline
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full ${
                    isCompleted
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : isFailed
                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {isCompleted ? 'Ready' : isFailed ? 'Failed' : 'Processing'}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isProcessing && (
              <button
                onClick={onContinueInBackground}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/80 transition-colors"
                title="Keep downloading in the background and continue navigating"
              >
                <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Continue in Background</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Video Metadata Card */}
          <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* Thumbnail */}
            <div className="relative w-full sm:w-48 aspect-video rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0">
              {job.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={job.thumbnailUrl}
                  alt={job.title || 'YouTube Video'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
                  <span>Loading thumbnail...</span>
                </div>
              )}
              {job.duration ? (
                <span className="absolute bottom-1.5 right-1.5 bg-black/80 backdrop-blur-sm text-[10px] font-mono text-white px-1.5 py-0.5 rounded">
                  {formatTime(job.duration, false)}
                </span>
              ) : null}
            </div>

            {/* Video Details */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <h3 className="text-sm font-medium text-white line-clamp-2 leading-snug">
                {job.title || 'Resolving YouTube Video Title...'}
              </h3>
              {job.author && (
                <p className="text-xs text-zinc-400 font-medium">Channel: {job.author}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-zinc-500 font-mono">
                <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                  ID: {job.videoId}
                </span>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <span>Open URL</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          {/* Real-time Status Metric Ribbons */}
          {isProcessing && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Metric 1: Elapsed */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 text-indigo-400" /> Elapsed Time
                </span>
                <span className="text-base font-mono font-semibold text-zinc-200 mt-1">
                  {formatElapsed(elapsedSeconds)}
                </span>
              </div>

              {/* Metric 2: Speed */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-emerald-400" /> Stream Speed
                </span>
                <span className="text-base font-mono font-semibold text-zinc-200 mt-1 truncate">
                  {job.speed || (job.currentStage === 'downloading' ? 'Connecting...' : '—')}
                </span>
              </div>

              {/* Metric 3: ETA */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" /> Estimated ETA
                </span>
                <span className="text-base font-mono font-semibold text-zinc-200 mt-1 truncate">
                  {job.eta ? `~${job.eta}` : (job.currentStage === 'downloading' ? 'Calculating...' : '—')}
                </span>
              </div>

              {/* Metric 4: Progress */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3 flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-cyan-400" /> Stream Progress
                </span>
                <span className="text-base font-mono font-semibold text-zinc-200 mt-1">
                  {job.progress > 0 ? `${job.progress.toFixed(1)}%` : 'Active'}
                </span>
              </div>
            </div>
          )}

          {/* Download Progress Bar */}
          {isProcessing && job.progress > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-400 font-mono">
                <span>Downloading Stream</span>
                <span>{job.progress.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                />
              </div>
            </div>
          )}

          {/* Failure Alert Banner */}
          {isFailed && job.error && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start gap-3.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <h4 className="font-semibold text-rose-200 text-sm">{job.error.title}</h4>
                <p className="text-rose-300/90 leading-relaxed">{job.error.message}</p>
                <div className="pt-2">
                  <button
                    onClick={() => onRetry(job.url)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Ingestion</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Vertical Processing Stages Timeline */}
          <div className="space-y-3 pt-1">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Pipeline Stages
            </h4>

            <div className="relative pl-6 space-y-4">
              {/* Vertical connector line */}
              <div className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5 bg-zinc-800" />

              {job.stages.map((stage) => {
                const isActive = stage.status === 'active';
                const isDone = stage.status === 'completed';
                const isError = stage.status === 'error';

                return (
                  <div key={stage.id} className="relative flex items-start gap-3.5">
                    {/* Stage icon node */}
                    <div
                      className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                        isDone
                          ? 'bg-emerald-950/80 border border-emerald-500/60'
                          : isActive
                          ? 'bg-indigo-950/80 border border-indigo-500/80 shadow-lg shadow-indigo-500/20'
                          : isError
                          ? 'bg-rose-950/80 border border-rose-500/60'
                          : 'bg-zinc-950 border border-zinc-800'
                      }`}
                    >
                      {getStageIcon(stage.id, stage.status)}
                    </div>

                    {/* Stage Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-medium ${
                            isActive
                              ? 'text-indigo-300 font-semibold'
                              : isDone
                              ? 'text-zinc-200'
                              : isError
                              ? 'text-rose-300'
                              : 'text-zinc-500'
                          }`}
                        >
                          {stage.label}
                        </span>

                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            isDone
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : isActive
                              ? 'text-indigo-400 bg-indigo-500/10 animate-pulse'
                              : isError
                              ? 'text-rose-400 bg-rose-500/10'
                              : 'text-zinc-600'
                          }`}
                        >
                          {isDone ? 'Completed' : isActive ? 'In Progress' : isError ? 'Error' : 'Pending'}
                        </span>
                      </div>

                      <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                        {stage.description}
                      </p>

                      {/* If downloading stage is active, display live speed and ETA */}
                      {stage.id === 'downloading' && isActive && (job.speed || job.eta) && (
                        <div className="mt-1.5 text-[11px] text-indigo-400 font-mono flex items-center gap-3">
                          {job.speed && <span>Speed: {job.speed}</span>}
                          {job.eta && <span>ETA: ~{job.eta}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-950/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-zinc-500">
            {isProcessing && <span>Background worker is actively processing streams.</span>}
            {isCompleted && <span className="text-emerald-400">Video successfully imported & registered!</span>}
            {isFailed && <span className="text-rose-400">Video processing encountered an error.</span>}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {isProcessing && onOpenWorkspacePreview && job.title && (
              <button
                onClick={() => onOpenWorkspacePreview(job)}
                className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                title="View workspace details while download continues"
              >
                Workspace Details
              </button>
            )}

            {isProcessing && (
              <button
                onClick={onContinueInBackground}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5"
              >
                <span>Continue in Background</span>
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            )}

            {isCompleted && job.project && (
              <button
                onClick={() => onReady(job.project!)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
              >
                <span>Open in Video Editor</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {isFailed && (
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
