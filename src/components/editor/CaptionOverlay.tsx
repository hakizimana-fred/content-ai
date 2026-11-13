'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { applyCase, buildLines, captionCenterY, cssFontFamily, lineAt, CaptionStyle, TimedWord } from '@/lib/editor/captions';
import { PlatformSpec } from '@/lib/editor/platforms';

interface Props {
  style: CaptionStyle;
  platform: PlatformSpec;
  words: TimedWord[];
  /** Coarse time from the app state; used while paused. */
  currentTime: number;
  isPlaying: boolean;
  /** Reads the exact playback time so word highlights are frame-smooth while playing. */
  getTime: () => number;
  /** Used when there is no transcript so styles can still be judged. */
  sampleText?: string;
}

const SAMPLE: TimedWord[] = 'This is how your captions will look'.split(' ').map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.5 }));

/**
 * Live caption rendering on top of the real <video>. Sizes use container-query units, so
 * "64px" means 64px on a 1080px-wide frame at any preview size, matching what the export draws.
 */
export const CaptionOverlay: React.FC<Props> = ({ style, platform, words, currentTime, isPlaying, getTime, sampleText }) => {
  const usingSample = words.length === 0;
  const src = usingSample ? SAMPLE : words;
  const lines = useMemo(() => buildLines(src, style.wordsPerLine), [src, style.wordsPerLine]);

  const [rafT, setRafT] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => { setRafT(getTime()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, getTime]);
  const liveT = isPlaying ? rafT : currentTime;

  // Sample text loops so the preview always shows something to judge.
  const t = usingSample ? (liveT % 3) : liveT;
  const line = lineAt(lines, t);
  if (!line && !usingSample) return null;
  const shown = line ?? lines[0];
  if (!shown) return null;

  const fs = (px: number) => `${(px / 1080) * 100}cqw`;
  const outline = style.outlineWidth > 0
    ? Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return `${(Math.cos(a) * style.outlineWidth / 1080 * 100).toFixed(3)}cqw ${(Math.sin(a) * style.outlineWidth / 1080 * 100).toFixed(3)}cqw 0 ${style.outlineColor}`;
      })
    : [];
  const shadow = style.shadow > 0 ? [`0 ${fs(5)} ${fs(14 * style.shadow)} rgba(0,0,0,${0.35 + 0.5 * style.shadow})`] : [];
  const textShadow = [...outline, ...shadow].join(', ') || 'none';

  const idxActive = shown.words.findIndex((w) => t >= w.start && t < w.end);
  const activeIdx = idxActive >= 0 ? idxActive : t >= shown.end ? shown.words.length - 1 : -1;
  const bg = `${style.bgColor}${Math.round(style.bgOpacity * 255).toString(16).padStart(2, '0')}`;

  const anim = style.entrance === 'none' ? undefined : `cap-${style.entrance} 180ms ease-out`;

  const renderWord = (w: TimedWord, i: number) => {
    const text = applyCase(w.text, style.caseMode);
    if (style.animation === 'word') {
      return <span key={i} style={{ color: i === activeIdx ? style.highlightColor : style.textColor, transition: 'color 80ms' }}>{text} </span>;
    }
    if (style.animation === 'karaoke') {
      // Fill sweeps across each word as it is spoken (spoken words stay highlighted).
      const p = t >= w.end ? 100 : t <= w.start ? 0 : ((t - w.start) / (w.end - w.start)) * 100;
      return (
        <span key={i} style={{
          backgroundImage: `linear-gradient(90deg, ${style.highlightColor} ${p}%, ${style.textColor} ${p}%)`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: 'none',
          filter: outline.length ? `drop-shadow(0 0 ${fs(style.outlineWidth * 0.6)} ${style.outlineColor})` : undefined,
        }}>{text}{' '}</span>
      );
    }
    return <span key={i} style={{ color: style.textColor }}>{text} </span>;
  };

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ containerType: 'inline-size' }}>
      <div
        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center leading-[1.18]"
        style={{ top: `${captionCenterY(style, platform)}%`, width: '88%' }}
      >
        <div key={`${shown.id}-${style.entrance}`} style={{ animation: anim }}>
          <span
            style={{
              display: 'inline',
              fontFamily: cssFontFamily(style.fontFamily),
              fontWeight: style.fontWeight,
              fontSize: fs(style.fontSize),
              textShadow,
              background: style.bgOpacity > 0 ? bg : undefined,
              padding: style.bgOpacity > 0 ? `${fs(6)} ${fs(16)}` : undefined,
              borderRadius: fs(14),
              boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
            }}
          >
            {style.animation === 'static'
              ? applyCase(shown.words.map((w) => w.text).join(' '), style.caseMode)
              : shown.words.map(renderWord)}
          </span>
        </div>
      </div>
      {usingSample && sampleText !== '' && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-zinc-200 whitespace-nowrap">
          Sample text. Generate a transcript for your real captions
        </div>
      )}
    </div>
  );
};
