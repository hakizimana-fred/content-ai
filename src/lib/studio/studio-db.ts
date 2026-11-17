import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_DIR, studioPath } from './settings.ts';

/**
 * SQLite store for Creative Studio metadata (identities, sound library, settings). The app's existing database.json is untouched.
 * Uses Node's built-in node:sqlite (no dependency). Loaded via process.getBuiltinModule so bundlers never try to resolve it.
 * On first open, legacy JSON files from the earlier JSON-based store are imported and kept as *.migrated.
 */
type Row = Record<string, unknown>;
interface Stmt { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] }
export interface Db { exec(sql: string): void; prepare(sql: string): Stmt; close(): void }

const g = globalThis as unknown as { __studioDb?: { path: string; db: Db } };

function open(file: string): Db {
  const sqlite = (process as unknown as { getBuiltinModule(id: string): { DatabaseSync: new (p: string) => Db } }).getBuiltinModule('node:sqlite');
  if (!sqlite) throw new Error('This Node.js version has no built-in SQLite (needs Node 22.5+).');
  const db = new sqlite.DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, kind TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auto_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS favourites (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}

function migrate(db: Db) {
  const rename = (f: string) => { try { fs.renameSync(f, f + '.migrated'); } catch { /* best effort */ } };
  const idf = path.join(STUDIO_DIR, 'identities.json');
  if (fs.existsSync(idf)) {
    try {
      const list = (JSON.parse(fs.readFileSync(idf, 'utf-8')).identities ?? []) as { id: string; name: string; createdAt: number; updatedAt: number }[];
      const ins = db.prepare('INSERT OR IGNORE INTO identities (id, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const i of list) ins.run(i.id, i.name, JSON.stringify(i), i.createdAt, i.updatedAt);
      rename(idf);
    } catch (e) { console.error('Studio: identities.json migration failed, left in place:', e); }
  }
  const sf = path.join(STUDIO_DIR, 'settings.json');
  if (fs.existsSync(sf)) {
    try {
      const o = JSON.parse(fs.readFileSync(sf, 'utf-8')) as Record<string, string>;
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string') ins.run(k, v);
      rename(sf);
    } catch (e) { console.error('Studio: settings.json migration failed, left in place:', e); }
  }
  const lib = path.join(STUDIO_DIR, 'library');
  if (fs.existsSync(lib)) {
    const ins = db.prepare('INSERT OR IGNORE INTO library (id, kind, json, created_at) VALUES (?, ?, ?, ?)');
    for (const f of fs.readdirSync(lib).filter((x) => x.endsWith('.json'))) {
      try { const it = JSON.parse(fs.readFileSync(path.join(lib, f), 'utf-8')); ins.run(it.id, it.kind, JSON.stringify(it), it.createdAt); rename(path.join(lib, f)); }
      catch (e) { console.error(`Studio: library sidecar ${f} migration failed, left in place:`, e); }
    }
  }
}

export function studioDb(): Db {
  const file = studioPath('studio.db');
  if (g.__studioDb && g.__studioDb.path === file) return g.__studioDb.db;
  g.__studioDb?.db.close();
  const db = open(file);
  migrate(db);
  g.__studioDb = { path: file, db };
  return db;
}

export function closeStudioDb() { g.__studioDb?.db.close(); g.__studioDb = undefined; }
