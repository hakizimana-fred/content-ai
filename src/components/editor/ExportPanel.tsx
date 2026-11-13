'use client';

import React from 'react';
import { Download, Loader2, Smartphone, Monitor, Subtitles, Crop, Clock, AlertTriangle } from 'lucide-react';
import { PlatformSpec, PLATFORMS, PLATFORM_ORDER, PlatformId } from '@/lib/editor/platforms';
import { FramingSettings, LayoutMode } from '@/lib/editor/framing';
import { formatDuration } from '@/lib/timecode';

interface Props {
  platform: PlatformSpec;
  framing: FramingSettings;
  captionsEnabled: boolean;
  hasTranscript: boolean;
  rangeValid: boolean;
  rangeDuration: number;
  isExporting: boolean;
  progress: number;
  onExport: () => void;
  onPlatformChange: (p: PlatformId) => void;
  onLayoutChange: (l: LayoutMode) => void;
  customFontsAvailable: boolean;
}

const Item: React.FC<{ icon: React.ReactNode; k: string; v: string; warn?: boolean }> = ({ icon, k, v, warn }) => (
  <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.05] last:border-0 text-sm">
    <span className={warn ? 'text-amber-300' : 'text-indigo-300'}>{icon}</span>
    <span className="text-zinc-400">{k}</span>
    <span className={`ml-auto text-right font-medium ${warn ? 'text-amber-200' : 'text-zinc-100'}`}>{v}</span>
  </div>
);

export const ExportPanel: React.FC<Props> = ({ platform, framing, captionsEnabled, hasTranscript, rangeValid, rangeDuration, isExporting, progress, onExport, customFontsAvailable, onPlatformChange, onLayoutChange }) => {
  const vertical = platform.orientation === 'vertical';
  const burn = captionsEnabled && hasTranscript;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight">Export</h2>
        <p className="text-xs text-zinc-400 mt-0.5">Produces a finished file using everything you set up in the preview.</p>
      </div>

      <section>
        <div className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase mb-2">Preview &amp; export format</div>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Export format">
          {PLATFORM_ORDER.map((id) => {
            const p = PLATFORMS[id];
            const active = p.id === platform.id;
            return (
              <button key={id} role="radio" aria-checked={active} onClick={() => onPlatformChange(id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition-all ${active ? 'bg-indigo-500/15 border-indigo-400/60 text-white' : 'bg-zinc-950/50 border-white/[0.07] text-zinc-300 hover:border-white/20'}`}>
                <span className={`border border-white/30 rounded-sm bg-white/5 ${p.orientation === 'vertical' ? 'w-3.5 h-6' : 'w-7 h-4'}`} />
                {p.short}
              </button>
            );
          })}
        </div>
        {vertical && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-zinc-950/60 border border-white/[0.07] p-1" role="radiogroup" aria-label="Screen fit">
              {([['fill', 'Fill screen', 'Crops the sides to fill the whole screen'], ['fit', 'Fit with blur', 'Whole picture over a blurred background']] as const).map(([v, label, tip]) => (
                <button key={v} role="radio" aria-checked={framing.layout === v} title={tip} onClick={() => onLayoutChange(v)}
                  className={`py-2 rounded-lg text-xs font-medium transition-all ${framing.layout === v ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{framing.layout === 'fill' ? 'Crops the sides to fill the screen. Adjust the crop in the Crop step.' : 'Shows the whole picture, with a blurred copy behind it.'}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-1">
        <Item icon={vertical ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />} k="Format" v={`${platform.label} · ${platform.ratioLabel}`} />
        <Item icon={<Clock className="w-4 h-4" />} k="Segment" v={rangeValid ? formatDuration(rangeDuration) : 'Select one in Trim'} warn={!rangeValid} />
        <Item icon={<Crop className="w-4 h-4" />} k="Framing" v={!vertical ? 'Original' : framing.layout === 'fit' ? 'Fit with blur' : `Fill · ${framing.mode === 'auto' ? 'Auto Track' : framing.mode}${framing.zoom > 1 ? ` · ${framing.zoom.toFixed(2)}×` : ''}`} />
        <Item icon={<Subtitles className="w-4 h-4" />} k="Captions" v={burn ? 'Burned in' : captionsEnabled ? 'No transcript' : 'Off'} warn={captionsEnabled && !hasTranscript} />
      </section>

      {burn && !customFontsAvailable && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Exported captions use fonts installed on the server. For the exact fonts shown in the preview, add the .ttf files to <code className="font-mono">storage/fonts</code>.</span>
        </div>
      )}

      <button
        onClick={onExport}
        disabled={!rangeValid || isExporting}
        className="relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-white text-sm font-bold tracking-[0.08em] shadow-lg shadow-indigo-600/30 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed transition-all"
      >
        {isExporting && <span className="absolute inset-y-0 left-0 bg-white/15 transition-all" style={{ width: `${progress}%` }} />}
        <span className="relative flex items-center gap-2">
          {isExporting ? <><Loader2 className="w-4 h-4 animate-spin" /> EXPORTING… {Math.round(progress)}%</> : <><Download className="w-4 h-4" /> EXPORT FOR {platform.short.toUpperCase()}</>}
        </span>
      </button>
    </div>
  );
};
