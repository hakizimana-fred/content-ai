'use client';

import React from 'react';
import { ScanFace, Loader2, MoveHorizontal, AlignHorizontalJustifyCenter, AlignHorizontalJustifyStart, AlignHorizontalJustifyEnd, Hand, Info } from 'lucide-react';
import { FramingMode, FramingSettings } from '@/lib/editor/framing';
import { PlatformSpec } from '@/lib/editor/platforms';
import { SectionTitle, Segmented, Slider } from './ui';

export interface TrackState { status: 'idle' | 'running' | 'done' | 'error'; message?: string; faces?: number; range?: { start: number; end: number } }

interface Props {
  framing: FramingSettings;
  onChange: (f: FramingSettings) => void;
  platform: PlatformSpec;
  sourceIsLandscape: boolean;
  track: TrackState;
  onRunTrack: () => void;
  trackRangeLabel: string;
}

const MODES: { id: FramingMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'auto', label: 'Auto Track', icon: <ScanFace className="w-4 h-4" />, hint: 'Follows the most active face' },
  { id: 'center', label: 'Centre', icon: <AlignHorizontalJustifyCenter className="w-4 h-4" />, hint: 'Middle of the frame' },
  { id: 'left', label: 'Left', icon: <AlignHorizontalJustifyStart className="w-4 h-4" />, hint: 'Keep the left side' },
  { id: 'right', label: 'Right', icon: <AlignHorizontalJustifyEnd className="w-4 h-4" />, hint: 'Keep the right side' },
  { id: 'manual', label: 'Manual', icon: <Hand className="w-4 h-4" />, hint: 'Drag the picture in the preview' },
];

export const CropPanel: React.FC<Props> = ({ framing, onChange, platform, sourceIsLandscape, track, onRunTrack, trackRangeLabel }) => {
  const set = (p: Partial<FramingSettings>) => onChange({ ...framing, ...p });
  const vertical = platform.orientation === 'vertical';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight">Crop &amp; framing</h2>
        <p className="text-xs text-zinc-400 mt-0.5">Decide what part of a landscape video fits the vertical screen.</p>
      </div>

      {!vertical && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] px-3 py-2.5 text-xs text-sky-100">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>You&apos;re previewing {platform.label} (16:9), so no cropping is needed. Switch the preview to TikTok, Reels or Shorts to adjust framing.</span>
        </div>
      )}
      {vertical && !sourceIsLandscape && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] px-3 py-2.5 text-xs text-sky-100">
          <Info className="w-4 h-4 shrink-0 mt-0.5" /> <span>This video is already vertical, so framing has no effect.</span>
        </div>
      )}

      <section>
        <SectionTitle>Layout</SectionTitle>
        <Segmented label="Layout" value={framing.layout} onChange={(v) => set({ layout: v })} options={[
          { value: 'fill', label: 'Fill (crop)', title: 'Fill the whole vertical screen, cropping the sides' },
          { value: 'fit', label: 'Fit (blur bars)', title: 'Show the whole picture over a blurred copy of itself' },
        ]} />
        <p className="text-xs text-zinc-500 mt-1.5">{framing.layout === 'fill' ? 'Avoids empty bars; some of the sides are cut off.' : 'Keeps everything visible; the picture is smaller.'}</p>
      </section>

      <section className={framing.layout === 'fit' ? 'opacity-40 pointer-events-none' : ''}>
        <SectionTitle hint={framing.layout === 'fit' ? 'Not used with Fit layout.' : undefined}>Framing</SectionTitle>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Framing mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={framing.mode === m.id}
              onClick={() => set({ mode: m.id })}
              title={m.hint}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-[11px] font-medium transition-all ${framing.mode === m.id ? 'bg-indigo-500/20 border-indigo-400/60 text-white' : 'bg-zinc-950/50 border-white/[0.07] text-zinc-400 hover:text-white hover:border-white/20'}`}
            >
              {m.icon}
              <span className="leading-none">{m.label}</span>
            </button>
          ))}
        </div>

        {framing.mode === 'auto' && (
          <div className="mt-3 rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3.5 text-xs flex flex-col gap-2.5">
            <div className="text-zinc-300">Finds faces, picks the one that is speaking, and pans smoothly to keep them in frame. Runs on your computer.</div>
            <button onClick={onRunTrack} disabled={track.status === 'running'} className="inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold disabled:opacity-60 transition-colors">
              {track.status === 'running' ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</> : <><ScanFace className="w-4 h-4" /> {track.status === 'done' ? 'Re-run tracking' : 'Track speakers'}</>}
            </button>
            <div className="text-zinc-500">Range: {trackRangeLabel}</div>
            {track.status === 'done' && <div className="text-emerald-300" role="status">Tracking ready{track.faces !== undefined ? ` · ${track.faces} ${track.faces === 1 ? 'person' : 'people'} found` : ''}. Check the preview.</div>}
            {track.status === 'error' && <div className="text-rose-300" role="alert">{track.message}</div>}
            {track.status === 'idle' && !framing.track && <div className="text-zinc-500">Until tracking runs, the picture stays centred.</div>}
          </div>
        )}

        {framing.mode === 'manual' && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400"><MoveHorizontal className="w-3.5 h-3.5" /> Drag the picture in the preview, or use the slider.</div>
            <Slider label="Horizontal position" value={Math.round(framing.manualX * 100)} min={0} max={100} onChange={(v) => set({ manualX: v / 100 })} format={(v) => `${v}%`} />
          </div>
        )}

        <div className="mt-3">
          <Slider label="Zoom" value={framing.zoom} min={1} max={2.5} step={0.05} onChange={(v) => set({ zoom: v })} format={(v) => `${v.toFixed(2)}×`} />
        </div>
      </section>
    </div>
  );
};
