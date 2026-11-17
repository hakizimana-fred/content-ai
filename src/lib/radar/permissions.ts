import type { Creator, CreatorPermission, PermissionStatus, PermissionScope } from '../../types/radar.ts';

const DAY = 86_400_000;

export function permissionStatus(p: CreatorPermission | undefined, now = Date.now()): PermissionStatus {
  if (!p) return 'none';
  if (p.revokedAt) return 'revoked';
  if (p.expiresAt) {
    const exp = Date.parse(p.expiresAt);
    if (Number.isNaN(exp) || exp <= now) return 'expired';
    if (exp - now <= 14 * DAY) return 'expiring';
  }
  return 'active';
}

export type Action = keyof PermissionScope;

export interface Decision { allowed: boolean; reason?: string }

/** Single gate used by every recording / editing / publishing path. Missing, expired or revoked consent blocks. */
export function can(creator: Pick<Creator, 'permission' | 'username'>, action: Action, platform?: string, now = Date.now()): Decision {
  const p = creator.permission;
  const st = permissionStatus(p, now);
  if (!p || st === 'none') return { allowed: false, reason: `No permission on file for @${creator.username}.` };
  if (st === 'revoked') return { allowed: false, reason: 'The creator has revoked permission.' };
  if (st === 'expired') return { allowed: false, reason: 'Permission has expired.' };
  if (!p.scope[action]) return { allowed: false, reason: `Permission does not cover ${action}.` };
  if (platform && p.platforms.length > 0 && !p.platforms.includes(platform)) return { allowed: false, reason: `Permission does not cover ${platform}.` };
  return { allowed: true };
}

export function validateGrant(input: Partial<CreatorPermission>): string | null {
  if (!input.grantedBy?.trim()) return 'Say who granted the permission.';
  if (!input.evidence?.trim()) return 'Record how consent was given (e.g. email, signed agreement).';
  const s = input.scope;
  if (!s || !(s.recording || s.editing || s.redistribution || s.monetization)) return 'Select at least one thing the permission covers.';
  if (input.expiresAt) {
    const t = Date.parse(input.expiresAt);
    if (Number.isNaN(t)) return 'Expiry date is not valid.';
    if (t <= Date.now()) return 'Expiry date must be in the future.';
  }
  return null;
}

export function normalizeUsername(raw: string): { ok: true; username: string } | { ok: false; error: string } {
  const u = raw.trim().replace(/^@+/, '').toLowerCase();
  if (!u) return { ok: false, error: 'Enter a username.' };
  if (!/^[a-z0-9._]{2,24}$/.test(u)) return { ok: false, error: 'Usernames use letters, numbers, dots and underscores (2–24 characters).' };
  if (u.endsWith('.')) return { ok: false, error: 'A username cannot end with a dot.' };
  return { ok: true, username: u };
}
