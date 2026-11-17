import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-')); process.env.STUDIO_DATA_DIR = path.join(dir, 'studio'); fs.mkdirSync(process.env.STUDIO_DATA_DIR);
const { createIdentity, getIdentity, updateIdentity } = await import('../src/lib/studio/identity-store.ts');
const { saveLogo, svgProblem, logoFile, analyseLogo } = await import('../src/lib/studio/logo-store.ts');
const { IDENTITY_TEMPLATES, validateIdentity } = await import('../src/lib/studio/identity.ts');
const { applyBrand, brandOf, brandPalette, bindLogo } = await import('../src/lib/auto/brand.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');

// --- SVG safety
for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg onload="x()" xmlns="http://www.w3.org/2000/svg"/>', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.test/a.png"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(http://x.test/a)"/></svg>', '<html></html>'])
  assert(svgProblem(bad), `rejected: ${bad.slice(0, 50)}`);
assert.equal(svgProblem('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>'), null);

const c = createIdentity({ ...IDENTITY_TEMPLATES.africa_unfiltered, brand: { text: 'Acme', corner: 'tr' } }); assert(c.ok); const id = c.ok ? c.identity.id : '';
assert.equal((await saveLogo(id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).ok, false, 'unsafe SVG refused through the upload path');
assert.equal(logoFile(id), null, 'a refused upload leaves no logo behind');

// --- real SVG -> transparent PNG + palette extracted from the logo's own pixels
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><circle cx="60" cy="60" r="50" fill="#e63946"/><rect x="130" y="30" width="150" height="25" fill="#1d3557"/><rect x="130" y="70" width="100" height="18" fill="#f4a261"/></svg>';
const r1 = await saveLogo(id, Buffer.from(svg)); assert(r1.ok, JSON.stringify(r1));
const idn = getIdentity(id)!; assert.equal(idn.logo?.source, 'svg'); assert.equal(idn.logo?.hasAlpha, true, 'SVG transparency preserved'); assert(Math.abs((idn.logo?.aspect ?? 0) - 2.7) < 0.15, `aspect kept (${idn.logo?.aspect})`);
const an = (await analyseLogo(id))!; const near = (a: string, b: string) => Math.hypot(...[1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16) - parseInt(b.slice(k, k + 2), 16))) < 40;
assert(near(an.roles.primary, '#e63946'), `primary ${an.roles.primary}`); assert(near(an.roles.secondary, '#1d3557'), `secondary ${an.roles.secondary}`); assert(near(an.roles.accent, '#f4a261'), `accent ${an.roles.accent}`); assert.deepEqual(an.derived, []);
// a raster logo is stored byte-for-byte (never re-encoded or recoloured)
const png = path.join(dir, 'l.png'); assert.equal(spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a9d8f:s=300x100', '-frames:v', '1', png]).status, 0);
const bytes = fs.readFileSync(png); assert((await saveLogo(id, bytes)).ok); const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(logoFile(id)!)), sha(bytes), 'uploaded raster logo is stored unmodified'); assert(!fs.existsSync(path.join(path.dirname(logoFile(id)!), `${id}.svg`)), 'replacing the logo removes the old SVG');

// --- profile fields validate and persist; invalid values are rejected
const base = { ...IDENTITY_TEMPLATES.africa_unfiltered, brand: { text: 'Acme', corner: 'tr' as const } };
const ok = updateIdentity(id, { ...base, tagline: 'Built different', colors: { ...base.colors, secondary: '#112233' }, logoStyle: { opening: true, closing: true, watermark: false, scale: 1.2, reveal: 'rise', extrude: false } }); assert(ok.ok);
const got = getIdentity(id)!; assert.equal(got.tagline, 'Built different'); assert.equal(got.colors.secondary, '#112233'); assert.equal(got.logoStyle?.reveal, 'rise'); assert(got.logo, 'logo survives profile edits');
assert.equal(validateIdentity({ ...base, colors: { ...base.colors, secondary: 'red' } }).ok, false, 'bad colour'); assert.equal(validateIdentity({ ...base, logoStyle: { opening: true, closing: true, watermark: true, scale: 9, reveal: 'sweep', extrude: false } }).ok, false, 'scale out of range');

// --- Brand Director decisions
const scenes = [{ id: 's1', kind: 'intro', weight: 1, bg: 'aurora', title: 'Hello' }, { id: 's2', kind: 'product3d', weight: 2, bg: 'aurora', three: { objects: [{ shape: 'box', color: '#888888' }] } }, { id: 's3', kind: 'outro', weight: 1, bg: 'aurora', cta: 'Visit us' }] as never[];
const b = brandOf(getIdentity(id)!); const out = applyBrand(scenes, b);
assert.equal(out.scenes[0].logo?.role, 'opening'); assert.equal(out.scenes[2].logo?.role, 'closing'); assert.equal(out.scenes[2].subtitle, 'Built different'); assert.equal(out.scenes[2].logo?.reveal, 'rise');
assert.notEqual(out.scenes[1].three?.objects[0].color, '#888888', '3D objects take brand colours'); assert(out.decided.some((d) => /corner/.test(d)) && out.decided.some((d) => /palette/.test(d)), 'decisions are recorded');
assert(!out.scenes.some((s) => s.kind === 'logo3d'), 'no 3D logo unless opted in');
const ext = applyBrand(scenes, { ...b, style: { ...b.style, extrude: true } }); assert.equal(ext.scenes[2].kind, 'logo3d'); assert(ext.decided.some((d) => /you enabled/.test(d)));
const noOpen = applyBrand(scenes, { ...b, style: { ...b.style, opening: false, closing: false } }); assert(!noOpen.scenes[0].logo && !noOpen.scenes[2].logo, 'toggles respected');
const none = applyBrand(scenes, { ...b, hasLogo: false }); assert(!none.scenes.some((s) => s.logo) && none.decided.some((d) => /no logo/.test(d)));
// palette: readable text, pale brand -> light video
const dark = brandPalette({ ...b, colors: { primary: '#1d3557', accent: '#f4a261', text: '#fff' } }); assert.equal(dark.text, '#ffffff'); const pale = brandPalette({ ...b, colors: { primary: '#f5f0e6', accent: '#b5651d', text: '#000' } }); assert.equal(pale.light, true); assert.equal(pale.text, '#14141c');
const bound = bindLogo(out.scenes, id); assert(bound.scenes[0].logo?.file && bound.scenes[0].logo.ver, 'logo file bound for rendering'); assert.equal(bindLogo(out.scenes, undefined).missing, true);
closeStudioDb(); console.log('brand tests passed');
