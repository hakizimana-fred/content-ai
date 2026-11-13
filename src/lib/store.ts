import { VideoSource, ClipSegment, VideoProject } from '@/types/video';
import {
  getProjectById,
  upsertProject,
  getClipsByProjectId,
  upsertClip,
  deleteClip as dbDeleteClip,
} from './db';

// In-memory data store for server runtime with persistent DB backing
class VideoStore {
  private sources: Map<string, VideoSource> = new Map();
  private clips: Map<string, ClipSegment> = new Map();

  // Source operations
  setSource(source: VideoSource): void {
    this.sources.set(source.id, source);
    try {
      upsertProject(source as VideoProject);
    } catch (e) {
      console.error('Failed to persist project to DB:', e);
    }
  }

  getSource(id: string): VideoSource | undefined {
    let source = this.sources.get(id);
    if (!source) {
      const persisted = getProjectById(id);
      if (persisted) {
        source = persisted;
        this.sources.set(id, persisted);
      }
    }
    return source;
  }

  getAllSources(): VideoSource[] {
    return Array.from(this.sources.values());
  }

  // Clip operations
  setClip(clip: ClipSegment): void {
    this.clips.set(clip.id, clip);
    try {
      upsertClip(clip);
    } catch (e) {
      console.error('Failed to persist clip to DB:', e);
    }
  }

  getClip(id: string): ClipSegment | undefined {
    let clip = this.clips.get(id);
    if (!clip) {
      const dbClips = getClipsByProjectId(id);
      if (dbClips.length > 0) {
        clip = dbClips[0];
        this.clips.set(id, clip);
      }
    }
    return clip;
  }

  getClipsBySource(sourceId: string): ClipSegment[] {
    const memClips = Array.from(this.clips.values()).filter((c) => c.sourceId === sourceId);
    if (memClips.length > 0) return memClips;
    return getClipsByProjectId(sourceId);
  }

  updateClipProgress(id: string, progress: number, status?: ClipSegment['status']): void {
    const clip = this.clips.get(id);
    if (clip) {
      clip.progress = progress;
      if (status) clip.status = status;
      this.clips.set(id, { ...clip });
    }
  }

  completeClip(id: string, data: Partial<ClipSegment>): void {
    const clip = this.clips.get(id);
    if (clip) {
      Object.assign(clip, {
        status: 'completed',
        progress: 100,
        completedAt: Date.now(),
        ...data,
      });
      this.clips.set(id, { ...clip });
      try {
        upsertClip(clip);
      } catch (e) {
        console.error('Failed to persist completed clip:', e);
      }
    }
  }

  failClip(id: string, error: string): void {
    const clip = this.clips.get(id);
    if (clip) {
      clip.status = 'error';
      clip.error = error;
      this.clips.set(id, { ...clip });
      try {
        upsertClip(clip);
      } catch (e) {
        console.error('Failed to persist failed clip:', e);
      }
    }
  }

  removeClip(id: string): void {
    this.clips.delete(id);
    try {
      dbDeleteClip(id);
    } catch (e) {
      console.error('Failed to delete clip from DB:', e);
    }
  }
}

// Global singleton across Next.js API calls in dev and prod
const globalForStore = globalThis as unknown as { videoStore?: VideoStore };
export const videoStore = globalForStore.videoStore || new VideoStore();
if (process.env.NODE_ENV !== 'production') globalForStore.videoStore = videoStore;
