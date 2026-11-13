'use client';

import React, { useMemo, useState } from 'react';
import { Scissors, Play, RotateCcw, X, Loader2, CheckCircle2, AlertTriangle, ListPlus, Maximize2, ArrowRightToLine, ArrowLeftToLine } from 'lucide-react';
import { TimeField } from '@/components/TimeField';
import { formatDuration, validateSelection } from '@/lib/timecode';
import { ClipSegment } from '@/types/video';

export interface SelectionState {
  start: number | null;
  end: number | null;
}

interface CutPanelProps {
  duration: number;
  currentTime: number;
  selection: SelectionState;
  onStartChange: (t: number | null) => void;
  onEndChange: (t: number | null) => void;
  onMarkStart: () => void;
  onMarkEnd: () => void;
  onJump: (t: number) => void;
  onClear: () => void;
  onReset: () => void;
  onPreviewSelection: () => void;
  onPreviewEdge: (edge: 'start' | 'end') => void;
  onCut: () => void;
  onAddToQueue: () => void;
  /** The most recent clip generated from this panel (drives the status card). */
  latestClip: ClipSegment | null;
  onOpenClip: (clip: ClipSegment) => void;
  onRetryClip: (clipId: string) => void;
  isPreviewing: boolean;
}

export const CutPanel: React.FC<CutPanelProps> = ({
  duration, currentTime, selection, onStartChange, onEndChange, onMarkStart, onMarkEnd, onJump,
  onClear, onReset, onPreviewSelection, onPreviewEdge, onCut, onAddToQueue, latestClip, onOpenClip, onRetryClip, isPreviewing,
}) => {
  const [startSyntax, setStartSyntax] = useState<string | null>(null);
  const [endSyntax, setEndSyntax] = useState<string | null>(null);

  const v = useMemo(() => validateSelection(selection.start, selection.end, duration), [selection, duration]);
  // Only show "Set a start time" style prompts once the user has begun (avoid shouting at an empty panel).
  const untouched = selection.start === null && selection.end === null;
  const blocked = !v.ok || !!startSyntax || !!endSyntax;
  const isCutting = latestClip?.status === 'processing';

  const startErr = untouched ? undefined : v.startError;
  const endErr = untouched ? undefined : v.endError ?? v.rangeError;

  const cut = () => {
    if (blocked || isCutting) return;
    onCut();
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight">Cut by Timestamp</h2>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          Type exact times, or drag the handles on the timeline. Both always show the same selection.
        </p>
      </div>

      <div className="flex flex-col">
        <TimeField
          label="Start time"
          value={selection.start}
          duration={duration}
          onChange={onStartChange}
          onSyntaxError={setStartSyntax}
          error={startErr}
          playhead={currentTime}
          onUsePlayhead={onMarkStart}
          onJump={() => selection.start !== null && onJump(selection.start)}
          shortcut="I"
          accent="emerald"
          onSubmit={cut}
        />
        <TimeField
          label="End time"
          value={selection.end}
          duration={duration}
          onChange={onEndChange}
          onSyntaxError={setEndSyntax}
          error={endErr}
          playhead={currentTime}
          onUsePlayhead={onMarkEnd}
          onJump={() => selection.end !== null && onJump(selection.end)}
          shortcut="O"
          accent="amber"
          onSubmit={cut}
        />
      </div>

      {/* Duration readout */}
      <div className="flex items-end justify-between rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Selected duration</div>
          <div className={`font-mono text-3xl font-semibold tabular-nums mt-0.5 ${v.ok ? 'text-white' : 'text-zinc-600'}`} aria-live="polite">
            {v.ok ? formatDuration(v.duration) : '--:--'}
          </div>
        </div>
        {v.ok && v.warnings.length > 0 && (
          <div className="text-[11px] text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2 py-1 max-w-[55%] text-right leading-snug">
            {v.warnings.join(' · ')}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <button
            type="button"
            onClick={onPreviewSelection}
            disabled={!v.ok}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-zinc-100 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Play only the selected part. It stops at the end time. [P]"
          >
            {isPreviewing ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            {isPreviewing ? 'Replay selection' : 'Preview selection'}
          </button>
          <button
            type="button"
            onClick={() => onPreviewEdge('start')}
            disabled={!v.ok}
            className="px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Preview the first 3 seconds: check where the clip begins"
            aria-label="Preview from start"
          >
            <ArrowRightToLine className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onPreviewEdge('end')}
            disabled={!v.ok}
            className="px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Preview the last 3 seconds: check where the clip ends"
            aria-label="Preview from end"
          >
            <ArrowLeftToLine className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={cut}
          disabled={blocked || isCutting}
          className="relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-white text-sm font-bold tracking-[0.08em] shadow-lg shadow-indigo-600/30 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed transition-all"
          title="Generate the clip file [Ctrl+Enter]"
        >
          {isCutting && (
            <span className="absolute inset-y-0 left-0 bg-white/15 transition-all" style={{ width: `${latestClip?.progress ?? 0}%` }} />
          )}
          <span className="relative flex items-center gap-2">
            {isCutting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            {isCutting ? `CUTTING… ${Math.round(latestClip?.progress ?? 0)}%` : 'CUT VIDEO'}
          </span>
        </button>

        {blocked && !untouched && (
          <p className="text-xs text-zinc-400 text-center" role="status">
            {startSyntax || endSyntax || v.startError || v.endError || v.rangeError}
          </p>
        )}
      </div>

      {/* Real generation status: selecting is not the same as having a file */}
      {latestClip && (
        <div
          className={`rounded-2xl border p-3.5 text-xs ${
            latestClip.status === 'completed' ? 'bg-emerald-500/[0.07] border-emerald-500/25'
              : latestClip.status === 'error' ? 'bg-rose-500/[0.07] border-rose-500/25'
                : 'bg-indigo-500/[0.07] border-indigo-500/25'
          }`}
        >
          {latestClip.status === 'processing' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-indigo-200 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating {latestClip.name}…
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-all" style={{ width: `${latestClip.progress}%` }} />
              </div>
              <div className="text-zinc-400">Encoding for frame-accurate start and end. Not saved until it reaches 100%.</div>
            </div>
          )}
          {latestClip.status === 'completed' && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-200 min-w-0">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{latestClip.name} is ready</div>
                  <div className="text-zinc-400 font-mono">
                    {formatDuration(latestClip.outputDuration ?? latestClip.endTime - latestClip.startTime)}
                    {latestClip.outputSize ? ` · ${(latestClip.outputSize / 1048576).toFixed(1)} MB` : ''}
                  </div>
                </div>
              </div>
              <button onClick={() => onOpenClip(latestClip)} className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 font-medium transition-colors">
                Open
              </button>
            </div>
          )}
          {latestClip.status === 'error' && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-rose-200 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">Cutting failed</div>
                  <div className="text-rose-300/80 break-words">{latestClip.error}</div>
                </div>
              </div>
              <button onClick={() => onRetryClip(latestClip.id)} className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 font-medium transition-colors">
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* Secondary quick controls */}
      <div className="flex items-center justify-between text-xs text-zinc-400 pt-1 border-t border-white/[0.06]">
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition-colors" title="Remove the selection [X]">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
          <button onClick={onReset} className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 hover:text-white transition-colors" title="Select the whole video [R]">
            <Maximize2 className="w-3.5 h-3.5" /> Whole video
          </button>
        </div>
        <button
          onClick={onAddToQueue}
          disabled={!v.ok}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Save to the Clips list without cutting yet [Enter]"
        >
          <ListPlus className="w-3.5 h-3.5" /> Add to queue
        </button>
      </div>
    </div>
  );
};
