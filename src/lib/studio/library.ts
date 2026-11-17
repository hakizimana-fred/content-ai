import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodeWav, type Stereo } from './dsp.ts';
import { SOUND_CATEGORIES, SOUND_LICENSE, RECIPES, musicBpm, type Mood } from './sonic.ts';
import { studioPath } from './settings.ts';
import { studioDb } from './studio-db.ts';

/** License record per asset. Generated tracks use SOUND_LICENSE; imported tracks carry whatever terms the user recorded (never assumed). */
export interface AssetLicense { license: string; commercialOk: boolean | null; attribution: string; thirdPartySamples: boolean; note: string; source?: string }
export interface LibraryItem {
  id: string; kind: 'music' | 'sfx'; label: string; mood?: string; intensity?: string; sfx?: string; seed: number; seconds: number;
  prompt?: string; overrides?: Record<string, unknown>; createdAt: number; renderMs: number; license: AssetLicense;
  /** Imported (user-supplied) track: stored with its original extension and user-entered metadata. */
  /** Composed from several style ingredients: which, what character, how they were combined, and the set (group) it was generated with. */
  styles?: string[]; character?: string; group?: string; arrangement?: { notes: string[]; contributions: Record<string, string>; bpm: number; leader: string };
  /** The musical form of a duration-aware composition: its sections with timings, and any intro/outro padding that was requested. */
  structure?: { sections: string[]; introPadSec?: number; outroPadSec?: number };
  imported?: boolean; ext?: string; genre?: string; bpm?: number; beatOffset?: number; energy?: 'low' | 'medium' | 'high'; description?: string;
}
/** What the Sound Library shows: stored fields plus derived tempo/energy/genre/description for generated tracks. */
export interface LibraryEntry extends LibraryItem { tempo: number | null; energyLevel: 'low' | 'medium' | 'high'; genreLabel: string; descriptionText: string; favourite: boolean; durationSeconds: number }

const dir = () => { const d = studioPath('library'); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (id: string) => /^[a-f0-9]{16}$/.test(id);

export function saveItem(audio: Stereo, meta: Omit<LibraryItem, 'id' | 'createdAt' | 'license'>): LibraryItem {
  const id = crypto.createHash('sha1').update(JSON.stringify({ ...meta, renderMs: 0 })).digest('hex').slice(0, 16);
  const item: LibraryItem = { ...meta, id, createdAt: Date.now(), license: { ...SOUND_LICENSE } };
  fs.writeFileSync(path.join(dir(), `${id}.wav`), encodeWav(audio));
  studioDb().prepare('INSERT INTO library (id, kind, json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at').run(id, item.kind, JSON.stringify(item), item.createdAt);
  return item;
}
export function listItems(): LibraryItem[] {
  return studioDb().prepare('SELECT json FROM library ORDER BY created_at DESC').all().map((r) => JSON.parse(r.json as string) as LibraryItem);
}
const ALLOWED_EXT = new Set(['wav', 'mp3', 'm4a', 'ogg', 'flac']);
export const MIME_OF: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac' };
export function getItem(id: string): LibraryItem | null { if (!safe(id)) return null; const r = studioDb().prepare('SELECT json FROM library WHERE id = ?').get(id); return r ? JSON.parse(r.json as string) as LibraryItem : null; }
/** Path of the playable audio for any library item (generated WAV or imported file), or null. */
export function audioFile(id: string): { path: string; ext: string } | null {
  const it = getItem(id); const ext = it?.ext && ALLOWED_EXT.has(it.ext) ? it.ext : 'wav'; if (!safe(id)) return null;
  const p = path.join(dir(), `${id}.${ext}`); return fs.existsSync(p) ? { path: p, ext } : null;
}
export function wavPath(id: string): string | null { if (!safe(id)) return null; const p = path.join(dir(), `${id}.wav`); return fs.existsSync(p) ? p : null; }
export function deleteItem(id: string): boolean {
  if (!safe(id)) return false;
  const row = studioDb().prepare('DELETE FROM library WHERE id = ?').run(id) as { changes: number | bigint };
  let removed = Number(row.changes) > 0;
  for (const e of ALLOWED_EXT) { const p = path.join(dir(), `${id}.${e}`); if (fs.existsSync(p)) { fs.unlinkSync(p); removed = true; } }
  studioDb().prepare('DELETE FROM favourites WHERE id = ?').run(id);
  return removed;
}

/** One heavy render at a time (low-resource machines). */
let busy = false;
export async function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('BUSY');
  busy = true; try { return await fn(); } finally { busy = false; }
}
export function limitsForTier(tier: 'low' | 'standard' | 'high') {
  // a 90 s structured piece renders in roughly 13 s on a 4-core laptop, so even the low tier can compose a full 90 s advert soundtrack
  return tier === 'low' ? { maxSeconds: 90, maxVariations: 2 } : tier === 'standard' ? { maxSeconds: 120, maxVariations: 4 } : { maxSeconds: 180, maxVariations: 6 };
}

export function favouriteIds(): Set<string> { return new Set(studioDb().prepare('SELECT id FROM favourites').all().map((r) => r.id as string)); }
export function setFavourite(id: string, on: boolean): boolean {
  if (!getItem(id)) return false;
  if (on) studioDb().prepare('INSERT OR IGNORE INTO favourites (id, created_at) VALUES (?, ?)').run(id, Date.now()); else studioDb().prepare('DELETE FROM favourites WHERE id = ?').run(id);
  return true;
}

const GENRE_OF: Record<string, string> = { cinematic: 'Cinematic', corporate: 'Corporate', luxury: 'Luxury / ambient', documentary: 'Documentary', suspense: 'Suspense', inspirational: 'Inspirational', electronic: 'Electronic', african_fusion: 'African fusion', minimal: 'Minimal ambient', technology: 'Technology', comedy: 'Comedy', emotional: 'Emotional / piano', advertising: 'Commercial advertising', news_editorial: 'News & editorial', travel: 'Travel / atmospheric', social: 'Social media' };
export function enrich(it: LibraryItem, fav: Set<string>): LibraryEntry {
  const mood = it.mood as Exclude<Mood, 'none'> | undefined, rc = mood && RECIPES[mood] ? RECIPES[mood] : null;
  const tempo = it.bpm ?? (rc && it.kind === 'music' && !it.imported ? Math.round(musicBpm(mood!, it.seed, (it.overrides ?? undefined) as never) * 10) / 10 : null);
  const rcx = (it.overrides as { percLevel?: number; bpm?: number } | undefined) ?? {}; const energyScore = rc ? (((rcx.percLevel ?? rc.percLevel)) * 0.5 + (((rcx.bpm ?? rc.bpm)) - 60) / 100 * 0.5) * (it.intensity === 'high' ? 1.25 : it.intensity === 'low' ? 0.7 : 1) : 0.5;
  const energyLevel = it.energy ?? (energyScore > 0.62 ? 'high' : energyScore > 0.38 ? 'medium' : 'low');
  const cat = SOUND_CATEGORIES.find((c) => c.id === mood);
  return { ...it, tempo, energyLevel, genreLabel: it.genre ?? (it.styles?.length ? it.styles.join(' + ') : mood ? GENRE_OF[mood] ?? mood : it.imported ? 'Imported' : 'Sound effect'),
    descriptionText: it.description ?? (it.prompt ? `Generated from: "${it.prompt}"` : cat?.description ?? ''), favourite: fav.has(it.id), durationSeconds: it.seconds };
}
export function listEntries(): LibraryEntry[] { const fav = favouriteIds(); return listItems().map((i) => enrich(i, fav)); }

/** Add a user-supplied track. The licence fields are REQUIRED and stored as given: nothing is assumed commercially usable. */
export function importTrack(data: Buffer, ext: string, meta: { label: string; genre?: string; mood?: string; description?: string; seconds: number; bpm?: number; beatOffset?: number; energy?: 'low' | 'medium' | 'high'; license: AssetLicense }): LibraryItem {
  if (!ALLOWED_EXT.has(ext)) throw new Error('Unsupported audio type.');
  const id = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
  const item: LibraryItem = { id, kind: 'music', label: meta.label.slice(0, 80), mood: meta.mood, seed: 0, seconds: Math.round(meta.seconds * 10) / 10, createdAt: Date.now(), renderMs: 0, imported: true, ext,
    genre: meta.genre?.slice(0, 40), description: meta.description?.slice(0, 300), bpm: meta.bpm, beatOffset: meta.beatOffset, energy: meta.energy, license: meta.license };
  fs.writeFileSync(path.join(dir(), `${id}.${ext}`), data);
  studioDb().prepare('INSERT INTO library (id, kind, json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(id, 'music', JSON.stringify(item), item.createdAt);
  return item;
}
