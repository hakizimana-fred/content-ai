import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { CLIPS_DIR, UPLOADS_DIR, initStorageDirs } from '@/lib/paths';
import { cutVideoSegment, probeVideo } from '@/lib/ffmpeg';
import { videoStore } from '@/lib/store';
import { getProjectById, upsertClip } from '@/lib/db';
import { ClipSegment, CutRequest } from '@/types/video';
import { validateSelection } from '@/lib/timecode';
import { buildAss } from '@/lib/editor/ass';
import { toTimedWords, DEFAULT_CAPTION_STYLE, CaptionStyle } from '@/lib/editor/captions';
import { FramingKeyframe } from '@/lib/editor/framing';
import { STORAGE_DIR } from '@/lib/paths';
import { getCachedTranscript, generateClipSRT } from '@/lib/intelligence/transcription-service';
import { applyAudioDesign } from '@/lib/studio/mix';
import { hasAudioWork } from '@/lib/studio/audio-spec';
import { composeAss } from '@/lib/studio/overlay';
import { logoFile } from '@/lib/studio/logo-store';
import { pickKeywords } from '@/lib/studio/keywords';
import { planRetime, retimeSegment } from '@/lib/studio/retime';
import { isIdentityMap, remapWords, remapTrack } from '@/lib/studio/pacing';

export async function POST(request: NextRequest) {
  try {
    initStorageDirs();

    const body: CutRequest = await request.json();
    const { sourceId, sourceFilename, clips } = body;

    if (!sourceId || !Array.isArray(clips) || clips.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Source ID and at least one clip are required.' },
        { status: 400 }
      );
    }

    let source = videoStore.getSource(sourceId);

    // Also check persistent database if not in memory
    if (!source || !fs.existsSync(source.localPath)) {
      const dbProject = getProjectById(sourceId);
      if (dbProject && fs.existsSync(dbProject.localPath)) {
        source = dbProject;
        videoStore.setSource(source);
      }
    }

    // If source still not found in memory, check uploads directory by filename
    if (!source || !fs.existsSync(source.localPath)) {
      const uploadFiles = fs.readdirSync(UPLOADS_DIR);
      const safeFilename = sourceFilename ? path.basename(sourceFilename) : undefined;
      const matched = uploadFiles.find(
        (f) =>
          (safeFilename && f === safeFilename) ||
          f.includes(sourceId) ||
          (sourceId === 'sample_video_default' && f === 'sample-preview.mp4')
      );

      if (matched) {
        const fullPath = path.join(UPLOADS_DIR, matched);
        const meta = await probeVideo(fullPath);
        source = {
          id: sourceId,
          title: matched,
          filename: matched,
          localPath: fullPath,
          streamUrl: `/api/video/stream?type=source&filename=${encodeURIComponent(matched)}`,
          metadata: meta,
          sourceOrigin: 'upload',
          createdAt: Date.now(),
        };
        videoStore.setSource(source);
      }
    }

    if (!source) {
      return NextResponse.json({ success: false, error: 'Source video not found.' }, { status: 404 });
    }

    const processedClips: ClipSegment[] = [];

    for (const clipData of clips) {
      // Strict validation: reject bad ranges instead of silently "fixing" them.
      const check = validateSelection(
        Number.isFinite(clipData.startTime) ? clipData.startTime : null,
        Number.isFinite(clipData.endTime) ? clipData.endTime : null,
        source.metadata.duration
      );
      if (!check.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid range for "${clipData.name || 'clip'}": ${check.startError || check.endError || check.rangeError}.`,
          },
          { status: 400 }
        );
      }
      const start = clipData.startTime;
      // Only absorbs sub-frame float drift already tolerated by validateSelection.
      const end = Math.min(source.metadata.duration, clipData.endTime);

      const clipId = clipData.id || `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const safeName = (clipData.name || 'Clip').replace(/[^a-zA-Z0-9_-]/g, '_');
      const outputFilename = `${clipId}_${safeName}.mp4`;
      const outputPath = path.join(CLIPS_DIR, outputFilename);
      const prod = clipData.production;
      // Production settings (from the Export tab) decide the output shape; legacy clips use aspectRatio.
      const canvasKind = prod?.studio?.canvas;
      const vertical = prod ? (prod.platform !== 'youtube' || !!canvasKind) : false;
      const canvas = canvasKind === 'square' ? { w: 1080, h: 1080 } : canvasKind === 'four_five' ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
      const sourceIsLandscape = source.metadata.width > source.metadata.height;
      const aspectRatio: 'original' | 'portrait_blur' | 'portrait_crop' = prod
        ? (vertical && sourceIsLandscape ? (prod.layout === 'fit' ? 'portrait_blur' : 'portrait_crop') : 'original')
        : clipData.aspectRatio || 'original';
      const burnSubtitles = prod ? !!prod.captions : !!clipData.burnSubtitles;

      const segment: ClipSegment = {
        id: clipId,
        name: clipData.name || 'Untitled Clip',
        sourceId,
        startTime: start,
        endTime: end,
        aspectRatio,
        burnSubtitles,
        status: 'processing',
        progress: 0,
        createdAt: Date.now(),
      };

      videoStore.setClip(segment);

      // Creative Studio pacing: silence removal / speed. The segment is retimed first (to a temp file) and everything tied to clip time
      // (captions, face-track, overlays) is remapped through the same time map, so nothing drifts. Failure falls back to the plain cut.
      let inputPath = source.localPath, cs = start, ce = end, retimedPath: string | undefined;
      let timeMap: import('@/lib/studio/pacing').TimeMap | undefined;
      const pacingNote: { applied?: string; error?: string } = {};
      const pc = prod?.studio?.pacing;
      if (pc && (pc.removeSilence || pc.speed !== 1)) {
        try {
          const { map } = await planRetime(source.localPath, start, end, { removeSilence: pc.removeSilence, speed: pc.speed });
          if (!isIdentityMap(map, end - start)) {
            retimedPath = path.join(os.tmpdir(), `${clipId}_retimed.mp4`);
            await retimeSegment(source.localPath, retimedPath, start, end, map);
            inputPath = retimedPath; cs = 0; ce = map.outDuration; timeMap = map;
            pacingNote.applied = `${pc.removeSilence ? `removed ${map.removedSeconds.toFixed(1)}s of silence` : ''}${pc.removeSilence && pc.speed !== 1 ? ', ' : ''}${pc.speed !== 1 ? `${pc.speed}× speed` : ''} (${(end - start).toFixed(1)}s → ${map.outDuration.toFixed(1)}s)`;
          } else pacingNote.applied = 'no silences long enough to remove; clip unchanged';
        } catch (e) {
          console.error(`Pacing failed for ${clipId}:`, e);
          pacingNote.error = `pacing skipped: ${(e as Error).message.slice(0, 200)}`;
          if (retimedPath && fs.existsSync(retimedPath)) { try { fs.unlinkSync(retimedPath); } catch { /* ignore */ } }
          retimedPath = undefined; timeMap = undefined; inputPath = source.localPath; cs = start; ce = end;
        }
      }

      // Check if transcript exists for subtitle burning or webvtt attachment
      const transcript = getCachedTranscript(sourceId);
      let tempSrtPath: string | undefined = undefined;

      let assPath: string | undefined;
      if (burnSubtitles && transcript) {
        if (prod?.captions) {
          // Styled captions: same style/words/position as the live preview.
          const outW = aspectRatio === 'original' ? source.metadata.width : canvas.w;
          const outH = aspectRatio === 'original' ? source.metadata.height : canvas.h;
          assPath = path.join(os.tmpdir(), `${clipId}_captions.ass`);
          const allWords = toTimedWords(transcript.segments);
          const clipWords = timeMap ? remapWords(allWords, timeMap, start) : allWords;
          // Keyword emphasis only looks at the words inside this clip, so a keyword is "important here", not "important in the whole video".
          const emphasis = prod.studio?.keywordHighlight ? pickKeywords(clipWords.filter((w) => w.end > cs && w.start < ce)) : undefined;
          fs.writeFileSync(assPath, buildAss({
            emphasis,
            words: clipWords,
            clipStart: cs, clipEnd: ce,
            style: { ...DEFAULT_CAPTION_STYLE, ...(prod.captions as Partial<CaptionStyle>) },
            platform: prod.platform, playResX: outW, playResY: outH,
          }), 'utf8');
        } else {
          tempSrtPath = path.join(os.tmpdir(), `${clipId}_temp.srt`);
          fs.writeFileSync(tempSrtPath, generateClipSRT(transcript, start, end), 'utf8');
        }
      }

      // Creative Studio: title card / end card / brand mark share the captions' ASS file (works without a transcript too).
      if (prod?.studio?.overlays) {
        const outW = aspectRatio === 'original' ? source.metadata.width : canvas.w;
        const outH = aspectRatio === 'original' ? source.metadata.height : canvas.h;
        const baseAss = assPath && fs.existsSync(assPath) ? fs.readFileSync(assPath, 'utf8') : null;
        const merged = composeAss(baseAss, prod.studio.overlays, outW, outH, ce - cs);
        if (merged) {
          assPath = assPath ?? path.join(os.tmpdir(), `${clipId}_captions.ass`);
          fs.writeFileSync(assPath, merged, 'utf8');
        }
      }

      // Framing: centre of the 9:16 window as an ffmpeg expression (static, or piecewise-linear over clip time).
      const cropOpts = prod && aspectRatio === 'portrait_crop' ? {
        zoom: Math.min(3, Math.max(1, prod.framing.zoom || 1)),
        centerExpr: framingExpr(timeMap && prod.framing.track ? { ...prod.framing, track: remapTrack(prod.framing.track, timeMap, start) } : prod.framing, cs, ce, source.metadata, canvas.w / canvas.h),
      } : undefined;
      const fontsDir = fs.existsSync(path.join(STORAGE_DIR, 'fonts')) ? path.join(STORAGE_DIR, 'fonts') : undefined;

      try {
        await cutVideoSegment({
          inputPath,
          outputPath,
          startTime: cs,
          endTime: ce,
          aspectRatio,
          subtitlesPath: tempSrtPath,
          assPath, fontsDir, crop: cropOpts, canvas,
          logo: prod?.studio?.logo && logoFile(prod.studio.logo.identityId) ? { path: logoFile(prod.studio.logo.identityId)!, corner: prod.studio.logo.corner } : undefined,
          onProgress: (percent) => {
            videoStore.updateClipProgress(clipId, percent);
          },
        });

        // Clean up temp srt if created
        for (const f of [tempSrtPath, assPath, retimedPath]) {
          if (f && fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
          }
        }

        // Creative Studio post-pass: music bed, SFX, ducking, loudness and optional colour grade. Video is stream-copied unless a
        // grade is requested. A failure here never fails the clip: the plain cut is kept and the reason is reported.
        let studioReport: ClipSegment['studioReport'];
        if (pacingNote.applied || pacingNote.error) studioReport = { applied: pacingNote.applied ? [`pacing: ${pacingNote.applied}`] : [], skipped: [], error: pacingNote.error };
        const design = prod?.studio?.audioDesign;
        if (design && hasAudioWork(design)) {
          try {
            const r = await applyAudioDesign(outputPath, design, path.join(STORAGE_DIR, 'studio', 'audio-cache'));
            studioReport = { applied: [...(studioReport?.applied ?? []), ...r.applied], skipped: r.skipped, ms: r.ms, error: studioReport?.error };
          } catch (designErr) {
            console.error(`Sound design failed for ${clipId}:`, designErr);
            studioReport = { applied: studioReport?.applied ?? [], skipped: [], error: (designErr as Error).message.slice(0, 300) };
          }
        }

        // Probe final cut video for accurate size and duration
        const clipMeta = await probeVideo(outputPath);

        const completedSegment: ClipSegment = {
          ...segment,
          status: 'completed',
          progress: 100,
          outputFilename,
          outputUrl: `/api/video/stream?type=clip&filename=${encodeURIComponent(outputFilename)}`,
          outputSize: clipMeta.size,
          outputDuration: clipMeta.duration,
          subtitlesUrl: transcript ? `/api/video/subtitles?clipId=${encodeURIComponent(clipId)}` : undefined,
          completedAt: Date.now(),
          studioReport,
        };

        videoStore.setClip(completedSegment);
        upsertClip(completedSegment);
        processedClips.push(completedSegment);
      } catch (cutErr) {
        console.error(`Error cutting clip ${clipId}:`, cutErr);
        const errorMsg = (cutErr as Error).message || 'FFmpeg extraction failed';
        if (retimedPath && fs.existsSync(retimedPath)) { try { fs.unlinkSync(retimedPath); } catch { /* ignore */ } }
        videoStore.failClip(clipId, errorMsg);
        segment.status = 'error';
        segment.error = errorMsg;
        processedClips.push(segment);
      }
    }

    return NextResponse.json({ success: true, clips: processedClips });
  } catch (err) {
    console.error('Cut API error:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to process clip cutting.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clipId = searchParams.get('clipId');
  const sourceId = searchParams.get('sourceId');

  if (clipId) {
    const clip = videoStore.getClip(clipId);
    if (!clip) return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
    return NextResponse.json({ success: true, clip });
  }

  if (sourceId) {
    const clips = videoStore.getClipsBySource(sourceId);
    return NextResponse.json({ success: true, clips });
  }

  return NextResponse.json({ success: false, error: 'clipId or sourceId is required' }, { status: 400 });
}

/** ffmpeg expression for the crop-window centre (fraction of source width) over CLIP time. */
function framingExpr(
  f: { mode: string; manualX: number; zoom: number; track?: { t: number; x: number }[] | null },
  start: number, end: number, meta: { width: number; height: number }, ratio = 9 / 16
): string {
  const zoom = Math.min(3, Math.max(1, f.zoom || 1));
  const wf = Math.min(1, (meta.height * ratio) / meta.width / zoom); // window width / source width
  const clampC = (c: number) => Math.min(1 - wf / 2, Math.max(wf / 2, c));
  switch (f.mode) {
    case 'left': return String(wf / 2);
    case 'right': return String(1 - wf / 2);
    case 'manual': return String(clampC(f.manualX));
    case 'auto': {
      const track = (f.track || []) as FramingKeyframe[];
      if (track.length === 0) return '0.5';
      // Re-base to clip time, thin to ~2 keyframes/second, keep the expression a manageable size.
      const pts = track.filter((k) => k.t >= start - 1 && k.t <= end + 1).map((k) => ({ t: +(k.t - start).toFixed(2), x: +clampC(k.x).toFixed(4) }));
      const thin = pts.filter((p, i) => i === 0 || i === pts.length - 1 || p.t - pts[i - 1].t >= 0.5 || false);
      const kept = thin.length > 240 ? thin.filter((_, i) => i % Math.ceil(thin.length / 240) === 0) : thin;
      if (kept.length === 0) return '0.5';
      if (kept.length === 1) return String(kept[0].x);
      let expr = String(kept[kept.length - 1].x);
      for (let i = kept.length - 2; i >= 0; i--) {
        const a = kept[i], b = kept[i + 1];
        expr = `if(lt(t,${b.t}),lerp(${a.x},${b.x},(t-${a.t})/${Math.max(0.01, b.t - a.t).toFixed(2)}),${expr})`;
      }
      return `if(lt(t,${kept[0].t}),${kept[0].x},${expr})`;
    }
    default: return '0.5';
  }
}
