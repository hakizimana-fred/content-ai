'use client';
// Soundtrack length control shared by the Sonic Studio composers: presets, a custom length, "match the video", and optional intro / outro padding.
// The engine composes a complete piece for whatever is chosen here (opening, development, build, climax, resolution), it never loops or stretches.
import React, { useState } from 'react';

export const DURATION_PRESETS = [15, 30, 45, 60, 90] as const;
export const MIN_SECONDS = 5;
export const PAD_CHOICES = [0, 2, 4, 8] as const;

export interface DurationValue { seconds: number; introPadSec: number; outroPadSec: number }

/** One line describing the shape of the piece the engine will write for this length. */
export function formHint(seconds: number): string {
  if (seconds < 12) return 'A short sting: one musical gesture with a clean ending, no long arc.';
  if (seconds < 24) return 'Opening, build, climax and resolution, compressed into a short, complete piece.';
  if (seconds < 50) return 'Opening, development, build-up, climax and a resolving ending.';
  if (seconds < 75) return 'Opening, development, a breakdown, build-up, climax and a resolving ending.';
  return 'Long form: two development passes, a breakdown, build-up, climax, a final variation and a resolving ending.';
}
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s}s`);

export const DurationPicker: React.FC<{ value: DurationValue; onChange: (v: DurationValue) => void; max: number; videoSeconds?: number; disabled?: boolean }> = ({ value, onChange, max, videoSeconds, disabled }) => {
  const clamp = (n: number) => Math.max(MIN_SECONDS, Math.min(max, Math.round(n)));
  const isPreset = (DURATION_PRESETS as readonly number[]).includes(value.seconds);
  const match = videoSeconds && videoSeconds >= MIN_SECONDS ? clamp(videoSeconds) : 0;
  const [custom, setCustom] = useState(!isPreset && value.seconds !== match);
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[11px] border transition-colors ${on ? 'bg-violet-500/30 border-violet-300/60 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/5'} disabled:opacity-50`;
  const set = (p: Partial<DurationValue>) => onChange({ ...value, ...p });
  return (
    <div data-testid="duration-picker">
      <div className="text-xs text-zinc-300 mb-1">Length</div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Soundtrack length">
        {DURATION_PRESETS.filter((d) => d <= max).map((d) => <button key={d} type="button" disabled={disabled} aria-pressed={!custom && value.seconds === d} data-testid={`duration-${d}`} onClick={() => { setCustom(false); set({ seconds: d }); }} className={chip(!custom && value.seconds === d)}>{d}s</button>)}
        {match > 0 && !(DURATION_PRESETS as readonly number[]).includes(match) && <button type="button" disabled={disabled} data-testid="duration-match" aria-pressed={!custom && value.seconds === match} onClick={() => { setCustom(false); set({ seconds: match }); }} className={chip(!custom && value.seconds === match)} title="Compose exactly as long as the open video">Match video ({fmt(match)})</button>}
        <button type="button" disabled={disabled} data-testid="duration-custom" aria-pressed={custom} onClick={() => setCustom(true)} className={chip(custom)}>Custom</button>
        {custom && <label className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="number" min={MIN_SECONDS} max={max} step={1} value={value.seconds} disabled={disabled} aria-label="Custom length in seconds" data-testid="duration-input"
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ seconds: Math.max(1, Math.min(max, Math.round(n))) }); }}
            onBlur={() => set({ seconds: clamp(value.seconds) })} className="w-16 rounded-lg bg-zinc-950/70 border border-white/10 px-2 py-1 text-zinc-100" />seconds (max {max})</label>}
      </div>
      <p className="text-[11px] text-zinc-500 mt-1.5" data-testid="duration-hint">{formHint(value.seconds)} It is composed for exactly {fmt(value.seconds)}, not looped or stretched.</p>
      {value.seconds >= 12 && <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-zinc-400">
        <label>Intro lead-in <select value={value.introPadSec} disabled={disabled} onChange={(e) => set({ introPadSec: Number(e.target.value) })} aria-label="Intro padding" className="ml-1 rounded-lg bg-zinc-950/70 border border-white/10 px-1.5 py-1 text-zinc-200">{PAD_CHOICES.map((p) => <option key={p} value={p}>{p ? `${p}s of atmosphere` : 'none'}</option>)}</select></label>
        <label>Outro wind-down <select value={value.outroPadSec} disabled={disabled} onChange={(e) => set({ outroPadSec: Number(e.target.value) })} aria-label="Outro padding" className="ml-1 rounded-lg bg-zinc-950/70 border border-white/10 px-1.5 py-1 text-zinc-200">{PAD_CHOICES.map((p) => <option key={p} value={p}>{p ? `${p}s of resolution` : 'none'}</option>)}</select></label>
        <span className="text-zinc-500">Padding is rounded to whole bars and keeps the beat on the bar lines.</span>
      </div>}
    </div>
  );
};
