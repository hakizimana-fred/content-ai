import path from 'path';
import fs from 'fs';

export const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
export const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
export const CLIPS_DIR = path.join(STORAGE_DIR, 'clips');
export const THUMBS_DIR = path.join(STORAGE_DIR, 'thumbs');

// Ensure directories exist
export function initStorageDirs(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(THUMBS_DIR)) {
    fs.mkdirSync(THUMBS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }
}

// Sanitize filename to prevent directory traversal
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function isSafePath(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
