'use client';

import React from 'react';
import { Scissors, Film, Sparkles, HelpCircle, Upload, FileVideo, Edit3, CheckCircle2, AlertTriangle, Crop, Captions, Palette, Download, Radar, Wand2, Clapperboard } from 'lucide-react';
import { VideoSource, IngestionJob } from '@/types/video';
import { formatTime, formatResolution, formatBytes } from '@/lib/format';

export type EditorTab = 'media' | 'trim' | 'crop' | 'captions' | 'style' | 'director' | 'export';
export type AppView = 'editor' | 'moments' | 'radar' | 'studio' | 'auto' | 'library';

const EDITOR_STEPS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <Film className="w-3.5 h-3.5" /> },
  { id: 'trim', label: 'Trim', icon: <Scissors className="w-3.5 h-3.5" /> },
  { id: 'crop', label: 'Crop', icon: <Crop className="w-3.5 h-3.5" /> },
  { id: 'captions', label: 'Captions', icon: <Captions className="w-3.5 h-3.5" /> },
  { id: 'style', label: 'Style', icon: <Palette className="w-3.5 h-3.5" /> },
  { id: 'director', label: 'AI Director', icon: <Wand2 className="w-3.5 h-3.5" /> },
  { id: 'export', label: 'Export', icon: <Download className="w-3.5 h-3.5" /> },
];

interface HeaderProps {
  editorTab?: EditorTab;
  onEditorTab?: (t: EditorTab) => void;
  exportCount?: number;
  currentSource: VideoSource | null;
  currentView: AppView;
  projectCount: number;
  activeIngestionJob?: IngestionJob | null;
  onOpenIngestionModal?: () => void;
  onSwitchView: (view: AppView) => void;
  onImportNew: () => void;
  onLoadSample: () => void;
  onOpenShortcuts: () => void;
  isLoadingSample?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  editorTab,
  onEditorTab,
  exportCount = 0,
  currentSource,
  currentView,
  projectCount,
  activeIngestionJob,
  onOpenIngestionModal,
  onSwitchView,
  onImportNew,
  onLoadSample,
  onOpenShortcuts,
  isLoadingSample = false,
}) => {
  return (
    <header className="h-14 border-b border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl px-4 grid grid-cols-[1fr_auto_1fr] items-center select-none z-30">
      {/* Left: Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <Scissors className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-[15px] tracking-tight text-white">Content AI</span>
      </div>

      {/* Center: Workspace navigation */}
      <nav className="flex items-center gap-1 text-[13px] min-w-0" aria-label="Workspaces">
        <button
          onClick={() => onSwitchView('editor')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'editor' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Editor</span>
        </button>
        {currentView === 'editor' && currentSource && onEditorTab && (
          <div className="flex items-center gap-0.5 mx-1 pl-1.5 border-l border-white/10" role="group" aria-label="Editing steps">
            {EDITOR_STEPS.map((t) => (
              <button
                key={t.id}
                onClick={() => onEditorTab(t.id)}
                aria-current={editorTab === t.id ? 'page' : undefined}
                title={t.label}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full font-medium transition-all ${
                  editorTab === t.id ? 'bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/40' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {t.icon}
                <span className="hidden xl:inline">{t.label}</span>
                {t.id === 'export' && exportCount > 0 && <span className="text-[10px] font-mono px-1.5 rounded-full bg-white/10 text-zinc-300">{exportCount}</span>}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => onSwitchView('moments')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'moments' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Moments</span>
        </button>
        <button
          onClick={() => onSwitchView('radar')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'radar' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Radar className="w-3.5 h-3.5" />
          <span>Radar</span>
        </button>
        <button
          onClick={() => onSwitchView('auto')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'auto' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Clapperboard className="w-3.5 h-3.5" />
          <span>Auto Studio</span>
        </button>
        <button
          onClick={() => onSwitchView('studio')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'studio' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>Studio</span>
        </button>
        <button
          onClick={() => onSwitchView('library')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition-all ${
            currentView === 'library' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <FileVideo className="w-3.5 h-3.5" />
          <span>Library</span>
          {projectCount > 0 && (
            <span className={`text-[10px] font-mono px-1.5 rounded-full ${currentView === 'library' ? 'bg-zinc-950/10 text-zinc-700' : 'bg-indigo-500/20 text-indigo-300'}`}>
              {projectCount}
            </span>
          )}
        </button>
      </nav>

      <div className="flex items-center justify-end gap-3 min-w-0">
      {/* Persistent Background Ingestion Status Pill */}
      {activeIngestionJob && (
        <div className="flex items-center">
          {activeIngestionJob.status === 'processing' && (
            <button
              onClick={onOpenIngestionModal}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/70 border border-indigo-500/50 text-xs text-indigo-200 hover:bg-indigo-900/60 hover:border-indigo-400 transition-all shadow-lg shadow-indigo-950/60 group"
              title="Click to view real-time video processing pipeline"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span className="font-medium text-white max-w-[120px] sm:max-w-[180px] truncate">
                {activeIngestionJob.title || 'Processing Video'}
              </span>
              <span className="font-mono text-indigo-300 font-semibold bg-indigo-900/60 px-1.5 py-0.2 rounded text-[11px]">
                {activeIngestionJob.progress > 0 ? `${activeIngestionJob.progress.toFixed(0)}%` : 'Active'}
              </span>
            </button>
          )}

          {activeIngestionJob.status === 'completed' && (
            <button
              onClick={onOpenIngestionModal}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 hover:bg-emerald-900/60 transition-all shadow-md group"
              title="Video ready! Click to open"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium text-emerald-100 max-w-[130px] truncate">
                {activeIngestionJob.title || 'Video Ready'}
              </span>
            </button>
          )}

          {activeIngestionJob.status === 'error' && (
            <button
              onClick={onOpenIngestionModal}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 hover:bg-rose-900/60 transition-all shadow-md group"
              title="Import failed. Click to view details and retry"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-medium text-rose-100 max-w-[130px] truncate">Import Failed</span>
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {!currentSource && currentView === 'editor' && (
          <button
            onClick={onLoadSample}
            disabled={isLoadingSample}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition-colors disabled:opacity-50"
            title="Load sample test video to try features immediately"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isLoadingSample ? 'Generating...' : 'Try Sample'}</span>
          </button>
        )}

        {currentSource && (
          <button
            onClick={onImportNew}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-white hover:bg-zinc-200 text-zinc-950 shadow-md transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>New Video</span>
          </button>
        )}

        <button
          onClick={onOpenShortcuts}
          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
          title="Keyboard Shortcuts"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
      </div>
    </header>
  );
};
