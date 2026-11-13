'use client';

import React from 'react';
import { PlatformSpec } from '@/lib/editor/platforms';

/** Hatched overlays showing where the platform's own UI will cover the video (approximate). */
export const SafeAreaGuides: React.FC<{ platform: PlatformSpec; compact?: boolean }> = ({ platform, compact }) => (
  <div className="absolute inset-0 pointer-events-none z-20" aria-hidden>
    {platform.zones.map((z) => (
      <div
        key={z.id}
        className="absolute border border-rose-400/60 bg-rose-500/15 flex items-center justify-center overflow-hidden"
        style={{
          left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(244,63,94,0.18) 0 6px, transparent 6px 12px)',
        }}
      >
        {!compact && (
          <span className="px-1.5 py-0.5 rounded bg-black/65 text-[9px] leading-tight text-rose-100 text-center max-w-[92%]">{z.label}</span>
        )}
      </div>
    ))}
    {/* Safe band for captions */}
    <div className="absolute left-0 right-0 border-t border-dashed border-emerald-400/70" style={{ top: `${platform.captionSafe.top}%` }} />
    <div className="absolute left-0 right-0 border-t border-dashed border-emerald-400/70" style={{ top: `${platform.captionSafe.bottom}%` }} />
  </div>
);
