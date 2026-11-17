'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Film, Scissors, Crop, Captions, Palette, Download } from 'lucide-react';
import { Header } from '@/components/Header';
import { ImportZone } from '@/components/ImportZone';
import { VideoPlayer, PreviewState } from '@/components/VideoPlayer';
import { CutPanel, SelectionState } from '@/components/CutPanel';
import { validateSelection, formatTimecode, formatDuration } from '@/lib/timecode';
import { Timeline } from '@/components/Timeline';
import { ClipManager } from '@/components/ClipManager';
import { ClipPreviewModal } from '@/components/ClipPreviewModal';
import { VideoLibrary } from '@/components/VideoLibrary';
import { DuplicateProjectModal } from '@/components/DuplicateProjectModal';
import { ShortcutsModal } from '@/components/ShortcutsModal';
import { IngestionProgressModal } from '@/components/IngestionProgressModal';
import { RadarWorkspace } from '@/components/RadarWorkspace';
import { AutoStudioWorkspace } from '@/components/AutoStudioWorkspace';
import { StudioWorkspace, SoundPick } from '@/components/StudioWorkspace';
import { DirectorPanel, DirectorMeta } from '@/components/editor/DirectorPanel';
import { EditingPlan } from '@/lib/studio/plan';
import type { ProduceResult } from '@/lib/studio/produce';
import type { Identity } from '@/lib/studio/identity';
import { MomentsWorkspace } from '@/components/MomentsWorkspace';
import { MediaPanel } from '@/components/editor/MediaPanel';
import { CropPanel, TrackState } from '@/components/editor/CropPanel';
import { CaptionStudioPanel } from '@/components/editor/CaptionStudioPanel';
import { StylePanel } from '@/components/editor/StylePanel';
import { ExportPanel } from '@/components/editor/ExportPanel';
import { PLATFORMS, PlatformId } from '@/lib/editor/platforms';
import { DEFAULT_FRAMING, FramingSettings } from '@/lib/editor/framing';
import { DEFAULT_CAPTION_STYLE, CaptionStyle, toTimedWords } from '@/lib/editor/captions';
import { transcriptReliability } from '@/lib/intelligence/text-features';
import { TranscriptResult } from '@/lib/intelligence/transcription-service';
import { VideoSource, VideoProject, ClipSegment, IngestionJob, ProductionSettings } from '@/types/video';
import { ContentAnalysisReport, CandidateMoment } from '@/lib/intelligence/types';

export default function VideoCutterPage() {
  const [currentView, setCurrentView] = useState<'editor' | 'moments' | 'radar' | 'studio' | 'auto' | 'library'>('editor');
  const [projectCount, setProjectCount] = useState(0);

  const [currentSource, setCurrentSource] = useState<VideoSource | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  // ONE source of truth for the cut: the timeline, timestamp fields, player and shortcuts all read/write this.
  const [selection, setSelection] = useState<SelectionState>({ start: null, end: null });
  const [clips, setClips] = useState<ClipSegment[]>([]);
  const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [latestCutClipId, setLatestCutClipId] = useState<string | null>(null);
  const nonceRef = useRef(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isCuttingAny, setIsCuttingAny] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Dedicated Clip Preview Modal State
  const [activeModalClip, setActiveModalClip] = useState<ClipSegment | null>(null);
  const [previewModalAutoPlay, setPreviewModalAutoPlay] = useState(false);

  // Duplicate Project Detection Modal State
  const [duplicateModal, setDuplicateModal] = useState<{
    isOpen: boolean;
    project: VideoProject | null;
    clips: ClipSegment[];
  }>({
    isOpen: false,
    project: null,
    clips: [],
  });

  // Real-time Ingestion Pipeline State
  const [activeIngestionJob, setActiveIngestionJob] = useState<IngestionJob | null>(null);
  const [isIngestionModalOpen, setIsIngestionModalOpen] = useState(false);

  // Content Intelligence Engine State
  // Editor workspace (Media | Trim | Crop | Captions | Style | Export)
  const [editorTab, setEditorTab] = useState<'media' | 'trim' | 'crop' | 'captions' | 'style' | 'director' | 'export'>('trim');
  const [platform, setPlatform] = useState<PlatformId>('tiktok');
  const [showSafeAreas, setShowSafeAreas] = useState(false);
  const [framing, setFraming] = useState<FramingSettings>(DEFAULT_FRAMING);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [trackState, setTrackState] = useState<TrackState>({ status: 'idle' });
  const [scenes, setScenes] = useState<number[]>([]);
  // Creative Studio: the Director's plan and the sound/overlay extras that Export adds on top of the normal production settings
  const [directorPlan, setDirectorPlan] = useState<EditingPlan | null>(null);
  const [directorMeta, setDirectorMeta] = useState<DirectorMeta | null>(null);
  const [studioExtras, setStudioExtras] = useState<ProductionSettings['studio'] | null>(null);
  const [studioReport, setStudioReport] = useState<{ applied: string[]; skipped: string[] } | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [identityId, setIdentityId] = useState('');
  const [isProducing, setIsProducing] = useState(false);
  const [isDetectingScenes, setIsDetectingScenes] = useState(false);
  const [latestExportId, setLatestExportId] = useState<string | null>(null);
  const [analysisReport, setAnalysisReport] = useState<ContentAnalysisReport | null>(null);
  // Deleted moments are hidden (not erased from the analysis) and remembered per video, so they can be restored.
  const [dismissedMap, setDismissedMap] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('content-ai:dismissed-moments:v1') ?? '{}'); } catch { return {}; }
  });
  const dismissedIds = useMemo(() => dismissedMap[currentSource?.id ?? ''] ?? [], [dismissedMap, currentSource?.id]);
  const visibleReport = useMemo(
    () => (analysisReport ? { ...analysisReport, candidates: analysisReport.candidates.filter((c) => !dismissedIds.includes(c.id)) } : null),
    [analysisReport, dismissedIds],
  );
  const updateDismissed = useCallback((fn: (ids: string[]) => string[]) => {
    const sid = currentSource?.id;
    if (!sid) return;
    setDismissedMap((prev) => {
      const next = { ...prev, [sid]: fn(prev[sid] ?? []) };
      try { localStorage.setItem('content-ai:dismissed-moments:v1', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [currentSource?.id]);
  const [isAnalyzingContent, setIsAnalyzingContent] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ percent: number; stage: string } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  const refreshProjectCount = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success && typeof data.total === 'number') {
        setProjectCount(data.total);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshProjectCount();
  }, [currentSource?.id]);

  // Load existing Content Intelligence report when video changes
  useEffect(() => {
    if (!currentSource) {
      setAnalysisReport(null);
      return;
    }
    fetch(`/api/video/analyze?sourceId=${encodeURIComponent(currentSource.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.report) {
          setAnalysisReport(data.report);
        } else {
          setAnalysisReport(null);
        }
      })
      .catch(() => setAnalysisReport(null));
  }, [currentSource?.id]);

  // Connect to SSE stream for ingestion updates
  const connectIngestionStream = useCallback((jobId: string) => {
    const eventSource = new EventSource(`/api/video/youtube/stream?id=${encodeURIComponent(jobId)}`);

    const handleUpdate = (e: MessageEvent) => {
      try {
        const updatedJob: IngestionJob = JSON.parse(e.data);
        setActiveIngestionJob(updatedJob);

        if (updatedJob.status === 'completed') {
          refreshProjectCount();
          if (updatedJob.project) {
            showNotification(`"${updatedJob.title}" ready! Click to edit.`, 'success');
          }
          eventSource.close();
        } else if (updatedJob.status === 'error') {
          showNotification(`Processing failed: ${updatedJob.error?.title || 'Error'}`, 'error');
          eventSource.close();
        }
      } catch (err) {
        console.error('Error parsing ingestion event:', err);
      }
    };

    eventSource.addEventListener('update', handleUpdate);
    eventSource.onmessage = handleUpdate;

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Check for any currently active background ingestion job on mount
  useEffect(() => {
    const checkActiveJob = async () => {
      try {
        const res = await fetch('/api/video/youtube?active=true');
        const data = await res.json();
        if (data.success && data.job) {
          setActiveIngestionJob(data.job);
          connectIngestionStream(data.job.id);
        }
      } catch {
        // ignore
      }
    };
    checkActiveJob();
  }, [connectIngestionStream]);

  // Start YouTube ingestion
  const startYouTubeIngestion = async (url: string, confirmedOwnership: boolean, forceReimport = false) => {
    setIsIngestionModalOpen(true);
    setDuplicateModal({ isOpen: false, project: null, clips: [] });

    try {
      const res = await fetch('/api/video/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          confirmedOwnership,
          forceReimport,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start video ingestion.');
      }

      const job: IngestionJob = data.job;
      setActiveIngestionJob(job);

      if (data.reused && job.project) {
        // Already exists and file is present
        handleVideoLoaded(job.project);
        showNotification(`Reopened "${job.project.title}" from library.`);
      } else {
        // Connect SSE stream
        connectIngestionStream(job.id);
      }
    } catch (err) {
      showNotification((err as Error).message, 'error');
    }
  };

  // When a video source is loaded, initialize defaults
  const handleVideoLoaded = (source: VideoSource) => {
    setCurrentSource(source);
    setCurrentTime(0);
    setSeekRequest({ time: 0, nonce: ++nonceRef.current });
    setSelection({ start: null, end: null });
    setPreview(null);
    setLatestCutClipId(null);
    setEditorTab('trim');
    setClips([]);
    setActiveModalClip(null);
    setIsIngestionModalOpen(false);
    setCurrentView('editor');
    refreshProjectCount();
    showNotification(`Loaded "${source.title}" successfully.`);
  };

  // Reopen existing project from Library or Duplicate Modal
  const handleReopenProject = (project: VideoProject, projectClips: ClipSegment[]) => {
    setCurrentSource(project);
    setCurrentTime(0);
    setSeekRequest({ time: 0, nonce: ++nonceRef.current });
    setSelection({ start: null, end: null });
    setPreview(null);
    setLatestCutClipId(null);
    setEditorTab('trim');
    setClips(projectClips);
    setActiveModalClip(null);
    setDuplicateModal({ isOpen: false, project: null, clips: [] });
    setCurrentView('editor');
    refreshProjectCount();
    showNotification(`Reopened project "${project.title}" with ${projectClips.length} clips.`);
  };

  // Duplicate project detected
  const handleDuplicateDetected = (project: VideoProject, projectClips: ClipSegment[]) => {
    setDuplicateModal({
      isOpen: true,
      project,
      clips: projectClips,
    });
  };

  // Force re-import duplicate
  const handleForceReimport = async () => {
    if (!duplicateModal.project?.youtubeUrl) return;
    const url = duplicateModal.project.youtubeUrl;
    setDuplicateModal({ isOpen: false, project: null, clips: [] });
    startYouTubeIngestion(url, true, true);
  };

  // Load sample video
  const handleLoadSample = async () => {
    setIsLoadingSample(true);
    try {
      const res = await fetch('/api/video/sample');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load sample video');
      }
      handleVideoLoaded(data.source);
    } catch (err) {
      showNotification((err as Error).message, 'error');
    } finally {
      setIsLoadingSample(false);
    }
  };

  const duration = currentSource?.metadata.duration ?? 0;
  const ms = (t: number) => Math.round(t * 1000) / 1000;
  const validation = useMemo(() => validateSelection(selection.start, selection.end, duration), [selection, duration]);

  /** Exact seek. Also ends any preview session (the user has taken manual control). */
  const seek = useCallback((time: number) => {
    const t = Math.max(0, Math.min(duration, time));
    setCurrentTime(t);
    setSeekRequest({ time: t, nonce: ++nonceRef.current });
    setPreview(null);
  }, [duration]);

  // Selection edits never auto-correct each other: invalid pairs are shown and explained, not rewritten.
  const handleStartChange = useCallback((t: number | null) => setSelection((s) => ({ ...s, start: t === null ? null : ms(t) })), []);
  const handleEndChange = useCallback((t: number | null) => setSelection((s) => ({ ...s, end: t === null ? null : ms(t) })), []);
  const handleRangeChange = useCallback((start: number, end: number) => setSelection({ start: ms(start), end: ms(end) }), []);
  const handleMarkStart = useCallback(() => handleStartChange(currentTimeRef.current), [handleStartChange]);
  const handleMarkEnd = useCallback(() => handleEndChange(currentTimeRef.current), [handleEndChange]);
  const handleClearSelection = useCallback(() => setSelection({ start: null, end: null }), []);
  const handleResetSelection = useCallback(() => {
    if (duration > 0) setSelection({ start: 0, end: ms(duration) });
  }, [duration]);

  // ---- Preview (plays a range, stops exactly at its end, remembers where you were) ----
  const beginPreview = (start: number, end: number) => {
    setPreview((p) => ({ start, end, returnTo: p ? p.returnTo : currentTimeRef.current, nonce: ++nonceRef.current, ended: false }));
  };
  const requireValidSelection = (): boolean => {
    if (validation.ok) return true;
    showNotification(validation.startError || validation.endError || validation.rangeError || 'Select a segment first.', 'error');
    return false;
  };
  const handlePlaySelection = useCallback(() => {
    if (!requireValidSelection()) return;
    beginPreview(selection.start!, selection.end!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation, selection]);
  const handlePreviewEdge = (edge: 'start' | 'end') => {
    if (!requireValidSelection()) return;
    const { start, end } = selection as { start: number; end: number };
    if (edge === 'start') beginPreview(start, Math.min(end, ms(start + 3)));
    else beginPreview(Math.max(start, ms(end - 3)), end);
  };
  const handleExitPreview = (restore: boolean) => {
    if (restore && preview) seek(preview.returnTo);
    else setPreview(null);
  };

  const makeClipFromSelection = (): ClipSegment | null => {
    if (!currentSource || !validation.ok) return null;
    const n = clips.length + 1;
    return {
      id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: `Clip #${n}`,
      sourceId: currentSource.id,
      startTime: selection.start!,
      endTime: selection.end!,
      status: 'draft',
      progress: 0,
      createdAt: Date.now(),
    };
  };

  // Save the selection to the queue without cutting yet
  const handleAddClip = () => {
    if (!requireValidSelection()) return;
    const clip = makeClipFromSelection();
    if (!clip) return;
    setClips((prev) => [...prev, clip]);
    showNotification(`Added ${clip.name} (${formatDuration(clip.endTime - clip.startTime)}) to the queue.`);
  };

  // CUT VIDEO: validate -> create clip -> generate the file (real progress), then show the result
  const handleCutSelection = async () => {
    if (!requireValidSelection()) return;
    const clip = makeClipFromSelection();
    if (!clip) return;
    setClips((prev) => [...prev, clip]);
    setLatestCutClipId(clip.id);
    await executeCutClip(clip);
  };

  // Click an AI moment on the timeline: it becomes the selection (and can then be fine-tuned)
  const handlePickMoment = (m: CandidateMoment) => {
    setSelection({ start: ms(m.startTime), end: ms(m.endTime) });
    seek(m.startTime);
    setEditorTab('trim');
  };

  // Open independent preview modal for a clip
  const handleOpenPreviewModal = (clip: ClipSegment, autoPlay = false) => {
    setActiveModalClip(clip);
    setPreviewModalAutoPlay(autoPlay);
  };

  // Used by the AI Moments panel: play a range without touching the selection
  const handlePreviewActiveRange = (start: number, end: number) => beginPreview(start, end);

  // Cut a single clip using backend FFmpeg
  const executeCutClip = async (targetClip: ClipSegment) => {
    if (!currentSource) return;

    setIsCuttingAny(true);
    setClips((prev) =>
      prev.map((c) => (c.id === targetClip.id ? { ...c, status: 'processing', progress: 5, error: undefined } : c))
    );

    // Setup EventSource for real-time progress updates
    const sse = new EventSource(`/api/video/cut/progress?clipId=${targetClip.id}`);
    sse.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        if (update && update.id === targetClip.id) {
          setClips((prev) =>
            prev.map((c) =>
              c.id === targetClip.id
                ? {
                  ...c,
                  progress: update.progress ?? c.progress,
                  status: update.status ?? c.status,
                  outputFilename: update.outputFilename ?? c.outputFilename,
                  outputSize: update.outputSize ?? c.outputSize,
                  outputDuration: update.outputDuration ?? c.outputDuration,
                }
                : c
            )
          );
        }
      } catch {
        // ignore parse error
      }
    };

    try {
      const res = await fetch('/api/video/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: currentSource.id,
          sourceFilename: currentSource.filename,
          clips: [
            {
              id: targetClip.id,
              name: targetClip.name,
              startTime: targetClip.startTime,
              endTime: targetClip.endTime,
              aspectRatio: targetClip.aspectRatio,
              burnSubtitles: targetClip.burnSubtitles,
              production: targetClip.production,
            },
          ],
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success || !data.clips?.[0]) {
        throw new Error(data.error || 'Failed to cut clip');
      }

      const completed = data.clips[0] as ClipSegment;
      setClips((prev) => prev.map((c) => (c.id === targetClip.id ? completed : c)));
      refreshProjectCount();
      showNotification(completed.studioReport?.error ? `Clip "${completed.name}" generated, but the sound design step failed: ${completed.studioReport.error}` : `Clip "${completed.name}" generated successfully!`, completed.studioReport?.error ? 'error' : 'success');
      if (completed.studioReport) setStudioReport({ applied: completed.studioReport.applied, skipped: completed.studioReport.skipped });
      // Automatically pop up the completed clip in the independent preview modal
      setActiveModalClip(completed);
      setPreviewModalAutoPlay(true);
    } catch (err) {
      const errMsg = (err as Error).message || 'Cut error';
      setClips((prev) =>
        prev.map((c) => (c.id === targetClip.id ? { ...c, status: 'error', error: errMsg } : c))
      );
      showNotification(errMsg, 'error');
    } finally {
      sse.close();
      setIsCuttingAny(false);
    }
  };

  const handleCutClip = async (clipId: string) => {
    let targetClip = clips.find((c) => c.id === clipId);
    if (!targetClip && activeModalClip?.id === clipId) {
      targetClip = activeModalClip;
      setClips((prev) => [...prev, targetClip!]);
    }
    if (targetClip) {
      await executeCutClip(targetClip);
    }
  };

  // Cut all pending draft clips sequentially
  const handleCutAllClips = async () => {
    const pending = clips.filter((c) => c.status === 'draft' || c.status === 'error');
    for (const clip of pending) {
      await executeCutClip(clip);
    }
  };

  const handleDeleteClip = (clipId: string) => {
    if (activeModalClip?.id === clipId) {
      setActiveModalClip(null);
    }
    setClips((prev) => prev.filter((c) => c.id !== clipId));
  };

  const handleUpdateClipName = (clipId: string, newName: string) => {
    setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, name: newName } : c)));
  };

  // Run Content Intelligence Analysis
  const handleRunAnalysis = async (forceReanalyze = false) => {
    if (!currentSource) return;
    setIsAnalyzingContent(true);
    setAnalysisProgress({ percent: 12, stage: 'Scanning audio energy & speech dynamics (50x)...' });

    try {
      const res = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: currentSource.id,
          forceReanalyze,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to analyze video content');
      }

      setAnalysisReport(data.report);
      showNotification(`Discovered ${data.candidates.length} engaging candidate moments!`, 'success');
    } catch (err: any) {
      showNotification(err.message || 'Analysis error', 'error');
    } finally {
      setIsAnalyzingContent(false);
      setAnalysisProgress(null);
    }
  };

  // ---- Production settings: what the preview shows is what Export produces ----
  const buildProduction = (): ProductionSettings => ({
    platform,
    layout: framing.layout,
    framing: { mode: framing.mode, manualX: framing.manualX, zoom: framing.zoom, track: framing.mode === 'auto' ? framing.track : null },
    captions: captionsEnabled && transcript ? { ...captionStyle } : null,
    studio: studioExtras ?? undefined,
  });

  const newClip = (name: string, startTime: number, endTime: number, production?: ProductionSettings): ClipSegment => ({
    id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name, sourceId: currentSource!.id, startTime, endTime, production, status: 'draft', progress: 0, createdAt: Date.now(),
  });

  // EXPORT tab: produce the platform-ready file for the current selection
  const handleExportSelection = async () => {
    if (!requireValidSelection() || !currentSource) return;
    const clip = newClip(`Export #${clips.length + 1} (${PLATFORMS[platform].short})`, selection.start!, selection.end!, buildProduction());
    setClips((prev) => [...prev, clip]);
    setLatestExportId(clip.id);
    await executeCutClip(clip);
  };

  // ---- Creative Studio: AI Director ----
  useEffect(() => { fetch('/api/studio/identities').then((r) => r.json()).then((d) => d.success && setIdentities(d.identities)).catch(() => {}); }, [currentView]);

  const handleDirectorPlan = (plan: EditingPlan, meta: DirectorMeta | null) => { setDirectorPlan(plan); setDirectorMeta(meta); };
  // "Apply to editor": fill the existing Crop / Captions / Export state from the plan, so every setting stays editable.
  const handleApplyStudio = (r: ProduceResult) => {
    setPlatform(r.production.platform);
    setFraming((f) => ({ ...f, layout: r.production.layout, mode: r.production.framing.mode as FramingSettings['mode'], zoom: r.production.framing.zoom, }));
    setCaptionStyle(r.captionStyle);
    if (r.captionsEnabled) setCaptionsEnabled(true);
    setStudioExtras(r.production.studio ?? null);
    setStudioReport({ applied: r.applied, skipped: r.skipped });
    showNotification('Plan applied. Review Crop, Captions and Export, then export.');
  };
  // "Auto-produce": the server chose the moment and built the settings; render through the normal export flow.
  const handleProduceStudio = async (spec: { name: string; startTime: number; endTime: number; production: ProductionSettings }, report: { applied: string[]; skipped: string[] }) => {
    if (!currentSource) return;
    setStudioReport(report);
    setIsProducing(true);
    const clip = newClip(spec.name, spec.startTime, spec.endTime, spec.production);
    setClips((prev) => [...prev, clip]);
    setLatestExportId(clip.id);
    showNotification('Rendering your video…');
    try { await executeCutClip(clip); } finally { setIsProducing(false); }
  };
  const handleUseSound = (pick: SoundPick) => {
    setStudioExtras((prev) => ({
      ...prev,
      audioDesign: {
        mood: pick.mood as never, intensity: pick.intensity as never, music: true, musicVolume: prev?.audioDesign?.musicVolume ?? 0.15, soundEffects: prev?.audioDesign?.soundEffects ?? false,
        ducking: true, ending: prev?.audioDesign?.ending ?? 'none', seed: pick.seed, sfxCues: prev?.audioDesign?.sfxCues ?? [], grade: prev?.audioDesign?.grade ?? 'none', overrides: pick.overrides as never,
      },
    }));
    showNotification('Sound added to this video. It will be mixed in when you export.');
    setCurrentView('editor'); setEditorTab('director');
  };

  // ---- Moments actions ----
  const momentName = (m: CandidateMoment) => `${m.recommendedHook.english.slice(0, 40)} (Score ${m.score})`;
  const handlePreviewMoment = (m: CandidateMoment) => {
    if (!currentSource) return;
    handleOpenPreviewModal({ ...newClip(momentName(m), m.startTime, m.endTime), id: m.id }, true);
  };
  const handleEditMoment = (m: CandidateMoment) => {
    setSelection({ start: ms(m.startTime), end: ms(m.endTime) });
    seek(m.startTime);
    setEditorTab('trim');
    setCurrentView('editor');
  };
  const handleExportMoment = async (m: CandidateMoment) => {
    if (!currentSource) return;
    const clip = newClip(momentName(m), m.startTime, m.endTime, buildProduction());
    setClips((prev) => [...prev, clip]);
    showNotification(`Exporting for ${PLATFORMS[platform].short}…`);
    await executeCutClip(clip);
  };
  const handleQueueMoment = (m: CandidateMoment) => {
    if (!currentSource) return;
    setClips((prev) => [...prev, newClip(momentName(m), m.startTime, m.endTime, buildProduction())]);
    showNotification('Added to the Clips queue. Open Export to run it.');
  };
  const handleQueueMoments = (list: CandidateMoment[]) => {
    if (!currentSource || list.length === 0) return;
    setClips((prev) => [...prev, ...list.map((m) => newClip(momentName(m), m.startTime, m.endTime, buildProduction()))]);
    showNotification(`Added ${list.length} moments to the Clips queue.`);
  };
  const handlePlayRange = (start: number, end: number) => {
    setCurrentView('editor');
    beginPreview(start, end);
  };

  // ---- Transcript, scenes, tracking ----
  const handleGenerateTranscript = async () => {
    if (!currentSource) return;
    setIsTranscribing(true);
    try {
      const res = await fetch('/api/video/transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: currentSource.id, model: 'base' }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Transcription failed');
      setTranscript(data.transcript);
      showNotification('Transcript ready. Captions now use your speech.');
    } catch (err) {
      showNotification((err as Error).message, 'error');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleDetectScenes = async () => {
    if (!currentSource) return;
    setIsDetectingScenes(true);
    try {
      const res = await fetch('/api/video/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: currentSource.id }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Scene detection failed');
      setScenes(data.scenes);
      showNotification(`Found ${data.scenes.length} scene changes.`);
    } catch (err) {
      showNotification((err as Error).message, 'error');
    } finally {
      setIsDetectingScenes(false);
    }
  };

  // Auto Track range: the selection if there is one, otherwise 60s from the playhead
  const trackRange = validation.ok
    ? { start: selection.start!, end: selection.end! }
    : { start: currentTime, end: Math.min(duration, currentTime + 60) };
  const handleRunTrack = async () => {
    if (!currentSource) return;
    setTrackState({ status: 'running' });
    try {
      const res = await fetch('/api/video/framing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: currentSource.id, ...trackRange }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Tracking failed');
      setFraming((f) => ({ ...f, track: data.keyframes }));
      setTrackState({ status: 'done', faces: data.faces, range: trackRange });
    } catch (err) {
      setTrackState({ status: 'error', message: (err as Error).message });
    }
  };

  // Keyboard shortcuts (also listed in the Shortcuts dialog and in button tooltips)
  const kbRef = useRef({ handleCutSelection, handleAddClip, handlePlaySelection });
  kbRef.current = { handleCutSelection, handleAddClip, handlePlaySelection };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!currentSource || currentView !== 'editor') return;
      if (activeModalClip || isShortcutsOpen || isIngestionModalOpen) return;
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;

      // Works even while typing in a timestamp field
      if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        kbRef.current.handleCutSelection();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.code) {
        case 'KeyI': e.preventDefault(); handleMarkStart(); break;
        case 'KeyO': e.preventDefault(); handleMarkEnd(); break;
        case 'KeyP': e.preventDefault(); kbRef.current.handlePlaySelection(); break;
        case 'KeyX': e.preventDefault(); handleClearSelection(); break;
        case 'KeyR': e.preventDefault(); handleResetSelection(); break;
        case 'BracketLeft': if (selection.start !== null) { e.preventDefault(); seek(selection.start); } break;
        case 'BracketRight': if (selection.end !== null) { e.preventDefault(); seek(selection.end); } break;
        case 'Escape': if (preview) { e.preventDefault(); handleExitPreview(true); } break;
        case 'Enter':
          // Don't hijack Enter on a focused button/link (it would fire twice)
          if (!['BUTTON', 'A'].includes(el.tagName)) { e.preventDefault(); kbRef.current.handleAddClip(); }
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource, currentView, activeModalClip, isShortcutsOpen, isIngestionModalOpen, selection, preview, seek, handleMarkStart, handleMarkEnd, handleClearSelection, handleResetSelection]);

  // Load cached transcript + scenes whenever the video changes
  useEffect(() => {
    setTranscript(null);
    setScenes([]);
    setTrackState({ status: 'idle' });
    setFraming((f) => ({ ...f, track: null }));
    if (!currentSource) return;
    const id = encodeURIComponent(currentSource.id);
    fetch(`/api/video/transcript?sourceId=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.success && setTranscript(d.transcript)).catch(() => {});
    fetch(`/api/video/scenes?sourceId=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.success && setScenes(d.scenes)).catch(() => {});
  }, [currentSource?.id]);

  // Remember editor look & feel between sessions (per browser; storage may be unavailable)
  const settingsLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('content-ai:editor-settings:v1');
      if (raw) {
        const v = JSON.parse(raw);
        if (v.platform && PLATFORMS[v.platform as PlatformId]) setPlatform(v.platform);
        if (v.captionStyle) setCaptionStyle({ ...DEFAULT_CAPTION_STYLE, ...v.captionStyle });
        if (typeof v.captionsEnabled === 'boolean') setCaptionsEnabled(v.captionsEnabled);
        if (typeof v.showSafeAreas === 'boolean') setShowSafeAreas(v.showSafeAreas);
      }
    } catch { /* ignore */ }
    settingsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!settingsLoaded.current) return;
    try { localStorage.setItem('content-ai:editor-settings:v1', JSON.stringify({ platform, captionStyle, captionsEnabled, showSafeAreas })); } catch { /* ignore */ }
  }, [platform, captionStyle, captionsEnabled, showSafeAreas]);

  const captionWords = useMemo(() => (transcript ? toTimedWords(transcript.segments) : []), [transcript]);
  const transcriptInfo = transcript ? {
    language: transcript.language, segments: transcript.segments.length,
    dialects: transcript.african_context?.detected_african_dialects ?? [],
    reliability: transcript.segments.length ? transcriptReliability(transcript.segments) : null,
  } : null;
  const latestExport = clips.find((c) => c.id === latestExportId) ?? null;

  const filmstripUrl = currentSource ? `/api/video/filmstrip?sourceId=${encodeURIComponent(currentSource.id)}` : null;
  const latestCutClip = clips.find((c) => c.id === latestCutClipId) ?? null;

  const activeModalClipIndex = activeModalClip
    ? Math.max(1, clips.findIndex((c) => c.id === activeModalClip.id) + 1)
    : 1;

  return (
    <div className="min-h-screen text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border shadow-2xl text-xs sm:text-sm font-medium flex items-center gap-2 backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-3 ${notification.type === 'error'
              ? 'bg-red-950/80 border-red-800 text-red-200'
              : 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
            }`}
        >
          <span>{notification.message}</span>
        </div>
      )}

      {/* Top Header */}
      <Header
        editorTab={editorTab}
        onEditorTab={setEditorTab}
        exportCount={clips.length}
        currentSource={currentSource}
        currentView={currentView}
        projectCount={projectCount}
        activeIngestionJob={activeIngestionJob}
        onOpenIngestionModal={() => setIsIngestionModalOpen(true)}
        onSwitchView={setCurrentView}
        onImportNew={() => {
          setCurrentSource(null);
          setCurrentView('editor');
        }}
        onLoadSample={handleLoadSample}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        isLoadingSample={isLoadingSample}
      />

      {/* Main App Content */}
      <main className="flex-1 flex flex-col p-3 sm:p-5 max-w-[1700px] w-full mx-auto">
        {currentView === 'library' ? (
          /* Video Library View */
          <VideoLibrary
            onSelectProject={handleReopenProject}
            onNewImport={() => {
              setCurrentSource(null);
              setCurrentView('editor');
            }}
          />
        ) : currentView === 'radar' ? (
          <RadarWorkspace />
        ) : currentView === 'auto' ? (
          <AutoStudioWorkspace identities={identities.map((i) => ({ id: i.id, name: i.name }))} />
        ) : currentView === 'studio' ? (
          <StudioWorkspace onUseSound={handleUseSound} hasVideo={!!currentSource} />
        ) : currentView === 'moments' ? (
          <MomentsWorkspace
            source={currentSource}
            report={visibleReport}
            deletedCount={dismissedIds.length}
            onDelete={(m) => updateDismissed((ids) => [...ids, m.id])}
            onRestoreDeleted={() => updateDismissed(() => [])}
            isAnalyzing={isAnalyzingContent}
            analysisProgress={analysisProgress}
            onRunAnalysis={handleRunAnalysis}
            platform={platform}
            onPlatformChange={setPlatform}
            transcript={transcript}
            isTranscribing={isTranscribing}
            onGenerateTranscript={handleGenerateTranscript}
            onPreview={handlePreviewMoment}
            onEdit={handleEditMoment}
            onExport={handleExportMoment}
            onQueue={handleQueueMoment}
            onQueueAll={handleQueueMoments}
            onPlayRange={handlePlayRange}
            onOpenLibrary={() => setCurrentView('library')}
          />
        ) : !currentSource ? (
          /* Empty / Import View */
          <div className="flex-1 flex items-center justify-center">
            <ImportZone
              onVideoLoaded={handleVideoLoaded}
              onDuplicateDetected={handleDuplicateDetected}
              onStartYouTubeIngestion={startYouTubeIngestion}
              activeIngestionJob={activeIngestionJob}
              onOpenIngestionModal={() => setIsIngestionModalOpen(true)}
              onLoadSample={handleLoadSample}
              isLoadingSample={isLoadingSample}
            />
          </div>
        ) : (
          /* Editor workspace: Media | Trim | Crop | Captions | Style | Export */
          <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-w-0">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] gap-3 sm:gap-4 content-start">
              {/* Preview stage (single <video>, reshaped per platform) */}
              <section className="order-1 lg:order-2 flex flex-col gap-2.5 min-w-0">
                <div className="flex items-center justify-between gap-3 px-1">
                  <h1 className="text-sm sm:text-base font-semibold text-white truncate" title={currentSource.title}>{currentSource.title}</h1>
                  <span className="shrink-0 font-mono text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-1 tabular-nums">{formatTimecode(duration, false)} total</span>
                </div>
                <VideoPlayer
                  streamUrl={currentSource.streamUrl}
                  duration={duration}
                  fps={currentSource.metadata.fps}
                  sourceWidth={currentSource.metadata.width}
                  sourceHeight={currentSource.metadata.height}
                  currentTime={currentTime}
                  seekRequest={seekRequest}
                  preview={preview}
                  platform={platform}
                  onPlatformChange={setPlatform}
                  framing={framing}
                  onManualX={(x) => setFraming((f) => ({ ...f, mode: 'manual', manualX: x }))}
                  captions={{ enabled: captionsEnabled, style: captionStyle, words: captionWords }}
                  showSafeAreas={showSafeAreas}
                  onToggleSafeAreas={() => setShowSafeAreas((v) => !v)}
                  onTimeUpdate={setCurrentTime}
                  onSeek={seek}
                  onPreviewEnded={() => setPreview((p) => (p ? { ...p, ended: true } : p))}
                  onReplayPreview={() => preview && beginPreview(preview.start, preview.end)}
                  onExitPreview={handleExitPreview}
                />
              </section>

              {/* Timeline */}
              <section className="order-2 lg:order-3 lg:col-span-2 min-w-0">
                <Timeline
                  duration={duration}
                  currentTime={currentTime}
                  selection={selection}
                  clips={clips}
                  moments={visibleReport?.candidates ?? []}
                  filmstripUrl={filmstripUrl}
                  isPreviewing={!!preview}
                  waveform={analysisReport?.loudnessSamples}
                  captionSegments={transcript?.segments}
                  scenes={scenes}
                  onSeek={seek}
                  onStartChange={handleStartChange}
                  onEndChange={handleEndChange}
                  onRangeChange={handleRangeChange}
                  onMarkStart={handleMarkStart}
                  onMarkEnd={handleMarkEnd}
                  onClear={handleClearSelection}
                  onReset={handleResetSelection}
                  onPlaySelection={handlePlaySelection}
                  onPickMoment={handlePickMoment}
                />
              </section>

              {/* Contextual settings for the selected step */}
              <aside className="order-3 lg:order-1 lg:row-start-1 min-w-0">
                <div className="glass rounded-2xl p-4 lg:max-h-[calc(100vh-410px)] lg:min-h-[420px] overflow-y-auto">
                  {editorTab === 'media' && (
                    <MediaPanel
                      source={currentSource}
                      transcript={transcriptInfo}
                      isTranscribing={isTranscribing}
                      onGenerateTranscript={handleGenerateTranscript}
                      sceneCount={scenes.length}
                      isDetectingScenes={isDetectingScenes}
                      onDetectScenes={handleDetectScenes}
                    />
                  )}
                  {editorTab === 'trim' && (
                    <CutPanel
                      duration={duration}
                      currentTime={currentTime}
                      selection={selection}
                      onStartChange={handleStartChange}
                      onEndChange={handleEndChange}
                      onMarkStart={handleMarkStart}
                      onMarkEnd={handleMarkEnd}
                      onJump={seek}
                      onClear={handleClearSelection}
                      onReset={handleResetSelection}
                      onPreviewSelection={handlePlaySelection}
                      onPreviewEdge={handlePreviewEdge}
                      onCut={handleCutSelection}
                      onAddToQueue={handleAddClip}
                      latestClip={latestCutClip}
                      onOpenClip={(c) => handleOpenPreviewModal(c, true)}
                      onRetryClip={handleCutClip}
                      isPreviewing={!!preview}
                    />
                  )}
                  {editorTab === 'crop' && (
                    <CropPanel
                      framing={framing}
                      onChange={setFraming}
                      platform={PLATFORMS[platform]}
                      sourceIsLandscape={currentSource.metadata.width >= currentSource.metadata.height}
                      track={trackState}
                      onRunTrack={handleRunTrack}
                      trackRangeLabel={`${formatTimecode(trackRange.start, false)} → ${formatTimecode(trackRange.end, false)}${validation.ok ? ' (your selection)' : ' (60s from the playhead; select a segment in Trim to choose)'}`}
                    />
                  )}
                  {editorTab === 'captions' && (
                    <CaptionStudioPanel
                      enabled={captionsEnabled}
                      onEnabledChange={setCaptionsEnabled}
                      style={captionStyle}
                      onStyleChange={setCaptionStyle}
                      platform={PLATFORMS[platform]}
                      hasTranscript={!!transcript}
                      isTranscribing={isTranscribing}
                      onGenerateTranscript={handleGenerateTranscript}
                    />
                  )}
                  {editorTab === 'style' && (
                    <StylePanel platform={platform} onPlatformChange={setPlatform} showSafeAreas={showSafeAreas} onToggleSafeAreas={setShowSafeAreas} />
                  )}
                  {editorTab === 'director' && (
                    <DirectorPanel
                      sourceId={currentSource.id}
                      range={{ start: validation.ok ? selection.start : null, end: validation.ok ? selection.end : null }}
                      hasTranscript={!!transcript}
                      sceneTimes={scenes}
                      track={framing.track}
                      clipTitle={currentSource.title || 'Short'}
                      plan={directorPlan}
                      meta={directorMeta}
                      identityId={identityId}
                      identities={identities}
                      applied={studioReport}
                      isProducing={isProducing}
                      onIdentityChange={setIdentityId}
                      onPlan={handleDirectorPlan}
                      onApply={handleApplyStudio}
                      onProduce={handleProduceStudio}
                    />
                  )}
                  {editorTab === 'export' && (
                    <div className="flex flex-col gap-6">
                      <ExportPanel
                        platform={PLATFORMS[platform]}
                        framing={framing}
                        captionsEnabled={captionsEnabled}
                        hasTranscript={!!transcript}
                        rangeValid={validation.ok}
                        rangeDuration={validation.duration}
                        isExporting={latestExport?.status === 'processing'}
                        progress={latestExport?.progress ?? 0}
                        onExport={handleExportSelection}
                        customFontsAvailable={false}
                        onPlatformChange={setPlatform}
                        onLayoutChange={(layout) => setFraming((f) => ({ ...f, layout }))}
                      />
                      <div>
                        <div className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase mb-2">Clips</div>
                        <ClipManager
                          clips={clips}
                          onOpenPreviewModal={handleOpenPreviewModal}
                          onCutClip={handleCutClip}
                          onCutAllClips={handleCutAllClips}
                          onDeleteClip={handleDeleteClip}
                          onUpdateClipName={handleUpdateClipName}
                          isCuttingAny={isCuttingAny}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      {/* Dedicated Independent Clip Preview Modal */}
      <ClipPreviewModal
        clip={activeModalClip}
        clipIndex={activeModalClipIndex}
        originalStreamUrl={currentSource?.streamUrl || ''}
        sourceTitle={currentSource?.title}
        isOpen={!!activeModalClip}
        autoPlay={previewModalAutoPlay}
        onClose={() => setActiveModalClip(null)}
        onCutClip={handleCutClip}
        onDeleteClip={handleDeleteClip}
      />

      {/* Duplicate Project Detection Modal */}
      <DuplicateProjectModal
        isOpen={duplicateModal.isOpen}
        project={duplicateModal.project}
        clips={duplicateModal.clips}
        onReopen={handleReopenProject}
        onReimport={handleForceReimport}
        onCancel={() => setDuplicateModal({ isOpen: false, project: null, clips: [] })}
      />

      {/* Keyboard Shortcuts Dialog */}
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Real-time YouTube Video Ingestion Modal */}
      <IngestionProgressModal
        job={activeIngestionJob}
        isOpen={isIngestionModalOpen}
        onClose={() => setIsIngestionModalOpen(false)}
        onContinueInBackground={() => setIsIngestionModalOpen(false)}
        onRetry={(retryUrl) => startYouTubeIngestion(retryUrl, true, true)}
        onReady={(project) => {
          handleVideoLoaded(project);
          setIsIngestionModalOpen(false);
        }}
      />
    </div>
  );
}
