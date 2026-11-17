import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { studioDb } from '../studio/studio-db.ts';
import { DEFAULT_CONFIG, type AutoAsset, type AutoConfig, type AutoProject } from './types.ts';

export const AUTO_DIR = () => process.env.AUTO_DATA_DIR || path.resolve(process.cwd(), 'storage', 'auto');
const ID = /^ap_[a-f0-9]{10}$/, AID = /^as_[a-f0-9]{10}$/;
export const isProjectId = (s: string) => ID.test(s);
export const isAssetId = (s: string) => AID.test(s);
export const projectDir = (id: string) => { if (!ID.test(id)) throw new Error('bad project id'); const d = path.join(AUTO_DIR(), id); fs.mkdirSync(d, { recursive: true }); return d; };
export const assetsDir = (id: string) => { const d = path.join(projectDir(id), 'assets'); fs.mkdirSync(d, { recursive: true }); return d; };
export const renderDir = (id: string) => { const d = path.join(projectDir(id), 'render'); fs.mkdirSync(d, { recursive: true }); return d; };
export const newAssetId = () => `as_${crypto.randomBytes(5).toString('hex')}`;

const parse = (r: Record<string, unknown>) => JSON.parse(r.json as string) as AutoProject;
export const listProjects = (): AutoProject[] => studioDb().prepare('SELECT json FROM auto_projects ORDER BY updated_at DESC').all().map(parse);
export const getProject = (id: string): AutoProject | null => { if (!ID.test(id)) return null; const r = studioDb().prepare('SELECT json FROM auto_projects WHERE id = ?').get(id); return r ? parse(r) : null; };

export function createProject(name = 'Untitled video', config: Partial<AutoConfig> = {}): AutoProject {
  const now = Date.now();
  const p: AutoProject = { id: `ap_${crypto.randomBytes(5).toString('hex')}`, name: name.slice(0, 80) || 'Untitled video', assets: [], config: { ...DEFAULT_CONFIG, ...config },
    render: { jobId: null, stages: [], running: false }, history: [], createdAt: now, updatedAt: now };
  studioDb().prepare('INSERT INTO auto_projects (id, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(p.id, p.name, JSON.stringify(p), now, now);
  projectDir(p.id); return p;
}
/** Read-modify-write. The callback may mutate and/or return the project. */
export function updateProject(id: string, fn: (p: AutoProject) => void): AutoProject | null {
  const cur = getProject(id); if (!cur) return null;
  fn(cur); cur.updatedAt = Date.now();
  studioDb().prepare('UPDATE auto_projects SET name = ?, json = ?, updated_at = ? WHERE id = ?').run(cur.name, JSON.stringify(cur), cur.updatedAt, id);
  return cur;
}
export function deleteProject(id: string): boolean {
  if (!ID.test(id)) return false;
  const r = studioDb().prepare('DELETE FROM auto_projects WHERE id = ?').run(id) as { changes: number | bigint };
  try { fs.rmSync(path.join(AUTO_DIR(), id), { recursive: true, force: true }); } catch { /* best effort */ }
  return Number(r.changes) > 0;
}
export const assetPath = (p: AutoProject | string, a: AutoAsset) => path.join(assetsDir(typeof p === 'string' ? p : p.id), a.file);

export function addAsset(id: string, asset: AutoAsset): AutoProject | null {
  return updateProject(id, (p) => { asset.order = p.assets.length ? Math.max(...p.assets.map((a) => a.order)) + 1 : 0; p.assets.push(asset); invalidate(p); });
}
export function removeAsset(id: string, assetId: string): AutoProject | null {
  const cur = getProject(id); const a = cur?.assets.find((x) => x.id === assetId); if (!cur || !a) return null;
  for (const f of [a.file, a.thumb]) if (f) { try { fs.unlinkSync(path.join(assetsDir(id), f)); } catch { /* gone */ } }
  return updateProject(id, (p) => { p.assets = p.assets.filter((x) => x.id !== assetId); invalidate(p); });
}
export function reorderAssets(id: string, order: string[]): AutoProject | null {
  return updateProject(id, (p) => {
    const known = new Set(p.assets.map((a) => a.id)); const seq = [...order.filter((x) => known.has(x)), ...p.assets.map((a) => a.id).filter((x) => !order.includes(x))];
    seq.forEach((aid, i) => { const a = p.assets.find((x) => x.id === aid)!; a.order = i; }); p.assets.sort((a, b) => a.order - b.order); invalidate(p);
  });
}
/** Changing the media makes the existing timeline/render stale; it is kept for preview but flagged by clearing the timeline. */
function invalidate(p: AutoProject) { p.timeline = undefined; }
