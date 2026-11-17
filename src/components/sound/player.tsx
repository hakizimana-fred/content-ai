'use client';
// The ONE audio playback system for the app. A single <audio> element lives in the provider; every preview button and the
// persistent bottom bar read the same state, so only one soundtrack can play at a time and the UI always matches the element.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, Square, Volume2, VolumeX, X } from 'lucide-react';

export interface PlayerTrack { id: string; title: string; subtitle?: string; src: string; hue?: number; durationHint?: number }
interface PlayerState { track: PlayerTrack | null; playing: boolean; loading: boolean; current: number; duration: number; volume: number; muted: boolean; error: string | null }
interface PlayerApi extends PlayerState {
  play: (t: PlayerTrack) => void; toggle: (t: PlayerTrack) => void; pause: () => void; resume: () => void; stop: () => void; seek: (s: number) => void; setVolume: (v: number) => void; setMuted: (m: boolean) => void; close: () => void;
}
const Ctx = createContext<PlayerApi | null>(null);
export const usePlayer = (): PlayerApi => { const c = useContext(Ctx); if (!c) throw new Error('usePlayer needs <PlayerProvider>'); return c; };
export const fmtTime = (s: number) => { if (!Number.isFinite(s) || s < 0) return '0:00'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
/** Deterministic artwork colour from an id so a track keeps its identity everywhere. */
export const hueOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLAudioElement>(null);
  const [st, setSt] = useState<PlayerState>({ track: null, playing: false, loading: false, current: 0, duration: 0, volume: 0.8, muted: false, error: null });
  const patch = useCallback((p: Partial<PlayerState>) => setSt((s) => ({ ...s, ...p })), []);
  const trackRef = useRef<PlayerTrack | null>(null);

  useEffect(() => {
    const a = ref.current; if (!a) return;
    const on: [string, () => void][] = [
      ['play', () => patch({ playing: true, error: null })], ['playing', () => patch({ playing: true, loading: false })], ['pause', () => patch({ playing: false })],
      ['waiting', () => patch({ loading: true })], ['canplay', () => patch({ loading: false })],
      ['timeupdate', () => patch({ current: a.currentTime })], ['seeked', () => patch({ current: a.currentTime })],
      ['durationchange', () => patch({ duration: Number.isFinite(a.duration) ? a.duration : 0 })], ['loadedmetadata', () => patch({ duration: Number.isFinite(a.duration) ? a.duration : 0, loading: false })],
      ['ended', () => { a.currentTime = 0; patch({ playing: false, current: 0 }); }],
      ['volumechange', () => patch({ volume: a.volume, muted: a.muted })],
      ['error', () => { const c = a.error?.code; patch({ playing: false, loading: false, error: c === 4 ? 'This file is missing or is not playable.' : c === 2 ? 'The network dropped while loading this track.' : 'This track could not be played.' }); }],
    ];
    for (const [e, f] of on) a.addEventListener(e, f);
    a.volume = 0.8; return () => { for (const [e, f] of on) a.removeEventListener(e, f); };
  }, [patch]);

  const start = useCallback((t: PlayerTrack) => {
    const a = ref.current; if (!a) return;
    if (trackRef.current?.id !== t.id || a.error) { trackRef.current = t; a.pause(); a.src = t.src; a.load(); patch({ track: t, current: 0, duration: t.durationHint ?? 0, loading: true, error: null, playing: false }); }
    a.play().catch((e: Error) => { if (e.name !== 'AbortError') patch({ playing: false, loading: false, error: e.name === 'NotAllowedError' ? 'The browser blocked playback. Press play again.' : 'This track could not be played.' }); });
  }, [patch]);
  const pause = useCallback(() => { ref.current?.pause(); }, []);
  const resume = useCallback(() => { const a = ref.current; if (a && trackRef.current) a.play().catch(() => {}); }, []);
  const toggle = useCallback((t: PlayerTrack) => { const a = ref.current; if (a && trackRef.current?.id === t.id && !a.paused && !a.ended) a.pause(); else start(t); }, [start]);
  const stop = useCallback(() => { const a = ref.current; if (!a) return; a.pause(); a.currentTime = 0; patch({ current: 0, playing: false }); }, [patch]);
  const seek = useCallback((s: number) => { const a = ref.current; if (!a || !Number.isFinite(s)) return; a.currentTime = Math.max(0, Math.min(s, Number.isFinite(a.duration) ? a.duration : s)); patch({ current: a.currentTime }); }, [patch]);
  const setVolume = useCallback((v: number) => { const a = ref.current; if (a) { a.volume = Math.max(0, Math.min(1, v)); a.muted = false; } }, []);
  const setMuted = useCallback((m: boolean) => { const a = ref.current; if (a) a.muted = m; }, []);
  const close = useCallback(() => { const a = ref.current; if (!a) return; a.pause(); a.removeAttribute('src'); a.load(); trackRef.current = null; patch({ track: null, playing: false, current: 0, duration: 0, error: null, loading: false }); }, [patch]);

  const api = useMemo<PlayerApi>(() => ({ ...st, play: start, toggle, pause, resume, stop, seek, setVolume, setMuted, close }), [st, start, toggle, pause, resume, stop, seek, setVolume, setMuted, close]);
  return <Ctx.Provider value={api}><audio ref={ref} preload="metadata" className="hidden" data-testid="audio-element" />{children}{st.track && <div aria-hidden className="h-28 sm:h-20" />}<PlayerBar /></Ctx.Provider>;
};

/** Play/pause button for any track; shows the live state of the shared player. */
export const PlayButton: React.FC<{ track: PlayerTrack; size?: 'sm' | 'md' | 'lg'; className?: string }> = ({ track, size = 'md', className = '' }) => {
  const p = usePlayer(); const mine = p.track?.id === track.id; const playing = mine && p.playing; const loading = mine && p.loading && !p.playing;
  const dim = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  return <button type="button" onClick={() => p.toggle(track)} aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`} aria-pressed={playing} data-testid={`play-${track.id}`}
    className={`${dim} shrink-0 grid place-items-center rounded-full bg-white text-zinc-950 shadow-lg shadow-black/40 hover:scale-105 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${className}`}>
    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
  </button>;
};

export const Artwork: React.FC<{ id: string; label?: string; className?: string; playing?: boolean }> = ({ id, label, className = '', playing }) => {
  const h = hueOf(id), h2 = (h + 48) % 360;
  return <div aria-hidden className={`relative overflow-hidden rounded-xl ${className}`} style={{ background: `radial-gradient(120% 120% at 20% 10%, hsl(${h} 80% 62%) 0%, hsl(${h2} 70% 30%) 55%, hsl(${(h + 200) % 360} 60% 10%) 100%)` }}>
    <div className="absolute inset-0 opacity-40 mix-blend-overlay" style={{ backgroundImage: `repeating-linear-gradient(${h % 90}deg, transparent 0 9px, rgba(255,255,255,.35) 9px 10px)` }} />
    {playing && <div className="absolute bottom-1.5 left-1.5 flex items-end gap-[2px] h-4">{[0, 1, 2, 3].map((i) => <span key={i} className="w-[3px] bg-white/90 rounded-sm animate-pulse" style={{ height: `${40 + ((i * 37) % 60)}%`, animationDelay: `${i * 120}ms` }} />)}</div>}
    {label && <span className="absolute top-1.5 left-2 text-[10px] font-semibold tracking-widest uppercase text-white/85 drop-shadow">{label}</span>}
  </div>;
};

const PlayerBar: React.FC = () => {
  const p = usePlayer(); const t = p.track; if (!t) return null;
  const max = p.duration || t.durationHint || 0;
  return (
    <div role="region" aria-label="Audio player" data-testid="player-bar" className="fixed bottom-0 inset-x-0 z-50 px-3 pb-3 sm:px-5 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-5xl rounded-2xl border border-white/15 bg-zinc-950/70 backdrop-blur-2xl shadow-2xl shadow-black/60 px-3 py-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-3 min-w-0 sm:w-64">
          <Artwork id={t.id} className="w-11 h-11 shrink-0" playing={p.playing} />
          <div className="min-w-0"><div className="text-sm font-medium text-white truncate" data-testid="player-title">{t.title}</div><div className="text-[11px] text-zinc-400 truncate">{p.error ?? t.subtitle ?? ''}</div></div>
          <div className="ml-auto flex items-center gap-1.5 sm:hidden"><PlayButton track={t} size="sm" /><button type="button" onClick={p.stop} aria-label="Stop" className="w-8 h-8 grid place-items-center rounded-full border border-white/15 text-zinc-200"><Square className="w-3.5 h-3.5 fill-current" /></button></div>
        </div>
        <div className="hidden sm:flex items-center gap-2"><PlayButton track={t} /><button type="button" onClick={p.stop} aria-label="Stop" data-testid="player-stop" className="w-9 h-9 grid place-items-center rounded-full border border-white/15 text-zinc-200 hover:bg-white/10"><Square className="w-3.5 h-3.5 fill-current" /></button></div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[11px] tabular-nums text-zinc-400 w-9 text-right" data-testid="player-current">{fmtTime(p.current)}</span>
          <input type="range" min={0} max={max || 1} step={0.1} value={Math.min(p.current, max || 1)} disabled={!max || !!p.error} onChange={(e) => p.seek(Number(e.target.value))} aria-label="Seek" data-testid="player-seek" className="flex-1 accent-violet-400 h-1.5" />
          <span className="text-[11px] tabular-nums text-zinc-400 w-9" data-testid="player-duration">{fmtTime(max)}</span>
        </div>
        <div className="hidden md:flex items-center gap-2 w-36">
          <button type="button" onClick={() => p.setMuted(!p.muted)} aria-label={p.muted ? 'Unmute' : 'Mute'} className="text-zinc-300 hover:text-white">{p.muted || p.volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
          <input type="range" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Volume" data-testid="player-volume" className="flex-1 accent-violet-400 h-1.5" />
        </div>
        <button type="button" onClick={p.close} aria-label="Close player" className="hidden sm:grid w-8 h-8 place-items-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
};
