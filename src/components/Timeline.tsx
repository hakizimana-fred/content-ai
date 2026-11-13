'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, X, ZoomIn, ZoomOut, Sparkles, Maximize2, ArrowRightToLine, ArrowLeftToLine } from 'lucide-react';
import { formatDuration, formatTimecode } from '@/lib/timecode';
import { ClipSegment } from '@/types/video';
import { CandidateMoment, LoudnessSample } from '@/lib/intelligence/types';
import type { SelectionState } from '@/components/CutPanel';

interface TimelineProps {
  duration: number;
  currentTime: number;
  selection: SelectionState;
  clips: ClipSegment[];
  moments: CandidateMoment[];
  /** JPEG strip of evenly spaced frames; null while loading / unavailable. */
  filmstripUrl: string | null;
  isPreviewing: boolean;
  /** Loudness samples (0.25s) from the content analysis; drawn as the waveform when available. */
  waveform?: LoudnessSample[];
  captionSegments?: { start: number; end: number }[];
  /** Scene-change times in seconds. */
  scenes?: number[];
  onSeek: (time: number) => void;
  onStartChange: (time: number) => void;
  onEndChange: (time: number) => void;
  onRangeChange: (start: number, end: number) => void;
  onMarkStart: () => void;
  onMarkEnd: () => void;
  onClear: () => void;
  onReset: () => void;
  onPlaySelection: () => void;
  onPickMoment: (moment: CandidateMoment) => void;
}

const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const MIN_TICK_PX = 90;
const HANDLE_W = 20;
const MAX_ZOOM = 64;
const DRAG_THRESHOLD_PX = 4;

const ms = (t: number) => Math.round(t * 1000) / 1000;
const tickLabel = (t: number, step: number, duration: number) => {
  const full = formatTimecode(t, step < 1);
  return duration < 3600 ? full.slice(3) : full;
};

export const Timeline: React.FC<TimelineProps> = (props) => {
  const { duration, currentTime, selection, clips, moments, filmstripUrl, isPreviewing, waveform, captionSegments, scenes } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackWrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });

  const [zoomExp, setZoomExp] = useState(0); // 0..1, zoom = MAX_ZOOM ** zoomExp (log scale feels linear)
  const zoom = Math.max(1, MAX_ZOOM ** zoomExp);
  const [viewW, setViewW] = useState(800);
  const [dragging, setDragging] = useState<'start' | 'end' | 'create' | 'scrub' | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const lanesRef = useRef<HTMLCanvasElement>(null);
  const [loadedFilm, setLoadedFilm] = useState<string | null>(null);
  const filmReady = !!filmstripUrl && loadedFilm === filmstripUrl;

  useEffect(() => {
    if (!filmstripUrl) return;
    const img = new Image();
    img.onload = () => setLoadedFilm(filmstripUrl);
    img.src = filmstripUrl;
  }, [filmstripUrl]);

  // Track viewport width (for tick density and zoom maths)
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  // Zoom around the centre of the viewport so what you're looking at stays put.
  const anchorRef = useRef<{ t: number } | null>(null);
  const setZoom = (next: number) => {
    const el = scrollRef.current;
    if (el && duration > 0) {
      const inner = viewW * zoom;
      anchorRef.current = { t: ((el.scrollLeft + el.clientWidth / 2) / inner) * duration };
    }
    setZoomExp(Math.min(1, Math.max(0, next)));
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !anchorRef.current || duration <= 0) return;
    el.scrollLeft = (anchorRef.current.t / duration) * viewW * zoom - el.clientWidth / 2;
    anchorRef.current = null;
  }, [zoom, viewW, duration]);

  // Keep the playhead in view while zoomed.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || zoom <= 1.01 || duration <= 0 || dragging) return;
    const x = (currentTime / duration) * viewW * zoom;
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = x - el.clientWidth * 0.25;
  }, [currentTime, zoom, viewW, duration, dragging]);

  // Data lanes (waveform · caption segments · scene cuts): drawn only for the visible window.
  const hasLanes = !!(waveform?.length || captionSegments?.length || scenes?.length);
  useEffect(() => {
    const c = lanesRef.current;
    if (!c || !hasLanes || duration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.floor(viewW)), H = 36;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const pxPerSec = (viewW * zoom) / duration;
    const t0 = scrollX / pxPerSec;
    const xOf = (t: number) => t * pxPerSec - scrollX;

    if (waveform?.length) {
      const step = 0.25;
      ctx.fillStyle = 'rgba(129,140,248,0.75)';
      for (let x = 0; x < W; x += 2) {
        const a = Math.max(0, Math.floor((t0 + x / pxPerSec) / step));
        const b = Math.max(a + 1, Math.floor((t0 + (x + 2) / pxPerSec) / step) + 1);
        let peak = -80;
        for (let i = a; i < b && i < waveform.length; i++) peak = Math.max(peak, waveform[i].momentaryLufs);
        const amp = Math.min(1, Math.max(0.04, (peak + 48) / 38));
        const h = amp * 24;
        ctx.fillRect(x, 13 - h / 2, 1.4, h);
      }
    }
    if (captionSegments?.length) {
      ctx.fillStyle = 'rgba(56,189,248,0.8)';
      for (const seg of captionSegments) {
        const x0 = xOf(seg.start), x1 = xOf(seg.end);
        if (x1 < 0 || x0 > W) continue;
        ctx.fillRect(Math.max(0, x0), 28, Math.max(1.5, Math.min(W, x1) - Math.max(0, x0) - 1), 6);
      }
    }
    if (scenes?.length) {
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      for (const t of scenes) {
        const x = xOf(t);
        if (x >= 0 && x <= W) ctx.fillRect(x, 0, 1.5, H);
      }
    }
  }, [hasLanes, waveform, captionSegments, scenes, scrollX, viewW, zoom, duration]);

  const timeFromX = useCallback((clientX: number) => {
    const r = trackWrapRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return ms(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * propsRef.current.duration);
  }, []);

  /** Generic pointer-drag session; handlers are read from propsRef so they never go stale mid-drag. */
  const beginDrag = (kind: 'start' | 'end' | 'create' | 'scrub', e: React.PointerEvent, anchorTime = 0) => {
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    setDragging(kind === 'create' ? null : kind);

    const onMove = (ev: PointerEvent) => {
      const p = propsRef.current;
      const t = timeFromX(ev.clientX);
      if (kind === 'scrub') p.onSeek(t);
      else if (kind === 'start') {
        const end = p.selection.end;
        p.onStartChange(end !== null && p.selection.start !== null && p.selection.start < end ? Math.min(t, ms(end - 0.05)) : t);
      } else if (kind === 'end') {
        const start = p.selection.start;
        p.onEndChange(start !== null && p.selection.end !== null && start < p.selection.end ? Math.max(t, ms(start + 0.05)) : t);
      } else if (kind === 'create') {
        if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
        if (!moved) setDragging('create');
        moved = true;
        const a = Math.min(anchorTime, t);
        const b = Math.max(anchorTime, t);
        if (b - a > 0) p.onRangeChange(a, b);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (kind === 'create' && !moved) propsRef.current.onSeek(anchorTime); // plain click = jump there
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    if (kind === 'scrub') onMove(e.nativeEvent);
  };

  const nudge = (which: 'start' | 'end', e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const size = e.shiftKey ? 1 : 0.1;
    const cur = which === 'start' ? selection.start : selection.end;
    if (cur === null) return;
    const next = ms(Math.min(duration, Math.max(0, cur + dir * size)));
    (which === 'start' ? props.onStartChange : props.onEndChange)(next);
  };

  // ---- derived layout ----
  const innerW = viewW * zoom;
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const { start, end } = selection;
  const hasRegion = start !== null && end !== null && start < end;
  const tickStep = useMemo(() => {
    if (duration <= 0) return 60;
    return TICK_STEPS.find((s) => (s / duration) * innerW >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  }, [duration, innerW]);
  const ticks = useMemo(() => {
    const out: number[] = [];
    if (duration <= 0) return out;
    for (let t = 0; t <= duration + 1e-6; t = ms(t + tickStep)) out.push(t);
    return out;
  }, [duration, tickStep]);

  const handleTag = (t: number) => (
    <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-zinc-950/95 border border-white/15 font-mono text-[11px] text-white whitespace-nowrap shadow-lg pointer-events-none tabular-nums">
      {formatTimecode(t)}
    </span>
  );

  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors';

  return (
    <div className="glass rounded-2xl p-3 sm:p-4 flex flex-col gap-3 select-none">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={props.onMarkStart} className={`${btn} text-emerald-300 hover:bg-emerald-400/10`} title="Set the start at the playhead [I]">
            <ArrowRightToLine className="w-3.5 h-3.5" /> Set start <kbd className="px-1 rounded bg-white/5 font-mono text-[10px] text-zinc-400">I</kbd>
          </button>
          <button onClick={props.onMarkEnd} className={`${btn} text-amber-300 hover:bg-amber-400/10`} title="Set the end at the playhead [O]">
            <ArrowLeftToLine className="w-3.5 h-3.5" /> Set end <kbd className="px-1 rounded bg-white/5 font-mono text-[10px] text-zinc-400">O</kbd>
          </button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={props.onClear} className={`${btn} text-zinc-400 hover:text-white hover:bg-white/5`} title="Remove the selection [X]">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
          <button onClick={props.onReset} className={`${btn} text-zinc-400 hover:text-white hover:bg-white/5`} title="Select the whole video [R]">
            <Maximize2 className="w-3.5 h-3.5" /> Whole video
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {hasRegion ? (
            <div className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-violet-500/15 border border-violet-400/30 text-xs">
              <span className="font-mono text-violet-100 tabular-nums">
                {formatTimecode(start!)} <span className="text-violet-300/60">→</span> {formatTimecode(end!)}
              </span>
              <span className="font-semibold text-white bg-violet-500/40 rounded-full px-2 py-0.5 tabular-nums">{formatDuration(end! - start!)}</span>
              <button onClick={props.onPlaySelection} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-zinc-950 font-semibold hover:bg-zinc-200 transition-colors" title="Play only the selection [P]">
                {isPreviewing ? <RotateCcw className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />} {isPreviewing ? 'Replay' : 'Play'}
              </button>
            </div>
          ) : (
            <span className="text-xs text-zinc-500">
              {start !== null || end !== null ? 'Set both a start and an end to select a segment' : 'Drag on the strip below to select a segment'}
            </span>
          )}

          <div className="hidden md:flex items-center gap-1.5 text-zinc-400">
            <button onClick={() => setZoom(zoomExp - 0.15)} className="p-1 rounded hover:text-white hover:bg-white/5" aria-label="Zoom out" title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range" min={0} max={1} step={0.01} value={zoomExp}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-24 h-1 accent-indigo-400 cursor-pointer" aria-label="Timeline zoom"
            />
            <button onClick={() => setZoom(zoomExp + 0.15)} className="p-1 rounded hover:text-white hover:bg-white/5" aria-label="Zoom in" title="Zoom in for frame-level precision">
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="font-mono text-[11px] w-9 text-right tabular-nums">×{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}</span>
          </div>
        </div>
      </div>

      {/* Scrollable track (zoom widens the inner element) */}
      <div ref={scrollRef} onScroll={(e) => setScrollX((e.target as HTMLDivElement).scrollLeft)} className="overflow-x-auto overflow-y-hidden pt-9 pb-1">
        <div ref={trackWrapRef} className="relative" style={{ width: `${zoom * 100}%` }}>
          {/* Ruler: drag to scrub the playhead */}
          <div
            className="relative h-6 cursor-col-resize touch-none"
            onPointerDown={(e) => beginDrag('scrub', e)}
            title="Drag to move the playhead"
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 bottom-0 flex flex-col items-start pointer-events-none" style={{ left: `${pct(t)}%` }}>
                <span className="w-px h-2 bg-white/25" />
                <span className="ml-1 -mt-0.5 font-mono text-[10px] text-zinc-500 whitespace-nowrap tabular-nums">{tickLabel(t, tickStep, duration)}</span>
              </div>
            ))}
          </div>

          {/* Filmstrip track: drag to select, click to jump */}
          <div
            className="relative h-14 rounded-xl cursor-crosshair touch-none ring-1 ring-white/10"
            onPointerDown={(e) => beginDrag('create', e, timeFromX(e.clientX))}
            onPointerMove={(e) => setHoverTime(timeFromX(e.clientX))}
            onPointerLeave={() => setHoverTime(null)}
          >
            <div
              className="absolute inset-0 rounded-xl overflow-hidden bg-zinc-900"
              style={filmReady && filmstripUrl ? { backgroundImage: `url(${filmstripUrl})`, backgroundSize: '100% 100%' } : undefined}
            >
              {!filmReady && <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.03)_0,rgba(255,255,255,0.03)_2px,transparent_2px,transparent_28px)]" />}

              {/* Dim everything outside the selection so the kept part is obvious */}
              {hasRegion && (
                <>
                  <div className="absolute inset-y-0 left-0 bg-zinc-950/70 pointer-events-none" style={{ width: `${pct(start!)}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-zinc-950/70 pointer-events-none" style={{ width: `${100 - pct(end!)}%` }} />
                </>
              )}

              {/* Clips already in the queue */}
              {clips.map((c) => (
                <div key={c.id} title={c.name} className="absolute bottom-0 h-1 bg-emerald-400/80 pointer-events-none" style={{ left: `${pct(c.startTime)}%`, width: `${Math.max(0.2, pct(c.endTime - c.startTime))}%` }} />
              ))}
            </div>

            {/* Selected region frame */}
            {hasRegion && (
              <div
                className={`absolute inset-y-0 border-y-[3px] border-violet-400 bg-violet-400/10 pointer-events-none flex items-center justify-center transition-shadow ${dragging ? 'shadow-[0_0_0_1px_rgba(167,139,250,0.5),0_0_24px_rgba(139,92,246,0.45)]' : ''}`}
                style={{ left: `${pct(start!)}%`, width: `${pct(end! - start!)}%` }}
              >
                <span className="px-2 py-0.5 rounded-md bg-zinc-950/70 font-mono text-xs font-semibold text-white tabular-nums overflow-hidden">{formatDuration(end! - start!)}</span>
              </div>
            )}

            {/* Lone markers while the selection is incomplete or invalid (start >= end) */}
            {!hasRegion && start !== null && <div className="absolute inset-y-0 w-0.5 bg-emerald-400 pointer-events-none" style={{ left: `${pct(start)}%` }} />}
            {!hasRegion && end !== null && <div className="absolute inset-y-0 w-0.5 bg-amber-400 pointer-events-none" style={{ left: `${pct(end)}%` }} />}

            {/* Handles */}
            {start !== null && (
              <div
                role="slider" tabIndex={0} aria-label="Start time" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={start} aria-valuetext={formatTimecode(start)}
                onPointerDown={(e) => { e.stopPropagation(); beginDrag('start', e); }}
                onKeyDown={(e) => nudge('start', e)}
                className="group absolute -top-1.5 -bottom-1.5 cursor-ew-resize touch-none z-20 outline-none"
                style={{ left: `calc(${pct(start)}% - ${hasRegion ? HANDLE_W : HANDLE_W / 2}px)`, width: HANDLE_W }}
                title="Drag to move the start (←/→ to nudge, Shift for 1s)"
              >
                <div className={`h-full rounded-l-lg bg-emerald-400 group-hover:bg-emerald-300 group-focus-visible:ring-2 ring-white flex items-center justify-center shadow-lg shadow-black/40 transition-all ${dragging === 'start' ? 'scale-x-110 bg-emerald-300' : ''}`}>
                  <div className="flex gap-0.5"><span className="w-0.5 h-5 rounded bg-zinc-950/60" /><span className="w-0.5 h-5 rounded bg-zinc-950/60" /></div>
                </div>
                <div className={`opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${dragging === 'start' ? '!opacity-100' : ''} transition-opacity`}>{handleTag(start)}</div>
              </div>
            )}
            {end !== null && (
              <div
                role="slider" tabIndex={0} aria-label="End time" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={end} aria-valuetext={formatTimecode(end)}
                onPointerDown={(e) => { e.stopPropagation(); beginDrag('end', e); }}
                onKeyDown={(e) => nudge('end', e)}
                className="group absolute -top-1.5 -bottom-1.5 cursor-ew-resize touch-none z-20 outline-none"
                style={{ left: `calc(${pct(end)}% - ${hasRegion ? 0 : HANDLE_W / 2}px)`, width: HANDLE_W }}
                title="Drag to move the end (←/→ to nudge, Shift for 1s)"
              >
                <div className={`h-full rounded-r-lg bg-amber-400 group-hover:bg-amber-300 group-focus-visible:ring-2 ring-white flex items-center justify-center shadow-lg shadow-black/40 transition-all ${dragging === 'end' ? 'scale-x-110 bg-amber-300' : ''}`}>
                  <div className="flex gap-0.5"><span className="w-0.5 h-5 rounded bg-zinc-950/60" /><span className="w-0.5 h-5 rounded bg-zinc-950/60" /></div>
                </div>
                <div className={`opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${dragging === 'end' ? '!opacity-100' : ''} transition-opacity`}>{handleTag(end)}</div>
              </div>
            )}

            {/* Hover time readout */}
            {hoverTime !== null && !dragging && (
              <div className="absolute inset-y-0 w-px bg-white/30 pointer-events-none" style={{ left: `${pct(hoverTime)}%` }}>
                <span className="absolute top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-950/90 font-mono text-[10px] text-zinc-300 whitespace-nowrap tabular-nums">{formatTimecode(hoverTime)}</span>
              </div>
            )}
          </div>

          {/* Lanes: audio waveform (indigo), caption segments (blue), scene cuts (amber) */}
          {hasLanes && (
            <div className="relative h-9 mt-1.5 rounded-lg bg-zinc-950/40" title="Waveform · captions · scene cuts">
              <canvas ref={lanesRef} style={{ position: 'sticky', left: 0, width: Math.floor(viewW), height: 36, display: 'block' }} aria-label="Audio waveform, caption segments and scene boundaries" />
            </div>
          )}

          {/* AI moments (click to use as the selection) */}
          {moments.length > 0 && (
            <div className="relative h-7 mt-2">
              {moments.map((m) => (
                <button
                  key={m.id}
                  onClick={() => props.onPickMoment(m)}
                  className="absolute top-0 bottom-0 flex items-center gap-1 px-2 rounded-lg bg-gradient-to-r from-violet-600/80 to-indigo-600/80 hover:from-violet-500 hover:to-indigo-500 border border-violet-300/25 text-[11px] font-medium text-white overflow-hidden whitespace-nowrap transition-colors"
                  style={{ left: `${pct(m.startTime)}%`, width: `${Math.max(1.2, pct(m.endTime - m.startTime))}%` }}
                  title={`AI moment, score ${m.score}. Click to select it.\n${m.explanation}`}
                >
                  <Sparkles className="w-3 h-3 shrink-0 text-violet-200" /> {m.score}
                </button>
              ))}
            </div>
          )}

          {/* Playhead */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-sky-400 pointer-events-none z-30 shadow-[0_0_8px_rgba(56,189,248,0.9)]" style={{ left: `${pct(currentTime)}%` }}>
            <div className="absolute -top-0.5 -left-[5px] w-3 h-3 rounded-full bg-sky-400 ring-2 ring-zinc-950" />
          </div>
        </div>
      </div>
    </div>
  );
};
