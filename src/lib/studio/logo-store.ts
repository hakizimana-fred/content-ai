import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_DIR } from './settings.ts';
import { getIdentity, setIdentityLogo } from './identity-store.ts';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ID = /^idn_[a-z0-9]{3,16}$/;
type Ext = 'png' | 'jpg' | 'webp';
const dir = () => { const d = path.join(STUDIO_DIR, 'logos'); fs.mkdirSync(d, { recursive: true }); return d; };

/** Decide the type from the file's own bytes, never from the filename or the client's content-type. */
export function sniffImage(b: Buffer): Ext | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export const MIME: Record<Ext, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function logoFile(identityId: string): string | null {
  if (!ID.test(identityId)) return null;
  const ext = getIdentity(identityId)?.logo?.ext; if (!ext) return null;
  const p = path.join(dir(), `${identityId}.${ext}`); return fs.existsSync(p) ? p : null;
}

export function saveLogo(identityId: string, data: Buffer): { ok: true } | { ok: false; error: string; status: number } {
  if (!ID.test(identityId) || !getIdentity(identityId)) return { ok: false, error: 'identity not found', status: 404 };
  if (data.length === 0) return { ok: false, error: 'empty upload', status: 400 };
  if (data.length > MAX_LOGO_BYTES) return { ok: false, error: `logo must be under ${MAX_LOGO_BYTES / 1024 / 1024} MB`, status: 413 };
  const ext = sniffImage(data); if (!ext) return { ok: false, error: 'logo must be a PNG, JPEG or WebP image', status: 415 };
  removeLogoFiles(identityId);
  fs.writeFileSync(path.join(dir(), `${identityId}.${ext}`), data);
  setIdentityLogo(identityId, { ext }); return { ok: true };
}
function removeLogoFiles(id: string) { for (const e of ['png', 'jpg', 'webp']) { try { fs.unlinkSync(path.join(dir(), `${id}.${e}`)); } catch { /* none */ } } }
export function removeLogo(identityId: string): boolean {
  if (!ID.test(identityId) || !getIdentity(identityId)) return false; removeLogoFiles(identityId); setIdentityLogo(identityId, undefined); return true;
}
