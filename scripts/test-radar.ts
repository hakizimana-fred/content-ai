import assert from 'node:assert/strict';
import { permissionStatus as st, can, validateGrant, normalizeUsername as nu } from '../src/lib/radar/permissions.ts';
import type { CreatorPermission } from '../src/types/radar.ts';

const T = Date.parse('2026-06-01T00:00:00Z');
const scope = { recording: true, editing: true, redistribution: false, monetization: false };
const base: CreatorPermission = { grantedBy: 'A', evidence: 'email', scope, platforms: ['youtube'], grantedAt: '2026-01-01T00:00:00Z' };
const c = (permission?: CreatorPermission) => ({ username: 'x', permission });

assert.equal(st(undefined, T), 'none'); assert.equal(st(base, T), 'active');
assert.equal(st({ ...base, expiresAt: '2026-06-10T00:00:00Z' }, T), 'expiring');
assert.equal(st({ ...base, expiresAt: '2026-05-31T00:00:00Z' }, T), 'expired');
assert.equal(st({ ...base, expiresAt: 'garbage' }, T), 'expired');
assert.equal(st({ ...base, revokedAt: '2026-02-01T00:00:00Z' }, T), 'revoked');

assert(!can(c(), 'recording', undefined, T).allowed);
assert(can(c(base), 'recording', undefined, T).allowed);
assert(!can(c(base), 'redistribution', undefined, T).allowed);            // not in scope
assert(!can(c(base), 'recording', 'tiktok', T).allowed);                  // platform not covered
assert(can(c(base), 'recording', 'youtube', T).allowed);
assert(!can(c({ ...base, revokedAt: '2026-02-01T00:00:00Z' }), 'recording', undefined, T).allowed);
assert(!can(c({ ...base, expiresAt: '2026-05-01T00:00:00Z' }), 'recording', undefined, T).allowed);

assert(validateGrant({ ...base }) === null);
assert(validateGrant({ ...base, grantedBy: ' ' })); assert(validateGrant({ ...base, evidence: '' }));
assert(validateGrant({ ...base, scope: { recording: false, editing: false, redistribution: false, monetization: false } }));
assert(validateGrant({ ...base, expiresAt: '2020-01-01' }));

assert.deepEqual(nu('@Creator_One'), { ok: true, username: 'creator_one' });
for (const bad of ['', '@', 'a', 'has space', 'x'.repeat(25), 'bad!', 'end.']) assert(!nu(bad).ok, bad);
console.log('radar permission tests passed');
