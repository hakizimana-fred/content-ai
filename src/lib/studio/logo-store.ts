import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_DIR } from './settings.ts';
import { PY, SCRIPT, run } from '../auto/media.ts';
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

export const MAX_SVG_BYTES = 1024 * 1024;
/** An SVG is rasterised by headless Chrome as an <img>, which cannot run scripts; we still refuse anything active or external. */
export function svgProblem(svg: string): string | null {
  if (!/<svg[\s>]/i.test(svg)) return 'that is not an SVG file';
  if (/<script|<foreignObject|<iframe|<object|<embed|<!ENTITY|<!DOCTYPE[^>]*\[/i.test(svg)) return 'the SVG contains active or unsafe content (scripts, foreignObject or entities) and was rejected';
  if (/\son[a-z]+\s*=/i.test(svg)) return 'the SVG contains event handlers and was rejected';
  if (/(?:href|src)\s*=\s*["'](?!data:image\/(?:png|jpeg|webp);base64,|#)/i.test(svg) || /url\(\s*["']?(?!#|data:)/i.test(svg)) return 'the SVG references external files; embed them or remove them';
  return null;
}
async function rasteriseSvg(svgPath: string, out: string): Promise<void> {
  const svg = fs.readFileSync(svgPath, 'utf8'); const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg), w = /\swidth\s*=\s*["']?([\d.]+)/i.exec(svg), h = /\sheight\s*=\s*["']?([\d.]+)/i.exec(svg);
  const sw = vb ? Number(vb[1]) : w ? Number(w[1]) : 512, sh = vb ? Number(vb[2]) : h ? Number(h[1]) : 512; const aspect = sw > 0 && sh > 0 ? sw / sh : 1;
  const W = aspect >= 1 ? 1024 : Math.max(64, Math.round(1024 * aspect)), H = aspect >= 1 ? Math.max(64, Math.round(1024 / aspect)) : 1024;
  const html = svgPath + '.html'; fs.writeFileSync(html, `<html><body style="margin:0;background:transparent"><img src="${pathToFileURL(svgPath).href}" style="width:${W}px;height:${H}px;display:block"></body></html>`);
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('SVG logos need Chrome or Chromium installed to be converted; upload a PNG instead');
  try { await run(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${W},${H}`, `--screenshot=${out}`, pathToFileURL(html).href], { timeoutMs: 30_000 }); }
  finally { try { fs.unlinkSync(html); } catch { /* none */ } }
  if (!fs.existsSync(out)) throw new Error('the SVG could not be rendered');
}

export async function saveLogo(identityId: string, data: Buffer): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!ID.test(identityId) || !getIdentity(identityId)) return { ok: false, error: 'identity not found', status: 404 };
  if (data.length === 0) return { ok: false, error: 'empty upload', status: 400 };
  const head = data.subarray(0, 400).toString('utf8').trimStart().toLowerCase(), isSvg = head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!--');
  const work = path.join(dir(), `${identityId}.new`); let source: 'svg' | 'raster' = 'raster';
  try {
    if (isSvg) {
      if (data.length > MAX_SVG_BYTES) return { ok: false, error: 'SVG logos must be under 1 MB', status: 413 };
      const prob = svgProblem(data.toString('utf8')); if (prob) return { ok: false, error: prob, status: 415 };
      fs.writeFileSync(work + '.svg', data); await rasteriseSvg(work + '.svg', work + '.png'); source = 'svg';
    } else {
      if (data.length > MAX_LOGO_BYTES) return { ok: false, error: `logo must be under ${MAX_LOGO_BYTES / 1024 / 1024} MB`, status: 413 };
      const ext0 = sniffImage(data); if (!ext0) return { ok: false, error: 'logo must be a PNG, SVG, WebP or JPEG image', status: 415 };
      fs.writeFileSync(work + '.' + ext0, data);
    }
    const file = fs.existsSync(work + '.png') ? work + '.png' : fs.existsSync(work + '.webp') ? work + '.webp' : work + '.jpg'; const ext = path.extname(file).slice(1) as Ext;
    let info: { width: number; height: number; aspect: number; hasAlpha: boolean; colors: { hex: string; share: number }[] };
    try { info = JSON.parse((await run(PY(), [SCRIPT('brand_extract.py')], { input: JSON.stringify({ file }), timeoutMs: 30_000 })).stdout); } catch { return { ok: false, error: 'that image could not be read as a logo', status: 422 }; }
    removeLogoFiles(identityId); fs.renameSync(file, path.join(dir(), `${identityId}.${ext}`)); if (source === 'svg') fs.renameSync(work + '.svg', path.join(dir(), `${identityId}.svg`));
    setIdentityLogo(identityId, { ext, source, width: info.width, height: info.height, aspect: info.aspect, hasAlpha: info.hasAlpha, extracted: info.colors }); return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : 'logo upload failed', status: 500 }; }
  finally { for (const e of ['svg', 'png', 'webp', 'jpg']) { try { fs.unlinkSync(`${work}.${e}`); } catch { /* none */ } } }
}
/** Colour analysis of the stored logo: primary / secondary / accent suggestions the user can edit. Reads the file only. */
export async function analyseLogo(identityId: string) {
  const f = logoFile(identityId); if (!f) return null;
  return JSON.parse((await run(PY(), [SCRIPT('brand_extract.py')], { input: JSON.stringify({ file: f }), timeoutMs: 30_000 })).stdout) as { roles: { primary: string; secondary: string; accent: string }; colors: { hex: string; share: number }[]; derived: string[]; aspect: number; hasAlpha: boolean; bbox: number[] };
}
function removeLogoFiles(id: string) { for (const e of ['png', 'jpg', 'webp', 'svg']) { try { fs.unlinkSync(path.join(dir(), `${id}.${e}`)); } catch { /* none */ } } }
export function removeLogo(identityId: string): boolean {
  if (!ID.test(identityId) || !getIdentity(identityId)) return false; removeLogoFiles(identityId); setIdentityLogo(identityId, undefined); return true;
}
