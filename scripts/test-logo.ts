import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-')); process.env.STUDIO_DATA_DIR = path.join(dir, 'studio');
fs.mkdirSync(process.env.STUDIO_DATA_DIR);
const { createIdentity, getIdentity, updateIdentity } = await import('../src/lib/studio/identity-store.ts');
const { saveLogo, removeLogo, logoFile, sniffImage, MAX_LOGO_BYTES } = await import('../src/lib/studio/logo-store.ts');
const { IDENTITY_TEMPLATES } = await import('../src/lib/studio/identity.ts');
const { productionFromPlan } = await import('../src/lib/studio/produce.ts');
const { DEFAULT_PLAN } = await import('../src/lib/studio/plan.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');
const { cutVideoSegment } = await import('../src/lib/ffmpeg.ts');

const mk = (name: string, args: string[]) => { const f = path.join(dir, name); assert.equal(spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, f]).status, 0); return f; };
const png = fs.readFileSync(mk('logo.png', ['-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1']));
const jpg = fs.readFileSync(mk('l.jpg', ['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1']));
const webp = fs.readFileSync(mk('l.webp', ['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1']));
assert.deepEqual([sniffImage(png), sniffImage(jpg), sniffImage(webp)], ['png', 'jpg', 'webp']);
assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)>')), null, 'svg/html is not an accepted image'); assert.equal(sniffImage(Buffer.from('GIF89a......')), null);

const c = createIdentity({ ...IDENTITY_TEMPLATES.africa_unfiltered, brand: { text: 'X', corner: 'tr' } }); assert(c.ok); const id = c.ok ? c.identity.id : '';
assert.equal(logoFile(id), null, 'no logo yet');
assert.equal((saveLogo('idn_nope', png) as { status: number }).status, 404);
assert.equal((saveLogo(id, Buffer.from('not an image at all, 20+ bytes long')) as { status: number }).status, 415, 'non-image rejected by content, not by name');
assert.equal((saveLogo(id, Buffer.alloc(MAX_LOGO_BYTES + 1, 1)) as { status: number }).status, 413, 'size limit');
assert.equal((saveLogo(id, Buffer.alloc(0)) as { status: number }).status, 400);
assert.equal((saveLogo('../../etc/passwd', png) as { status: number }).status, 404, 'path traversal in id');
assert(saveLogo(id, png).ok); const f1 = logoFile(id)!; assert(f1.endsWith(`${id}.png`) && fs.existsSync(f1)); assert.equal(getIdentity(id)?.logo?.ext, 'png');
assert(saveLogo(id, jpg).ok); assert(!fs.existsSync(f1), 'replacing a logo removes the old file'); assert(logoFile(id)!.endsWith('.jpg'));
const u = updateIdentity(id, { ...IDENTITY_TEMPLATES.africa_unfiltered, name: 'Edited', brand: { text: 'X', corner: 'tr' } }); assert(u.ok && u.identity.logo?.ext === 'jpg', 'editing an identity keeps its logo');

// plan -> production: logo replaces the text brand mark in the same corner
const idObj = getIdentity(id)!;
const r = productionFromPlan(DEFAULT_PLAN, { identity: idObj, title: 'T', hasTranscript: false, seed: 1 });
assert.deepEqual(r.production.studio?.logo, { identityId: id, corner: 'tr' }); assert(!r.production.studio?.overlays?.brand, 'text mark not drawn on top of the logo');
assert(!productionFromPlan(DEFAULT_PLAN, { identity: { ...idObj, brand: { text: '', corner: 'none' } }, title: 'T', hasTranscript: false, seed: 1 }).production.studio?.logo, 'hidden corner = no logo');

// real render: the logo's colour appears in the top-right of the frame and not in the plain render
const src = mk('src.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
const pixel = (file: string, x: number, y: number) => { const o = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=2:2:${x - (x % 2)}:${y - (y % 2)}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout; return [o[0], o[1], o[2]]; };
for (const [aspect, canvas] of [['portrait_crop', { w: 1080, h: 1080 }], ['portrait_blur', undefined], ['original', undefined]] as const) {
  const plain = path.join(dir, `p_${aspect}.mp4`), withLogo = path.join(dir, `l_${aspect}.mp4`);
  const base = { inputPath: src, startTime: 0, endTime: 1.5, aspectRatio: aspect, canvas, crop: aspect === 'portrait_crop' ? { zoom: 1, centerExpr: '0.5' } : undefined };
  await cutVideoSegment({ ...base, outputPath: plain });
  await cutVideoSegment({ ...base, outputPath: withLogo, logo: { path: logoFile(id)!.replace('.jpg', '.jpg'), corner: 'tr' } });
  const W = aspect === 'original' ? 640 : 1080, mx = Math.round(W * 0.04), lw = Math.round(W * 0.16 / 2) * 2;
  const probe = (f: string) => pixel(f, W - mx - Math.round(lw / 2), Math.round((aspect === 'original' ? 360 : aspect === 'portrait_blur' ? 1920 : 1080) * 0.05) + 10);
  const a = probe(plain), b = probe(withLogo);
  console.log(aspect, 'plain', a.join(','), 'with logo', b.join(','));
  assert(b[0] > 180 && b[1] < 90 && b[2] < 90, `${aspect}: logo colour (red) present in the top-right`); assert(!(a[0] > 180 && a[1] < 90), `${aspect}: absent without a logo`);
}
// a missing logo file never breaks a render
await cutVideoSegment({ inputPath: src, outputPath: path.join(dir, 'm.mp4'), startTime: 0, endTime: 1, logo: { path: '/nonexistent.png', corner: 'tl' } });
assert(removeLogo(id) && logoFile(id) === null && !getIdentity(id)?.logo);
closeStudioDb(); fs.rmSync(dir, { recursive: true, force: true });
console.log('logo tests passed');
