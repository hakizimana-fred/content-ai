import fs from 'node:fs';
import path from 'node:path';
import { studioDb } from './studio-db.ts';

/** Local, offline data for the Creative Studio lives under <repo>/storage/studio (same place as the rest of the app's data). */
export const STUDIO_DIR = process.env.STUDIO_DATA_DIR || path.resolve(process.cwd(), 'storage', 'studio');
export function studioPath(...p: string[]): string { fs.mkdirSync(STUDIO_DIR, { recursive: true }); return path.join(STUDIO_DIR, ...p); }

/** Atomic JSON write (temp file + rename), same approach as the main database. */
export function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}
export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as T; } catch { return fallback; }
}

const KEY = 'preferredPlanner';
export function getPreferredPlannerId(): string | null {
  return (studioDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY)?.value as string | undefined) ?? null;
}
export function setPreferredPlannerId(id: string) {
  studioDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, id);
}
