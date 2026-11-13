'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, StepBack, StepForward,
  RotateCcw, Undo2, X, ShieldAlert,
} from 'lucide-react';
import { formatTimecode } from '@/lib/timecode';
import { PLATFORMS, PLATFORM_ORDER, PlatformId, PlatformSpec } from '@/lib/editor/platforms';
import { FramingSettings, framingCenter, windowFraction } from '@/lib/editor/framing';
import { CaptionStyle, TimedWord } from '@/lib/editor/captions';
import { CaptionOverlay } from '@/components/editor/CaptionOverlay';
import { SafeAreaGuides } from '@/components/editor/SafeAreaGuides';

/** A temporary "play only this range" session. `returnTo` is where the playhead was before it began. */
export interface PreviewState {
  start: number;
  end: number;
  returnTo: number;
  nonce: number;
  ended: boolean;
}

interface VideoPlayerProps {
  streamUrl: string;
  duration: number;
  fps?: number;
  sourceWidth: number;
  sourceHeight: number;
  currentTime: number;
  /** Imperative seek channel: a new nonce means "jump to exactly this time". */
  seekRequest: { time: number; nonce: number } | null;
  preview: PreviewState | null;
  platform: PlatformId;
  onPlatformChange: (p: PlatformId) => void;
  framing: FramingSettings;
  onManualX?: (x: number) => void;
  captions: { enabled: boolean; style: CaptionStyle; words: TimedWord[] };
  showSafeAreas: boolean;
  onToggleSafeAreas: () => void;
  onTimeUpdate: (time: number) => void;
  /** Scrubbing the preview's own slider. The app moves the timeline playhead to follow. */
  onSeek: (time: number) => void;
  onPreviewEnded: () => void;
  onReplayPreview: () => void;
  /** restore=true puts the playhead back where it was before the preview started. */
  onExitPreview: (restore: boolean) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  streamUrl, duration, fps = 30, sourceWidth, sourceHeight, currentTime, seekRequest, preview, platform: platformId,
  onPlatformChange, framing, onManualX, captions, showSafeAreas, onToggleSafeAreas, onTimeUpdate, onSeek,
  onPreviewEnded, onReplayPreview, onExitPreview,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blurRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const platform: PlatformSpec = PLATFORMS[platformId];
  const vertical = platform.orientation === 'vertical';
  const srcAspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Preview playback respects the preview range: Start/End jump to ITS boundaries.
  const lo = preview ? preview.start : 0;
  const hi = preview ? preview.end : duration;

  const getTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  // ---- seeking (parent-driven, exact) ----
  useEffect(() => {
    if (seekRequest && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, seekRequest.time));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  // ---- preview session: stop on the exact end timestamp (per-frame check; timeupdate is only ~4Hz) ----
  const armedRef = useRef(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!preview || preview.ended || !v) return;
    armedRef.current = false;
    v.currentTime = preview.start;
    v.play().catch(() => {});
    let raf = 0;
    const tick = () => {
      if (!armedRef.current && Math.abs(v.currentTime - preview.start) < 0.3) armedRef.current = true;
      if (armedRef.current) {
        onTimeUpdate(v.currentTime);
        if (v.currentTime >= preview.end - 0.01) {
          v.pause();
          v.currentTime = preview.end;
          onTimeUpdate(preview.end);
          onPreviewEnded();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.nonce, preview?.ended]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Never "play" from the very end: restart from the beginning of the active range instead.
      if (v.currentTime >= hi - 0.05) v.currentTime = lo;
      v.play().catch(() => {});
    } else v.pause();
  }, [lo, hi]);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    const time = Math.max(0, Math.min(duration, t));
    if (v) v.currentTime = time;
    onSeek(time);
  }, [duration, onSeek]);

  const stepFrame = useCallback((dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seekTo(v.currentTime + dir / fps);
  }, [fps, seekTo]);

  const jumpSeconds = useCallback((s: number) => seekTo((videoRef.current?.currentTime ?? 0) + s), [seekTo]);

  const toggleMute = () => {
    if (!videoRef.current) return;
    const m = !isMuted;
    setIsMuted(m);
    videoRef.current.muted = m;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    else document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const act = (fn: () => void) => { e.preventDefault(); fn(); };
      switch (e.code) {
        case 'Space': return act(togglePlay);
        case 'Home': return act(() => seekTo(lo));
        case 'End': return act(() => seekTo(hi));
        case 'Comma': return act(() => stepFrame(-1));
        case 'Period': return act(() => stepFrame(1));
        case 'ArrowLeft': return act(() => (e.shiftKey ? stepFrame(-1) : jumpSeconds(-1)));
        case 'ArrowRight': return act(() => (e.shiftKey ? stepFrame(1) : jumpSeconds(1)));
        case 'KeyJ': return act(() => jumpSeconds(-5));
        case 'KeyL': return act(() => jumpSeconds(5));
        case 'KeyM': return act(toggleMute);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, seekTo, stepFrame, jumpSeconds, lo, hi, isMuted]);

  // ---- framing geometry (CSS only: same single <video>, no copies) ----
  const fill = framing.layout === 'fill';
  const zoom = Math.max(1, framing.zoom);
  const windowFrac = windowFraction(sourceWidth || 1920, sourceHeight || 1080, zoom);
  const useCrop = vertical && fill && srcAspect > platform.aspect + 0.01;
  const videoWpct = (zoom * srcAspect) / platform.aspect * 100;
  const leftFor = (t: number) => 50 - framingCenter(framing, t, windowFrac) * videoWpct;
  const cropStyle: React.CSSProperties | undefined = useCrop
    ? { position: 'absolute', width: `${videoWpct}%`, height: `${zoom * 100}%`, top: `${(100 - zoom * 100) / 2}%`, left: `${leftFor(currentTime)}%`, maxWidth: 'none' }
    : undefined;

  // Auto Track moves smoothly while playing: update `left` straight on the element each frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!useCrop || !v || framing.mode !== 'auto' || !isPlaying) return;
    let raf = 0;
    const tick = () => { v.style.left = `${leftFor(v.currentTime)}%`; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCrop, framing, isPlaying, videoWpct]);

  // Manual mode: drag the picture sideways inside the phone.
  const onDragFrame = (e: React.PointerEvent) => {
    if (!useCrop || framing.mode !== 'manual' || !onManualX || !screenRef.current) return;
    e.preventDefault();
    const rect = screenRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startC = framing.manualX;
    const move = (ev: PointerEvent) => {
      const dxFrac = (ev.clientX - startX) / (rect.width * (videoWpct / 100));
      onManualX(Math.min(1 - windowFrac / 2, Math.max(windowFrac / 2, startC - dxFrac)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Blurred backdrop for "Fit" layout: a tiny canvas fed from the same video (no second decode).
  const blurNeeded = vertical && !fill;
  useEffect(() => {
    const v = videoRef.current, c = blurRef.current;
    if (!blurNeeded || !v || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      if (v.videoWidth) {
        const cw = c.width, ch = c.height, s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
        ctx.drawImage(v, (cw - v.videoWidth * s) / 2, (ch - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
      }
    };
    draw();
    let raf = 0, last = 0;
    const tick = (now: number) => { if (now - last > 66) { draw(); last = now; } raf = requestAnimationFrame(tick); };
    if (isPlaying) raf = requestAnimationFrame(tick);
    v.addEventListener('seeked', draw);
    v.addEventListener('loadeddata', draw);
    return () => { cancelAnimationFrame(raf); v.removeEventListener('seeked', draw); v.removeEventListener('loadeddata', draw); };
  }, [blurNeeded, isPlaying, streamUrl]);

  const iconBtn = 'w-10 h-10 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400';

  // Phone frame: height-driven so the preview stays large but fits the viewport.
  const stageStyle: React.CSSProperties = vertical
    ? { height: 'clamp(300px, calc(100vh - 640px), 760px)', aspectRatio: '9 / 16' }
    : { width: '100%', aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 640px)' };

  const screen = (
    <div
      ref={screenRef}
      className={`relative overflow-hidden bg-black ${vertical ? 'rounded-[1.6rem]' : 'rounded-xl'}`}
      style={{ ...stageStyle, containerType: 'inline-size' }}
      onPointerDown={onDragFrame}
    >
      {blurNeeded && <canvas ref={blurRef} width={54} height={96} className="absolute inset-0 w-full h-full scale-125 blur-md opacity-80" />}
      <video
        ref={videoRef}
        src={streamUrl}
        playsInline
        style={cropStyle}
        className={useCrop ? `select-none ${framing.mode === 'manual' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}` : 'absolute inset-0 w-full h-full object-contain cursor-pointer'}
        onClick={() => framing.mode !== 'manual' && togglePlay()}
        onTimeUpdate={() => videoRef.current && onTimeUpdate(videoRef.current.currentTime)}
        onSeeked={() => { armedRef.current = true; }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); videoRef.current?.pause(); }}
      />
      {captions.enabled && (
        <CaptionOverlay style={captions.style} platform={platform} words={captions.words} currentTime={currentTime} isPlaying={isPlaying} getTime={getTime} />
      )}
      {showSafeAreas && <SafeAreaGuides platform={platform} compact={!vertical} />}
      {vertical && <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-16 h-4 rounded-full bg-black/90 z-30" aria-hidden />}
    </div>
  );

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3 select-none">
      {/* Platform selector */}
      <div className="flex flex-wrap items-center justify-center gap-2 w-full">
        <div role="tablist" aria-label="Preview platform" className="flex items-center glass rounded-full p-1 text-xs">
          {PLATFORM_ORDER.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={platformId === id}
              onClick={() => onPlatformChange(id)}
              title={`${PLATFORMS[id].label} · ${PLATFORMS[id].ratioLabel}`}
              className={`px-3 py-1.5 rounded-full font-medium transition-all ${platformId === id ? 'bg-white text-zinc-950 shadow' : 'text-zinc-400 hover:text-white'}`}
            >
              {PLATFORMS[id].short}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleSafeAreas}
          aria-pressed={showSafeAreas}
          title="Show where the platform's own buttons and text will cover your video"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-colors ${showSafeAreas ? 'bg-rose-500/20 border-rose-400/50 text-rose-100' : 'glass text-zinc-400 hover:text-white'}`}
        >
          <ShieldAlert className="w-3.5 h-3.5" /> Safe areas
        </button>
      </div>

      {/* Preview session status */}
      {preview && (
        <div className="flex flex-wrap items-center justify-center gap-2 glass rounded-full pl-3 pr-1.5 py-1 text-xs text-zinc-100 max-w-full">
          <span className="relative flex h-2 w-2 shrink-0">
            {!preview.ended && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${preview.ended ? 'bg-emerald-400' : 'bg-indigo-400'}`} />
          </span>
          <span className="font-medium">{preview.ended ? 'Preview finished' : 'Previewing selection'}</span>
          <span className="font-mono text-zinc-400 hidden sm:inline">{formatTimecode(preview.start)} → {formatTimecode(preview.end)}</span>
          <button onClick={onReplayPreview} className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 hover:bg-white/20" title="Play the selection again">
            <RotateCcw className="w-3 h-3" /> Replay
          </button>
          <button onClick={() => onExitPreview(true)} className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 hover:bg-white/20" title="Return to where you were [Esc]">
            <Undo2 className="w-3 h-3" /> Back to <span className="font-mono">{formatTimecode(preview.returnTo, false)}</span>
          </button>
          <button onClick={() => onExitPreview(false)} className="p-1 rounded-full hover:bg-white/20" title="Close preview and stay here" aria-label="Close preview">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stage */}
      {vertical ? (
        <div className="rounded-[2.1rem] p-[9px] bg-gradient-to-b from-zinc-700 to-zinc-900 shadow-2xl shadow-black/60 ring-1 ring-white/10">
          {screen}
        </div>
      ) : (
        <div className="w-full rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/60">{screen}</div>
      )}

      {/* Scrubber (follows and drives the timeline) */}
      <div className="w-full max-w-[min(100%,440px)] flex items-center gap-2 font-mono text-[11px] text-zinc-400 tabular-nums">
        <span>{formatTimecode(currentTime, false)}</span>
        <input
          type="range" min={0} max={duration || 1} step={0.01}
          value={Math.min(currentTime, duration)}
          onChange={(e) => seekTo(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-indigo-400 cursor-pointer" aria-label="Seek"
        />
        <span>{formatTimecode(duration, false)}</span>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button className={iconBtn} onClick={() => seekTo(lo)} title={preview ? 'Jump to start of preview (Home)' : 'Jump to beginning (Home)'} aria-label="Jump to beginning"><SkipBack className="w-5 h-5" /></button>
        <button className={iconBtn} onClick={() => stepFrame(-1)} title="Previous frame (, or Shift+←)" aria-label="Previous frame"><StepBack className="w-5 h-5" /></button>
        <button onClick={togglePlay} className="w-12 h-12 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 flex items-center justify-center shadow-lg transition-colors" title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>
        <button className={iconBtn} onClick={() => stepFrame(1)} title="Next frame (. or Shift+→)" aria-label="Next frame"><StepForward className="w-5 h-5" /></button>
        <button className={iconBtn} onClick={() => seekTo(hi)} title={preview ? 'Jump to end of preview (End)' : 'Jump to end (End)'} aria-label="Jump to end"><SkipForward className="w-5 h-5" /></button>
      </div>

      {/* Secondary controls */}
      <div className="flex items-center gap-3 text-zinc-400">
        <button onClick={toggleMute} className="p-1.5 rounded-lg hover:bg-white/5 hover:text-white" title={isMuted ? 'Unmute (M)' : 'Mute (M)'} aria-label={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume}
          onChange={(e) => { const n = parseFloat(e.target.value); setVolume(n); setIsMuted(n === 0); if (videoRef.current) { videoRef.current.volume = n; videoRef.current.muted = n === 0; } }}
          className="w-20 h-1 accent-indigo-400 cursor-pointer" aria-label="Volume" />
        <select value={playbackRate} onChange={(e) => { const r = parseFloat(e.target.value); setPlaybackRate(r); if (videoRef.current) videoRef.current.playbackRate = r; }}
          className="bg-zinc-900 border border-white/10 text-zinc-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer" aria-label="Playback speed">
          {[0.5, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
        </select>
        <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-white/5 hover:text-white" title="Fullscreen" aria-label="Toggle fullscreen">
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
