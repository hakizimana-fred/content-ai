import fs from 'fs';
import path from 'path';
import { STORAGE_DIR, initStorageDirs } from './paths';
import { VideoProject, ClipSegment, IngestionJob } from '@/types/video';
import { ContentAnalysisReport } from '@/lib/intelligence/types';

const DB_PATH = path.join(STORAGE_DIR, 'database.json');

interface DatabaseSchema {
  projects: Record<string, VideoProject>;
  clips: Record<string, ClipSegment>;
  jobs?: Record<string, IngestionJob>;
  reports?: Record<string, ContentAnalysisReport>;
  version: number;
}

let dbCache: DatabaseSchema | null = null;

function loadDb(): DatabaseSchema {
  initStorageDirs();
  if (dbCache) return dbCache;

  if (fs.existsSync(DB_PATH)) {
    try {
      const content = fs.readFileSync(DB_PATH, 'utf-8');
      dbCache = JSON.parse(content);
      if (!dbCache?.projects || !dbCache?.clips) {
        dbCache = { projects: {}, clips: {}, jobs: {}, reports: {}, version: 1 };
      }
      if (!dbCache.jobs) {
        dbCache.jobs = {};
      }
      if (!dbCache.reports) {
        dbCache.reports = {};
      }
      return dbCache;
    } catch (e) {
      console.error('Error reading database file, initializing fresh:', e);
    }
  }

  dbCache = { projects: {}, clips: {}, jobs: {}, reports: {}, version: 1 };
  saveDb(dbCache);
  return dbCache;
}

function saveDb(data: DatabaseSchema): void {
  initStorageDirs();
  dbCache = data;
  const tempPath = `${DB_PATH}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error('Failed to save database atomically:', err);
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }
}

export function getAllProjects(options?: {
  search?: string;
  sortBy?: 'updated' | 'created' | 'clips' | 'duration' | 'title';
  sortOrder?: 'asc' | 'desc';
}): VideoProject[] {
  const db = loadDb();
  let projects = Object.values(db.projects);

  // Compute clips metrics & availability
  projects = projects.map((p) => {
    const projectClips = Object.values(db.clips).filter((c) => c.sourceId === p.id);
    const completedClips = projectClips.filter((c) => c.status === 'completed');
    const isAvailable = fs.existsSync(p.localPath);

    return {
      ...p,
      clipCount: projectClips.length,
      completedClipCount: completedClips.length,
      isAvailable,
    };
  });

  // Filter by search
  if (options?.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase();
    projects = projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.youtubeVideoId && p.youtubeVideoId.toLowerCase().includes(q)) ||
        (p.youtubeUrl && p.youtubeUrl.toLowerCase().includes(q))
    );
  }

  // Sort
  const sortBy = options?.sortBy || 'updated';
  const order = options?.sortOrder === 'asc' ? 1 : -1;

  projects.sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title) * order;
    }
    if (sortBy === 'created') {
      return (a.createdAt - b.createdAt) * order;
    }
    if (sortBy === 'clips') {
      return ((a.clipCount || 0) - (b.clipCount || 0)) * order;
    }
    if (sortBy === 'duration') {
      return (a.metadata.duration - b.metadata.duration) * order;
    }
    // Default 'updated'
    return ((a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt)) * order;
  });

  return projects;
}

export function getProjectById(id: string): VideoProject | null {
  const db = loadDb();
  const project = db.projects[id];
  if (!project) return null;

  const projectClips = Object.values(db.clips).filter((c) => c.sourceId === id);
  const completedClips = projectClips.filter((c) => c.status === 'completed');
  const isAvailable = fs.existsSync(project.localPath);

  return {
    ...project,
    clipCount: projectClips.length,
    completedClipCount: completedClips.length,
    isAvailable,
  };
}

export function getProjectByYouTubeId(youtubeVideoId: string): VideoProject | null {
  if (!youtubeVideoId) return null;
  const db = loadDb();
  const cleanId = youtubeVideoId.trim();
  const project = Object.values(db.projects).find((p) => p.youtubeVideoId === cleanId);
  if (!project) return null;

  return getProjectById(project.id);
}

export function upsertProject(project: VideoProject): VideoProject {
  const db = loadDb();
  const now = Date.now();

  const existing = db.projects[project.id];
  const updated: VideoProject = {
    ...project,
    createdAt: existing?.createdAt || project.createdAt || now,
    updatedAt: now,
  };

  db.projects[project.id] = updated;
  saveDb(db);
  return updated;
}

export function deleteProject(id: string, deleteMedia = false): boolean {
  const db = loadDb();
  const project = db.projects[id];
  if (!project) return false;

  // Optionally delete files from disk
  if (deleteMedia && fs.existsSync(project.localPath)) {
    try {
      fs.unlinkSync(project.localPath);
    } catch {
      // ignore
    }
  }

  // Delete associated clips
  const clipIds = Object.values(db.clips)
    .filter((c) => c.sourceId === id)
    .map((c) => c.id);

  for (const cid of clipIds) {
    delete db.clips[cid];
  }

  delete db.projects[id];
  saveDb(db);
  return true;
}

export function getClipById(clipId: string): ClipSegment | null {
  const db = loadDb();
  return db.clips[clipId] || null;
}

export function getClipsByProjectId(projectId: string): ClipSegment[] {
  const db = loadDb();
  return Object.values(db.clips)
    .filter((c) => c.sourceId === projectId)
    .sort((a, b) => a.startTime - b.startTime);
}

export function upsertClip(clip: ClipSegment): ClipSegment {
  const db = loadDb();
  db.clips[clip.id] = { ...clip };

  // Also touch parent project updatedAt
  if (db.projects[clip.sourceId]) {
    db.projects[clip.sourceId].updatedAt = Date.now();
  }

  saveDb(db);
  return clip;
}

export function deleteClip(clipId: string): boolean {
  const db = loadDb();
  if (!db.clips[clipId]) return false;
  const sourceId = db.clips[clipId].sourceId;

  delete db.clips[clipId];

  if (db.projects[sourceId]) {
    db.projects[sourceId].updatedAt = Date.now();
  }

  saveDb(db);
  return true;
}

// Ingestion Jobs Management
export function getIngestionJob(jobId: string): IngestionJob | null {
  const db = loadDb();
  return db.jobs?.[jobId] || null;
}

export function getLatestActiveIngestionJob(): IngestionJob | null {
  const db = loadDb();
  if (!db.jobs) return null;
  const activeJobs = Object.values(db.jobs).filter((j) => j.status === 'processing');
  if (activeJobs.length === 0) return null;
  activeJobs.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return activeJobs[0];
}

export function upsertIngestionJob(job: IngestionJob): IngestionJob {
  const db = loadDb();
  if (!db.jobs) db.jobs = {};
  db.jobs[job.id] = { ...job, lastActivityAt: Date.now() };
  saveDb(db);
  return db.jobs[job.id];
}

export function deleteIngestionJob(jobId: string): boolean {
  const db = loadDb();
  if (!db.jobs || !db.jobs[jobId]) return false;
  delete db.jobs[jobId];
  saveDb(db);
  return true;
}

// Content Intelligence Analysis Reports Management
export function getContentAnalysisReport(sourceId: string): ContentAnalysisReport | null {
  const db = loadDb();
  return db.reports?.[sourceId] || null;
}

export function upsertContentAnalysisReport(report: ContentAnalysisReport): ContentAnalysisReport {
  const db = loadDb();
  if (!db.reports) db.reports = {};
  db.reports[report.sourceId] = report;
  saveDb(db);
  return report;
}

export function deleteContentAnalysisReport(sourceId: string): boolean {
  const db = loadDb();
  if (!db.reports || !db.reports[sourceId]) return false;
  delete db.reports[sourceId];
  saveDb(db);
  return true;
}
