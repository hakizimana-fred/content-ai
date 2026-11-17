import crypto from 'node:crypto';
import { studioDb } from './studio-db.ts';
import { validateIdentity, type Identity, type IdentityInput } from './identity.ts';

const parse = (r: Record<string, unknown>) => JSON.parse(r.json as string) as Identity;

export const listIdentities = (): Identity[] => studioDb().prepare('SELECT json FROM identities ORDER BY created_at').all().map(parse);
export const getIdentity = (id: string): Identity | null => { const r = studioDb().prepare('SELECT json FROM identities WHERE id = ?').get(id); return r ? parse(r) : null; };

export function createIdentity(input: unknown): { ok: true; identity: Identity } | { ok: false; errors: string[] } {
  const v = validateIdentity(input);
  if (!v.ok) return v;
  const now = Date.now();
  const identity: Identity = { ...(v.identity as IdentityInput), id: `idn_${crypto.randomBytes(5).toString('hex')}`, createdAt: now, updatedAt: now };
  studioDb().prepare('INSERT INTO identities (id, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(identity.id, identity.name, JSON.stringify(identity), now, now);
  return { ok: true, identity };
}

export function updateIdentity(id: string, input: unknown): { ok: true; identity: Identity } | { ok: false; errors: string[]; notFound?: boolean } {
  const cur = getIdentity(id);
  if (!cur) return { ok: false, errors: ['identity not found'], notFound: true };
  const v = validateIdentity(input);
  if (!v.ok) return v;
  const identity: Identity = { ...(v.identity as IdentityInput), id, createdAt: cur.createdAt, updatedAt: Date.now(), ...(cur.logo ? { logo: cur.logo } : {}) };
  if (!input || typeof input !== 'object') return { ok: false, errors: ['identity must be an object'] };
  studioDb().prepare('UPDATE identities SET name = ?, json = ?, updated_at = ? WHERE id = ?').run(identity.name, JSON.stringify(identity), identity.updatedAt, id);
  return { ok: true, identity };
}

export function deleteIdentity(id: string): boolean {
  const r = studioDb().prepare('DELETE FROM identities WHERE id = ?').run(id) as { changes: number | bigint };
  return Number(r.changes) > 0;
}

export function setIdentityLogo(id: string, logo: Identity['logo']): Identity | null {
  const cur = getIdentity(id); if (!cur) return null;
  const next: Identity = { ...cur, updatedAt: Date.now() }; if (logo) next.logo = logo; else delete next.logo;
  studioDb().prepare('UPDATE identities SET json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), next.updatedAt, id);
  return next;
}
