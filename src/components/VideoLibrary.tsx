'use client';

import React, { useState, useEffect } from 'react';
import {
  Film,
  Search,
  ArrowUpDown,
  Calendar,
  Clock,
  Layers,
  ExternalLink,
  Play,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
} from 'lucide-react';
import { VideoProject, ClipSegment } from '@/types/video';
import { formatTime, formatBytes } from '@/lib/format';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface VideoLibraryProps {
  onSelectProject: (project: VideoProject, clips: ClipSegment[]) => void;
  onNewImport: () => void;
}

export const VideoLibrary: React.FC<VideoLibraryProps> = ({
  onSelectProject,
  onNewImport,
}) => {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'clips' | 'duration' | 'title'>('updated');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder,
      });
      if (search.trim()) params.append('search', search.trim());

      const res = await fetch(`/api/projects?${params.toString()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [sortBy, sortOrder]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProjects();
  };

  const handleOpenProject = async (project: VideoProject) => {
    setLoadingProjectId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}`);
      const data = await res.json();
      if (data.success && data.project) {
        onSelectProject(data.project, data.clips || []);
      }
    } catch (err) {
      console.error('Failed to load project details:', err);
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this project and its saved clips?')) {
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}?deleteMedia=true`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateTime = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 p-4 sm:p-6 animate-in fade-in duration-200">
      {/* Top Controls Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Video Library & Project History</span>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Reopen any past video project with all previously created clips, timestamps, and export states.
          </p>
        </div>

        {/* Action: Import new */}
        <button
          onClick={onNewImport}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>New Video</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800 p-3 rounded-xl backdrop-blur-md">
        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by title, YouTube video ID, or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </form>

        {/* Sorting Dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500" />
            <span>Sort:</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="updated">Recently Edited</option>
            <option value="created">Date Imported</option>
            <option value="clips">Most Clips</option>
            <option value="duration">Video Duration</option>
            <option value="title">Title (A-Z)</option>
          </select>

          <button
            onClick={() => setSortOrder((curr) => (curr === 'asc' ? 'desc' : 'asc'))}
            className="px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white text-xs font-mono"
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortOrder === 'asc' ? '↑ ASC' : '↓ DESC'}
          </button>
        </div>
      </div>

      {/* Grid of Projects */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="text-xs">Loading video library...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="py-20 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/40 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600">
            <Film className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-zinc-300">No video projects found</p>
          <p className="text-xs text-zinc-500 max-w-sm">
            {search
              ? 'No projects matched your search query. Try clearing the search filter.'
              : 'Import a YouTube or local video to start your first clipping project.'}
          </p>
          <button
            onClick={onNewImport}
            className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/20"
          >
            Import Video Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const isLoadingThis = loadingProjectId === project.id;
            const isAvailable = project.isAvailable !== false;

            return (
              <div
                key={project.id}
                onClick={() => isAvailable && handleOpenProject(project)}
                className={`group bg-zinc-900/80 border rounded-2xl overflow-hidden transition-all flex flex-col select-none ${
                  isAvailable
                    ? 'border-zinc-800 hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-500/5 cursor-pointer'
                    : 'border-red-900/50 opacity-75'
                }`}
              >
                {/* Thumbnail Container */}
                <div className="relative aspect-video w-full bg-black overflow-hidden border-b border-zinc-800/80">
                  {project.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.thumbnailUrl}
                      alt={project.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700 bg-zinc-950">
                      <Film className="w-10 h-10" />
                    </div>
                  )}

                  {/* Duration Badge */}
                  <div className="absolute bottom-2 right-2 bg-black/85 font-mono text-[10px] font-medium px-2 py-0.5 rounded-md text-zinc-200 backdrop-blur-sm border border-zinc-700/40">
                    {formatTime(project.metadata.duration, false)}
                  </div>

                  {/* Origin Badge */}
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/75 backdrop-blur-sm px-2 py-0.5 rounded-md text-[10px] font-medium text-zinc-300 border border-zinc-700/40">
                    {project.sourceOrigin === 'youtube' ? (
                      <>
                        <YoutubeIcon className="w-3 h-3 text-red-500" />
                        <span>YouTube</span>
                      </>
                    ) : (
                      <>
                        <Film className="w-3 h-3 text-indigo-400" />
                        <span className="capitalize">{project.sourceOrigin}</span>
                      </>
                    )}
                  </div>

                  {/* Play / Open Overlay */}
                  {isAvailable && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/40">
                        {isLoadingThis ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-sm text-zinc-100 group-hover:text-indigo-300 transition-colors line-clamp-2 leading-snug">
                      {project.title}
                    </h3>

                    {/* YouTube details if present */}
                    {project.youtubeVideoId && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                        <span>ID: {project.youtubeVideoId}</span>
                        {project.youtubeUrl && (
                          <a
                            href={project.youtubeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-500 hover:text-red-400 transition-colors"
                            title="Open original video on YouTube"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Metrics and Status */}
                  <div className="pt-3 border-t border-zinc-800/60 flex flex-col gap-2 text-xs">
                    {/* Clips & Availability */}
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
                        <Layers className="w-3.5 h-3.5 text-indigo-400" />
                        <span>
                          {project.clipCount || 0} {(project.clipCount || 0) === 1 ? 'clip' : 'clips'}
                        </span>
                        {(project.completedClipCount || 0) > 0 && (
                          <span className="text-[10px] text-emerald-400 font-mono">
                            ({project.completedClipCount} ready)
                          </span>
                        )}
                      </div>

                      {isAvailable ? (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Cached</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-red-400 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          <span>File Missing</span>
                        </div>
                      )}
                    </div>

                    {/* Dates & Actions */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>Edited: {formatDateTime(project.updatedAt || project.createdAt)}</span>
                      </div>

                      {/* Delete project button */}
                      <button
                        onClick={(e) => handleDeleteProject(e, project.id)}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
