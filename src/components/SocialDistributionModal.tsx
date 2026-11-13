'use client';

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  Download,
  Globe,
  Sparkles,
  Film,
  Subtitles,
  ExternalLink,
} from 'lucide-react';
import { CandidateMoment } from '@/lib/intelligence/types';
import { ClipSegment } from '@/types/video';

interface SocialDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  moment?: CandidateMoment | null;
  clip?: ClipSegment | null;
  sourceTitle?: string;
}

type Platform = 'tiktok' | 'shorts' | 'reels';
type Language = 'english' | 'swahili' | 'luganda';

export const SocialDistributionModal: React.FC<SocialDistributionModalProps> = ({
  isOpen,
  onClose,
  moment,
  clip,
  sourceTitle = 'Conversation',
}) => {
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [lang, setLang] = useState<Language>('english');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen || (!moment && !clip)) return null;

  const duration = clip ? clip.endTime - clip.startTime : moment ? moment.duration : 30;
  const clipTitle = clip?.name || moment?.title || 'Engaging Moment';

  // Get hook for selected language
  const hookText = moment?.recommendedHook
    ? moment.recommendedHook[lang]
    : lang === 'swahili'
    ? 'Tazama kipande hiki cha kusisimua...'
    : lang === 'luganda'
    ? 'Laba ekitundu kino eky\'omugaso ennyo...'
    : 'You will not believe what was said next...';

  // Platform specific templates
  const getTikTokContent = () => {
    const hashtags = '#fyp #foryou #viral #podcast #trending #africantiktok #interview #storytime';
    return {
      title: hookText,
      caption: `${hookText}\n\nWhat do you think about this? Drop your perspective in the comments below! 👇\n\n${hashtags}`,
      charLimit: 2200,
    };
  };

  const getShortsContent = () => {
    const titleCandidate = `${hookText.slice(0, 85)} #Shorts`;
    return {
      title: titleCandidate.slice(0, 100),
      description: `${hookText}\n\nFull conversation from "${sourceTitle}".\n\nSubscribe for daily high-impact clips and conversations!\n\n#Shorts #Viral #Podcast #Trending`,
      charLimit: 100, // Title limit
    };
  };

  const getReelsContent = () => {
    const hashtags = '#reels #explorepage #viralreels #africancreators #podcasts #deepconversations';
    return {
      title: hookText,
      caption: `${hookText}\n.\n.\nShare this with someone who needs to hear this insight today!\nFollow for more powerful highlights.\n.\n.\n${hashtags}`,
      charLimit: 2200,
    };
  };

  const currentContent =
    platform === 'tiktok'
      ? getTikTokContent()
      : platform === 'shorts'
      ? getShortsContent()
      : getReelsContent();

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white shadow-lg shadow-pink-500/20">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-zinc-100">
                  Social Distribution Desk
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 border border-pink-500/30">
                  Publishing Ready
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Optimized captions, multilingual hooks, and distribution metadata for 9:16 platforms.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Target Platform Tabs */}
          <div className="flex items-center gap-2 p-1 bg-zinc-950 rounded-xl border border-zinc-800">
            <button
              onClick={() => setPlatform('tiktok')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                platform === 'tiktok'
                  ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>🎵 TikTok</span>
            </button>
            <button
              onClick={() => setPlatform('shorts')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                platform === 'shorts'
                  ? 'bg-red-600/20 text-red-400 border border-red-500/30 shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>🔴 YouTube Shorts</span>
            </button>
            <button
              onClick={() => setPlatform('reels')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                platform === 'reels'
                  ? 'bg-pink-600/20 text-pink-400 border border-pink-500/30 shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>📸 Instagram Reels</span>
            </button>
          </div>

          {/* Multilingual Hook Selector */}
          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-400 font-medium">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>Multilingual Hook Angle</span>
              </span>
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  onClick={() => setLang('english')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    lang === 'english'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800'
                  }`}
                >
                  English
                </button>
                <button
                  onClick={() => setLang('swahili')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    lang === 'swahili'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800'
                  }`}
                >
                  Swahili
                </button>
                <button
                  onClick={() => setLang('luganda')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    lang === 'luganda'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800'
                  }`}
                >
                  Luganda
                </button>
              </div>
            </div>

            <p className="text-xs text-zinc-200 italic bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800/80">
              &ldquo;{hookText}&rdquo;
            </p>
          </div>

          {/* Generated Content Box */}
          <div className="space-y-3">
            {platform === 'shorts' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-medium">Shorts Title (Max 100 chars)</span>
                  <span
                    className={`font-mono text-[11px] ${
                      currentContent.title.length > 90 ? 'text-amber-400' : 'text-zinc-500'
                    }`}
                  >
                    {currentContent.title.length}/100
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={currentContent.title}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-2 pl-3 pr-20 text-xs font-medium text-white focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopy(currentContent.title, 'title')}
                    className="absolute right-1.5 top-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 flex items-center gap-1 transition-colors"
                  >
                    {copiedKey === 'title' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">
                  {platform === 'shorts' ? 'Description & Tags' : 'Post Caption & Tags'}
                </span>
                <span className="font-mono text-[11px] text-zinc-500">
                  {platform === 'shorts'
                    ? (currentContent as any).description.length
                    : (currentContent as any).caption.length}
                  /{currentContent.charLimit}
                </span>
              </div>

              <div className="relative">
                <textarea
                  readOnly
                  rows={6}
                  value={
                    platform === 'shorts'
                      ? (currentContent as any).description
                      : (currentContent as any).caption
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 leading-relaxed font-mono focus:outline-none resize-none"
                />
                <button
                  onClick={() =>
                    handleCopy(
                      platform === 'shorts'
                        ? (currentContent as any).description
                        : (currentContent as any).caption,
                      'caption'
                    )
                  }
                  className="absolute right-3 bottom-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all"
                >
                  {copiedKey === 'caption' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Caption</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Film className="w-4 h-4 text-indigo-400" />
            <span>
              Segment: <strong className="text-zinc-200">{duration.toFixed(1)}s</strong> (Optimal for 9:16 algorithmic reach)
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-white font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
