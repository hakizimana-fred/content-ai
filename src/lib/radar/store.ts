import fs from 'fs';
import path from 'path';
import { STORAGE_DIR, initStorageDirs } from '../paths';
import type { Creator, CreatorPermission, AuditEntry, LiveInfo, LiveSession, RadarNotification } from '../../types/radar';
import { bus } from './events';
import { validateGrant, normalizeUsername } from './permissions';

const PATH = path.join(STORAGE_DIR, 'radar.json');
interface Schema { creators: Record<string, Creator>; sessions: Record<string, LiveSession>; notifications: RadarNotification[]; version: 1 }

// Next.js can bundle this module more than once (route handlers vs instrumentation), so the cache lives on globalThis:
// every copy must see the SAME in-memory database or one would overwrite the other's writes.
const g = globalThis as unknown as { __radarDb?: Schema | null; __radarSaveTimer?: ReturnType<typeof setTimeout> | null };

function load(): Schema {
  if (g.__radarDb) return g.__radarDb;
  initStorageDirs();
  let db: Schema | null = null;
  try { db = JSON.parse(fs.readFileSync(PATH, 'utf-8')); } catch { db = null; }
  if (!db?.creators) db = { creators: {}, sessions: {}, notifications: [], version: 1 };
  db.sessions ??= {}; db.notifications ??= [];
  for (const c of Object.values(db.creators)) c.live ??= { state: 'unknown' };
  g.__radarDb = db;
  return db;
}
function save() {
  if (g.__radarSaveTimer) { clearTimeout(g.__radarSaveTimer); g.__radarSaveTimer = null; }
  const tmp = `${PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(g.__radarDb, null, 2), 'utf-8');
  fs.renameSync(tmp, PATH);
}
/** Debounced save for high-frequency, low-value writes (e.g. "checked at"). Call flushStore() on shutdown. */
function saveSoon() { if (!g.__radarSaveTimer) g.__radarSaveTimer = setTimeout(() => { try { save(); } catch (e) { console.error('[radar] save failed', e); } }, 2000); }
export function flushStore() { if (g.__radarDb) save(); }
/** Test helper: forget the in-memory copy so the next call re-reads the file (simulates a process restart). */
export function _resetStoreCacheForTests() { if (g.__radarSaveTimer) { clearTimeout(g.__radarSaveTimer); g.__radarSaveTimer = null; } g.__radarDb = null; }
const now = () => new Date().toISOString();
const log = (c: Creator, action: string, detail?: string) => { const e: AuditEntry = { at: now(), action, detail }; c.audit.unshift(e); c.audit = c.audit.slice(0, 200); };

export const listCreators = (): Creator[] => Object.values(load().creators).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getCreator = (id: string): Creator | undefined => load().creators[id];

export interface NewCreator { username: string; displayName?: string; avatarUrl?: string; language?: string; category?: string; group?: string; notes?: string; channels?: string[] }

export function addCreator(input: NewCreator): { ok: true; creator: Creator } | { ok: false; error: string; status: number } {
  const n = normalizeUsername(input.username);
  if (!n.ok) return { ok: false, error: n.error, status: 400 };
  const db = load();
  if (Object.values(db.creators).some((c) => c.username === n.username && c.platform === 'tiktok')) return { ok: false, error: `@${n.username} is already added.`, status: 409 };
  const t = now();
  const c: Creator = {
    id: `cr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    platform: 'tiktok', username: n.username,
    displayName: input.displayName?.trim() || n.username,
    avatarUrl: input.avatarUrl?.trim() || undefined,
    language: input.language?.trim() || 'Unknown', category: input.category?.trim() || 'General',
    group: input.group?.trim() || undefined, monitoring: 'active', notify: true,
    channels: input.channels ?? [], notes: input.notes?.trim() || undefined,
    live: { state: 'unknown' }, audit: [], createdAt: t, updatedAt: t,
  };
  log(c, 'Creator added');
  db.creators[c.id] = c; save();
  bus.publish({ type: 'creator-updated', creator: c }); bus.kick(c.id);   // new creators are monitored automatically
  return { ok: true, creator: c };
}

export type CreatorPatch = Partial<Pick<Creator, 'displayName' | 'avatarUrl' | 'language' | 'category' | 'group' | 'monitoring' | 'notify' | 'channels' | 'notes'>>;

export function updateCreator(id: string, patch: CreatorPatch): Creator | undefined {
  const c = load().creators[id]; if (!c) return undefined;
  const changed: string[] = [];
  for (const k of ['displayName', 'avatarUrl', 'language', 'category', 'group', 'monitoring', 'notify', 'channels', 'notes'] as const) {
    if (k in patch && JSON.stringify(patch[k]) !== JSON.stringify(c[k])) { (c as unknown as Record<string, unknown>)[k] = patch[k] === '' ? undefined : patch[k]; changed.push(k); }
  }
  if (changed.length) { log(c, patch.monitoring && changed.includes('monitoring') ? `Monitoring ${patch.monitoring === 'paused' ? 'paused' : 'resumed'}` : 'Profile updated', changed.join(', ')); c.updatedAt = now(); save(); bus.publish({ type: 'creator-updated', creator: c }); if (changed.includes('monitoring') && c.monitoring === 'active') bus.kick(c.id); }
  return c;
}

export function removeCreator(id: string): boolean {
  const db = load(); if (!db.creators[id]) return false;
  delete db.creators[id];
  for (const sid of Object.keys(db.sessions)) if (db.sessions[sid].creatorId === id) delete db.sessions[sid];
  save(); bus.publish({ type: 'creator-removed', id }); return true;
}

export function grantPermission(id: string, input: Partial<CreatorPermission>): { ok: true; creator: Creator } | { ok: false; error: string; status: number } {
  const c = load().creators[id]; if (!c) return { ok: false, error: 'Creator not found.', status: 404 };
  const err = validateGrant(input); if (err) return { ok: false, error: err, status: 400 };
  c.permission = {
    grantedBy: input.grantedBy!.trim(), evidence: input.evidence!.trim(), scope: input.scope!,
    platforms: input.platforms ?? [], grantedAt: now(), expiresAt: input.expiresAt || undefined,
    thirdPartyNotes: input.thirdPartyNotes?.trim() || undefined,
  };
  const s = c.permission.scope;
  log(c, 'Permission granted', `by ${c.permission.grantedBy}: ${(['recording', 'editing', 'redistribution', 'monetization'] as const).filter((k) => s[k]).join(', ')}${c.permission.expiresAt ? ` · expires ${c.permission.expiresAt.slice(0, 10)}` : ''}`);
  c.updatedAt = now(); save(); bus.publish({ type: 'creator-updated', creator: c });
  return { ok: true, creator: c };
}

export function revokePermission(id: string, reason?: string): Creator | undefined {
  const c = load().creators[id]; if (!c?.permission || c.permission.revokedAt) return c;
  c.permission.revokedAt = now();
  log(c, 'Permission revoked', reason?.trim() || undefined);
  c.updatedAt = now(); save(); bus.publish({ type: 'creator-updated', creator: c }); return c;
}

export function addAudit(id: string, action: string, detail?: string): void {
  const c = load().creators[id]; if (!c) return;
  log(c, action, detail); save();
}

/* ───── live state, sessions, notifications (written by the monitor) ───── */
export function updateLive(id: string, live: LiveInfo, opts: { durable?: boolean } = {}): Creator | undefined {
  const c = load().creators[id]; if (!c) return undefined;
  c.live = live;
  if (opts.durable) save(); else saveSoon();
  bus.publish({ type: 'creator-updated', creator: c });
  return c;
}

export const listSessions = (o: { creatorId?: string; limit?: number } = {}): LiveSession[] =>
  Object.values(load().sessions).filter((s) => !o.creatorId || s.creatorId === o.creatorId).sort((a, b) => b.firstDetectedAt.localeCompare(a.firstDetectedAt)).slice(0, o.limit ?? 200);
export const getOpenSession = (creatorId: string): LiveSession | null =>
  Object.values(load().sessions).find((s) => s.creatorId === creatorId && !s.endedAt) ?? null;
export function upsertSession(s: LiveSession, opts: { durable?: boolean } = {}) {
  load().sessions[s.id] = s; if (opts.durable) save(); else saveSoon(); bus.publish({ type: 'session', session: s });
}
export function addNotification(n: Omit<RadarNotification, 'id' | 'at' | 'read'>): RadarNotification {
  const db = load();
  const full: RadarNotification = { ...n, id: `nt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now(), read: false };
  db.notifications.unshift(full); db.notifications = db.notifications.slice(0, 500);
  save(); bus.publish({ type: 'notification', notification: full });
  return full;
}
export const listNotifications = (limit = 50): RadarNotification[] => load().notifications.slice(0, limit);
export function markNotificationsRead(ids: string[] | 'all') {
  for (const n of load().notifications) if (ids === 'all' || ids.includes(n.id)) n.read = true;
  save(); bus.publish({ type: 'notifications-read', ids });
}
