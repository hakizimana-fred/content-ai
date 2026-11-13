'use client';

import React from 'react';
import { Film, Languages, Loader2, FileText, ScanSearch } from 'lucide-react';
import { VideoSource } from '@/types/video';
import { formatBytes, formatResolution } from '@/lib/format';
import { formatTimecode } from '@/lib/timecode';

export interface TranscriptInfo { language: string; segments: number; dialects: string[]; reliability: number | null }

interface Props {
  source: VideoSource;
  transcript: TranscriptInfo | null;
  isTranscribing: boolean;
  onGenerateTranscript: () => void;
  sceneCount: number;
  isDetectingScenes: boolean;
  onDetectScenes: () => void;
}

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex items-center justify-between gap-3 py-2 text-sm border-b border-white/[0.05] last:border-0">
    <span className="text-zinc-400">{k}</span><span className="text-zinc-100 text-right font-medium">{v}</span>
  </div>
);

export const MediaPanel: React.FC<Props> = ({ source, transcript, isTranscribing, onGenerateTranscript, sceneCount, isDetectingScenes, onDetectScenes }) => {
  const m = source.metadata;
  const weak = transcript && transcript.reliability !== null && transcript.reliability < 0.35;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight">Media</h2>
        <p className="text-xs text-zinc-400 mt-0.5 break-words">{source.title}</p>
      </div>

      <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-1">
        <div className="flex items-center gap-2 pt-3 pb-1 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase"><Film className="w-3.5 h-3.5" /> Source video</div>
        <Row k="Duration" v={<span className="font-mono">{formatTimecode(m.duration, false)}</span>} />
        <Row k="Resolution" v={formatResolution(m.width, m.height)} />
        <Row k="Frame rate" v={`${m.fps} fps`} />
        <Row k="Orientation" v={m.width >= m.height ? 'Landscape' : 'Vertical'} />
        <Row k="Size" v={formatBytes(m.size)} />
        <Row k="Origin" v={<span className="capitalize">{source.sourceOrigin}</span>} />
      </section>

      <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase"><Languages className="w-3.5 h-3.5" /> Speech &amp; transcript</div>
        {transcript ? (
          <div className="mt-2 text-sm flex flex-col gap-1">
            <div className="text-zinc-200">Language: <span className="font-medium uppercase">{transcript.language}</span>{transcript.dialects.length > 0 && <span className="text-zinc-400"> · {transcript.dialects.join(', ')} markers</span>}</div>
            <div className="text-zinc-400">{transcript.segments} caption segments</div>
            {weak && <div role="alert" className="mt-1.5 text-xs text-amber-200 bg-amber-400/10 border border-amber-400/25 rounded-lg px-2.5 py-2">Low recognition confidence. Captions may contain mistakes. Larger models handle Luganda and Kinyarwanda better.</div>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">No transcript yet. It powers captions and moment detection.</p>
        )}
        <button onClick={onGenerateTranscript} disabled={isTranscribing || !!transcript} className="mt-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {isTranscribing ? <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing…</> : <><FileText className="w-4 h-4" /> {transcript ? 'Transcript ready' : 'Generate transcript'}</>}
        </button>
      </section>

      <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase"><ScanSearch className="w-3.5 h-3.5" /> Scenes</div>
        <p className="mt-2 text-sm text-zinc-400">{sceneCount > 0 ? `${sceneCount} scene changes are marked on the timeline (amber lines).` : 'Mark scene changes on the timeline to jump between shots quickly.'}</p>
        <button onClick={onDetectScenes} disabled={isDetectingScenes} className="mt-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-sm font-medium text-white disabled:opacity-60 transition-colors">
          {isDetectingScenes ? <><Loader2 className="w-4 h-4 animate-spin" /> Detecting…</> : sceneCount > 0 ? 'Detect again' : 'Detect scenes'}
        </button>
      </section>
    </div>
  );
};
