'use client';

import React, { useMemo, useState } from 'react';
import {
  Sparkles, Zap, RotateCcw, Loader2, Play, Pencil, Download, ListPlus, Share2, ChevronDown, Search, FileText, Library, Clock, ImageOff, Trash2, Undo2,
} from 'lucide-react';
import { CandidateMoment, ContentAnalysisReport } from '@/lib/intelligence/types';
import { VideoSource } from '@/types/video';
import { TranscriptResult } from '@/lib/intelligence/transcription-service';
import { formatTimecode, formatDuration } from '@/lib/timecode';
import { CATEGORY_STYLE, MomentCategory, languageName, momentCategory } from '@/lib/intelligence/moment-meta';
import { PLATFORMS, PLATFORM_ORDER, PlatformId } from '@/lib/editor/platforms';
import { SocialDistributionModal } from './SocialDistributionModal';
import { Segmented } from './editor/ui';

interface Props {
  source: VideoSource | null;
  report: ContentAnalysisReport | null;
  isAnalyzing: boolean;
  analysisProgress: { percent: number; stage: string } | null;
  onRunAnalysis: (force?: boolean) => void;
  platform: PlatformId;
  onPlatformChange: (p: PlatformId) => void;
  transcript: TranscriptResult | null;
  isTranscribing: boolean;
  onGenerateTranscript: () => void;
  onPreview: (m: CandidateMoment) => void;
  onEdit: (m: CandidateMoment) => void;
  onExport: (m: CandidateMoment) => void;
  onQueue: (m: CandidateMoment) => void;
  onQueueAll: (list: CandidateMoment[]) => void;
  onPlayRange: (start: number, end: number) => void;
  onOpenLibrary: () => void;
  onDelete: (m: CandidateMoment) => void;
  deletedCount: number;
  onRestoreDeleted: () => void;
}

type HookLang = 'english' | 'swahili' | 'luganda';
type Sort = 'score' | 'time';

const scoreTone = (s: number) => (s >= 85 ? '#34d399' : s >= 70 ? '#38bdf8' : '#a78bfa');

const ScoreRing: React.FC<{ score: number }> = ({ score }) => {
  const r = 16, c = 2 * Math.PI * r;
  return (
    <div className="relative w-11 h-11 shrink-0" title={`Attention score ${score}/100`} role="img" aria-label={`Attention score ${score} out of 100`}>
      <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90">
        <circle cx="20" cy="20" r={r} fill="rgba(8,12,27,0.75)" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={scoreTone(score)} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-white tabular-nums">{score}</span>
    </div>
  );
};

const FactorBar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center gap-2 text-[11px]">
    <span className="w-24 shrink-0 text-zinc-400">{label}</span>
    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400" style={{ width: `${value}%` }} /></div>
    <span className="w-7 text-right font-mono text-zinc-300 tabular-nums">{value}</span>
  </div>
);

const MomentCard: React.FC<{
  m: CandidateMoment; rank: number; source: VideoSource; lang: HookLang; langLabel: string; platformShort: string;
  onPreview: () => void; onEdit: () => void; onExport: () => void; onQueue: () => void; onPublish: () => void; onDelete: () => void;
}> = ({ m, rank, source, lang, langLabel, platformShort, onPreview, onEdit, onExport, onQueue, onPublish, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const category = momentCategory(m);
  const hook = m.recommendedHook[lang];
  const f = m.factors;
  // Thumbnail from the middle of the first seconds: usually a clean frame of the opener, not a transition.
  const thumb = `/api/video/frame?sourceId=${encodeURIComponent(source.id)}&t=${(m.startTime + m.duration / 2).toFixed(1)}`;

  return (
    <article className="glass rounded-2xl overflow-hidden flex flex-col min-w-0 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_20px_50px_-20px_rgba(99,102,241,0.45)]">
      <button onClick={onPreview} className="group relative aspect-video w-full bg-zinc-900 overflow-hidden text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400" aria-label={`Preview moment ${rank}`}>
        {imgFailed ? (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600"><ImageOff className="w-8 h-8" /></div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" onError={() => setImgFailed(true)} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/85 via-transparent to-zinc-950/30" />
        <span className="absolute top-2.5 left-2.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white backdrop-blur">#{rank}</span>
        <div className="absolute top-2 right-2"><ScoreRing score={m.score} /></div>
        <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md bg-black/70 text-white tabular-nums"><Clock className="w-3 h-3" />{formatDuration(m.duration)}</span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-12 h-12 rounded-full bg-white/90 text-zinc-950 flex items-center justify-center shadow-xl"><Play className="w-5 h-5 fill-current ml-0.5" /></span>
        </span>
      </button>

      <div className="p-4 flex flex-col gap-3 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_STYLE[category]}`}>{category}</span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-zinc-300">{langLabel}</span>
        </div>

        <h3 className="text-[15px] leading-snug font-semibold text-white line-clamp-2 break-words" title={hook}>{hook}</h3>

        <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 tabular-nums flex-wrap">
          <span className="text-zinc-200">{formatTimecode(m.startTime, false)}</span><span>→</span><span className="text-zinc-200">{formatTimecode(m.endTime, false)}</span>
        </div>

        <p className={`text-xs leading-relaxed text-zinc-400 break-words ${open ? '' : 'line-clamp-2'}`}>{m.explanation}</p>

        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="self-start flex items-center gap-1 text-xs text-indigo-300 hover:text-white">
          Why this moment <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-zinc-950/50 border border-white/[0.06] p-3">
            <FactorBar label="Opening" value={f.openingStrength} />
            <FactorBar label="Energy contrast" value={f.energyContrast} />
            <FactorBar label="Speech density" value={f.speechDensity} />
            <FactorBar label="Retention" value={f.retentionPotential} />
            <FactorBar label="Completeness" value={f.storyCompleteness} />
            {m.text && <FactorBar label={`Text signal${m.text.reliability < 0.35 ? ' (low trust)' : ''}`} value={m.text.score} />}
          </div>
        )}

        <div className="mt-auto pt-1 grid grid-cols-[1fr_1fr_auto] gap-2">
          <button onClick={onPreview} className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-sm font-medium text-white transition-colors"><Play className="w-3.5 h-3.5 fill-current" /> Preview</button>
          <button onClick={onEdit} className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-sm font-medium text-white transition-colors"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          <div className="flex gap-1.5">
            <button onClick={onQueue} className="w-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-zinc-300 hover:text-white flex items-center justify-center" title="Add to clips queue" aria-label="Add to clips queue"><ListPlus className="w-4 h-4" /></button>
            <button onClick={onPublish} className="w-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-zinc-300 hover:text-white flex items-center justify-center" title="Titles, captions and hashtags" aria-label="Open publishing desk"><Share2 className="w-4 h-4" /></button>
            <button onClick={onDelete} className="w-9 rounded-xl bg-white/[0.05] hover:bg-rose-500/25 text-zinc-300 hover:text-rose-200 flex items-center justify-center" title="Delete this moment (you can restore it)" aria-label="Delete moment"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
        <button onClick={onExport} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-white text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all">
          <Download className="w-4 h-4" /> Export for {platformShort}
        </button>
      </div>
    </article>
  );
};

const SkeletonCard: React.FC = () => (
  <div className="glass rounded-2xl overflow-hidden animate-pulse" aria-hidden>
    <div className="aspect-video bg-white/5" />
    <div className="p-4 flex flex-col gap-3">
      <div className="flex gap-2"><div className="h-5 w-16 rounded-full bg-white/10" /><div className="h-5 w-14 rounded-full bg-white/10" /></div>
      <div className="h-4 w-4/5 rounded bg-white/10" /><div className="h-3 w-1/2 rounded bg-white/10" /><div className="h-3 w-full rounded bg-white/5" /><div className="h-9 w-full rounded-xl bg-white/5 mt-2" />
    </div>
  </div>
);

export const MomentsWorkspace: React.FC<Props> = (p) => {
  const { source, report, isAnalyzing, analysisProgress, transcript } = p;
  const [tab, setTab] = useState<'moments' | 'transcript'>('moments');
  const [lang, setLang] = useState<HookLang>('english');
  const [sort, setSort] = useState<Sort>('score');
  const [cat, setCat] = useState<MomentCategory | 'all'>('all');
  const [publishing, setPublishing] = useState<CandidateMoment | null>(null);
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => report?.candidates ?? [], [report]);
  const cats = useMemo(() => Array.from(new Set(candidates.map(momentCategory))), [candidates]);
  const list = useMemo(() => {
    const filtered = cat === 'all' ? candidates : candidates.filter((c) => momentCategory(c) === cat);
    return [...filtered].sort((a, b) => (sort === 'score' ? b.score - a.score : a.startTime - b.startTime));
  }, [candidates, cat, sort]);
  const avg = candidates.length ? Math.round(candidates.reduce((a, c) => a + c.score, 0) / candidates.length) : 0;
  const langLabel = languageName(transcript?.language);
  const segs = useMemo(() => (transcript?.segments ?? []).filter((s) => !query || s.text.toLowerCase().includes(query.toLowerCase())), [transcript, query]);

  if (!source) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="glass rounded-3xl p-8 max-w-md text-center flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-300"><Sparkles className="w-7 h-7" /></div>
          <h2 className="text-lg font-semibold text-white">Open a video to discover moments</h2>
          <p className="text-sm text-zinc-400">The Content Intelligence engine scans a video for the most engaging, self-contained moments.</p>
          <button onClick={p.onOpenLibrary} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200"><Library className="w-4 h-4" /> Choose from Library</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 min-w-0">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-indigo-300 font-medium mb-1"><Sparkles className="w-3.5 h-3.5" /> Content Intelligence</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Moments</h1>
          <p className="text-sm text-zinc-400 mt-1 truncate" title={source.title}>{source.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {candidates.length > 0 && (
            <div className="flex items-center gap-4 glass rounded-2xl px-4 py-2 text-xs">
              <div><div className="text-zinc-500">Found</div><div className="text-base font-semibold text-white tabular-nums">{candidates.length}</div></div>
              <div><div className="text-zinc-500">Avg score</div><div className="text-base font-semibold text-white tabular-nums">{avg}</div></div>
              <div><div className="text-zinc-500">Scan</div><div className="text-base font-semibold text-white tabular-nums">{report ? (report.executionTimeMs / 1000).toFixed(1) : 0}s</div></div>
            </div>
          )}
          <button onClick={() => p.onRunAnalysis(Boolean(report))} disabled={isAnalyzing} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-white text-sm font-semibold shadow-lg shadow-indigo-600/25 disabled:opacity-60 transition-all">
            {isAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</> : report ? <><RotateCcw className="w-4 h-4" /> Re-scan</> : <><Zap className="w-4 h-4 fill-current" /> Discover moments</>}
          </button>
        </div>
      </header>

      {/* Tabs + controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <Segmented label="Section" value={tab} onChange={setTab} options={[
            { value: 'moments', label: <span className="flex items-center justify-center gap-1.5"><Zap className="w-3.5 h-3.5" />Moments{candidates.length ? ` (${candidates.length})` : ''}</span> },
            { value: 'transcript', label: <span className="flex items-center justify-center gap-1.5"><FileText className="w-3.5 h-3.5" />Transcript</span> },
          ]} />
        </div>
        {tab === 'moments' && candidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-full sm:w-auto"><Segmented label="Hook language" value={lang} onChange={setLang} options={[{ value: 'english', label: 'English' }, { value: 'swahili', label: 'Swahili' }, { value: 'luganda', label: 'Luganda' }]} /></div>
            <div className="w-full sm:w-auto"><Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'score', label: 'Top score' }, { value: 'time', label: 'In order' }]} /></div>
            <div className="w-full sm:w-auto"><Segmented label="Export format" value={p.platform} onChange={p.onPlatformChange} options={PLATFORM_ORDER.map((id) => ({ value: id, label: PLATFORMS[id].short }))} /></div>
          </div>
        )}
      </div>

      {tab === 'moments' && (
        <>
          {p.deletedCount > 0 && !isAnalyzing && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-zinc-300">
              <span>{p.deletedCount} moment{p.deletedCount === 1 ? '' : 's'} deleted</span>
              <button onClick={p.onRestoreDeleted} className="flex items-center gap-1.5 font-medium text-indigo-300 hover:text-indigo-200"><Undo2 className="w-3.5 h-3.5" /> Restore {p.deletedCount === 1 ? 'it' : 'all'}</button>
            </div>
          )}
          {/* Category filters + batch */}
          {candidates.length > 0 && !isAnalyzing && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
                {(['all', ...cats] as const).map((c) => (
                  <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${cat === c ? 'bg-white text-zinc-950 border-white' : 'border-white/10 text-zinc-300 hover:bg-white/5'}`}>
                    {c === 'all' ? 'All' : c}
                  </button>
                ))}
              </div>
              <button onClick={() => p.onQueueAll(list)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white border border-white/10 hover:bg-white/5"><ListPlus className="w-3.5 h-3.5" /> Add {list.length} to queue</button>
            </div>
          )}

          {/* Scanning */}
          {isAnalyzing && (
            <>
              <div className="glass rounded-2xl p-4 flex flex-col gap-2.5" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="text-indigo-200 font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{analysisProgress?.stage || 'Scanning audio…'}</span><span className="font-mono text-zinc-400">{analysisProgress?.percent ?? 10}%</span></div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-all duration-300" style={{ width: `${analysisProgress?.percent ?? 10}%` }} /></div>
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}</div>
            </>
          )}

          {/* Empty */}
          {!isAnalyzing && !report && (
            <div className="glass rounded-3xl p-8 sm:p-12 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-300"><Sparkles className="w-8 h-8" /></div>
              <h2 className="text-xl font-semibold text-white">Find the moments worth sharing</h2>
              <p className="text-sm text-zinc-400 max-w-md">We scan the whole video for strong openings, energy, question-and-answer exchanges and clean start and end points, then rank them.</p>
              <button onClick={() => p.onRunAnalysis(false)} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200"><Zap className="w-4 h-4 fill-current" /> Discover moments</button>
            </div>
          )}
          {!isAnalyzing && report && candidates.length === 0 && (
            <div className="glass rounded-3xl p-10 text-center text-sm text-zinc-400">No strong moments were found in this video. Try Re-scan, or a longer video.</div>
          )}
          {!isAnalyzing && candidates.length > 0 && list.length === 0 && (
            <div className="glass rounded-3xl p-10 text-center text-sm text-zinc-400">No moments in this category. <button onClick={() => setCat('all')} className="text-indigo-300 underline">Show all</button></div>
          )}

          {/* Grid */}
          {!isAnalyzing && list.length > 0 && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 items-stretch">
              {list.map((m, i) => (
                <MomentCard key={m.id} m={m} rank={sort === 'score' ? i + 1 : candidates.findIndex((c) => c.id === m.id) + 1} source={source} lang={lang} langLabel={langLabel} platformShort={PLATFORMS[p.platform].short}
                  onPreview={() => p.onPreview(m)} onEdit={() => p.onEdit(m)} onExport={() => p.onExport(m)} onQueue={() => p.onQueue(m)} onPublish={() => setPublishing(m)} onDelete={() => p.onDelete(m)} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'transcript' && (
        <div className="flex flex-col gap-3 max-w-4xl">
          {!transcript ? (
            <div className="glass rounded-3xl p-8 sm:p-10 flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300"><FileText className="w-7 h-7" /></div>
              <h2 className="text-lg font-semibold text-white">Spoken transcript</h2>
              <p className="text-sm text-zinc-400 max-w-md">Word-level timestamps and dialect hints (Swahili, Luganda, code-switching), generated locally with Whisper. No API fees.</p>
              <button onClick={p.onGenerateTranscript} disabled={p.isTranscribing} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 disabled:opacity-60">
                {p.isTranscribing ? <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing… this can take a few minutes</> : <><Zap className="w-4 h-4 fill-current" /> Transcribe audio</>}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 glass rounded-2xl px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-400">Language</span>
                  <span className="font-semibold text-white">{langLabel} <span className="text-zinc-400 font-normal">({Math.round(transcript.language_probability * 100)}%)</span></span>
                  {transcript.african_context?.detected_african_dialects?.map((d) => <span key={d} className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-400/30">{d}</span>)}
                  {transcript.african_context?.is_code_switching && <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-400/30">Code-switching</span>}
                </div>
                <div className="flex gap-1.5">
                  {(['srt', 'vtt'] as const).map((f) => (
                    <a key={f} href={`/api/video/subtitles?sourceId=${encodeURIComponent(source.id)}&format=${f}`} download className="px-2.5 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.13] text-zinc-200 font-medium uppercase">.{f}</a>
                  ))}
                </div>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the dialogue…" aria-label="Search transcript" className="w-full rounded-xl bg-zinc-950/60 border border-white/10 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-400" />
              </div>
              <ul className="flex flex-col gap-1.5">
                {segs.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04] transition-colors">
                    <button onClick={() => p.onPlayRange(s.start, s.end)} className="shrink-0 mt-0.5 flex items-center gap-1 font-mono text-[11px] px-2 py-1 rounded-md bg-sky-500/10 text-sky-200 hover:bg-sky-500 hover:text-white transition-colors" title="Play this line"><Play className="w-3 h-3 fill-current" />{formatTimecode(s.start, false)}</button>
                    <p className="text-sm text-zinc-200 leading-relaxed break-words min-w-0">{s.text}</p>
                  </li>
                ))}
                {segs.length === 0 && <li className="text-sm text-zinc-500 px-3 py-6 text-center">No lines match &ldquo;{query}&rdquo;.</li>}
              </ul>
            </>
          )}
        </div>
      )}

      <SocialDistributionModal isOpen={!!publishing} onClose={() => setPublishing(null)} moment={publishing} sourceTitle={source.title} />
    </div>
  );
};
