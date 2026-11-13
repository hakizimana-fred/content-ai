'use client';

import React from 'react';
import { ShieldAlert, Smartphone, Monitor } from 'lucide-react';
import { PLATFORMS, PLATFORM_ORDER, PlatformId } from '@/lib/editor/platforms';
import { SectionTitle, Toggle } from './ui';

interface Props {
  platform: PlatformId;
  onPlatformChange: (p: PlatformId) => void;
  showSafeAreas: boolean;
  onToggleSafeAreas: (v: boolean) => void;
}

const BLURB: Record<PlatformId, string> = {
  tiktok: 'Vertical 9:16. Keep faces and captions clear of the side buttons and the description.',
  reels: 'Vertical 9:16. Reels covers the lower fifth with caption and audio info.',
  shorts: 'Vertical 9:16. Shorts overlays the channel and title at the bottom.',
  youtube: 'Landscape 16:9 for standard YouTube videos. Player controls cover the bottom edge.',
};

export const StylePanel: React.FC<Props> = ({ platform, onPlatformChange, showSafeAreas, onToggleSafeAreas }) => {
  const spec = PLATFORMS[platform];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight">Style</h2>
        <p className="text-xs text-zinc-400 mt-0.5">Choose where this video will be watched. The preview reshapes to match.</p>
      </div>

      <section>
        <SectionTitle>Platform</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORM_ORDER.map((id) => {
            const p = PLATFORMS[id];
            const active = id === platform;
            return (
              <button
                key={id}
                onClick={() => onPlatformChange(id)}
                aria-pressed={active}
                className={`text-left rounded-2xl border p-3 transition-all ${active ? 'bg-indigo-500/15 border-indigo-400/60' : 'bg-zinc-950/50 border-white/[0.07] hover:border-white/20'}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {p.orientation === 'vertical' ? <Smartphone className="w-4 h-4 text-indigo-300" /> : <Monitor className="w-4 h-4 text-indigo-300" />}
                  <span className="text-sm font-semibold text-white">{p.short}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-500">{p.ratioLabel}</span>
                </div>
                <div className={`mx-auto border border-white/20 rounded-sm bg-white/5 ${p.orientation === 'vertical' ? 'w-5 h-9' : 'w-10 h-6'}`} />
              </button>
            );
          })}
        </div>
        <p className="text-xs text-zinc-400 mt-2.5 leading-relaxed">{BLURB[platform]}</p>
      </section>

      <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-300" />
            <div>
              <div className="text-sm font-medium text-white">Safe-area guides</div>
              <div className="text-xs text-zinc-400">Shows what {spec.short} will cover.</div>
            </div>
          </div>
          <Toggle checked={showSafeAreas} onChange={onToggleSafeAreas} label="Show safe-area guides" />
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 text-xs text-zinc-300">
          {spec.zones.map((z) => (
            <li key={z.id} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500/50 border border-rose-400/70" />{z.label}</li>
          ))}
          <li className="flex items-center gap-2"><span className="w-2.5 border-t border-dashed border-emerald-400" />Safe band for captions</li>
        </ul>
        <p className="text-[11px] text-zinc-500 mt-2.5">Approximate. Apps change their layout, so leave a little extra margin.</p>
      </section>
    </div>
  );
};
