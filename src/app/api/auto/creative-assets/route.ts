import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { addCreative, deleteCreative, listCreative, type CreativeKind } from '@/lib/auto/creative-assets';
import { MAX_BYTES, PY, SCRIPT, probe, run, sniff } from '@/lib/auto/media';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const text = (f: FormData, k: string, max: number) => { const v = f.get(k); return typeof v === 'string' ? v.trim().slice(0, max) : ''; };
const KINDS: CreativeKind[] = ['background', 'footage', 'photo', 'overlay', 'texture', 'illustration', 'font', 'model'];
const isFont = (h: Buffer) => (h.length > 4 && (h.readUInt32BE(0) === 0x00010000 || h.toString('ascii', 0, 4) === 'true' || h.toString('ascii', 0, 4) === 'OTTO'));

export async function GET() { return NextResponse.json({ success: true, assets: listCreative() }); }

/** POST multipart: file + name + kind + licence (required) + commercialOk + confirm. Images/videos only; the licence is stored as entered. */
export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES.video + 1024 * 1024) return bad('That file is too large.', 413);
  let f: FormData; try { f = await request.formData(); } catch { return bad('Upload could not be read.'); }
  const file = f.get('file'); if (!(file instanceof File)) return bad('No file provided.');
  const kind = text(f, 'kind', 20) as CreativeKind; if (!KINDS.includes(kind)) return bad('kind must be background, footage, photo, overlay, texture, illustration, font or model (GLB).');
  const license = text(f, 'license', 200), ok = text(f, 'commercialOk', 10);
  if (!license) return bad('Record the licence for this asset.'); if (!['yes', 'no', 'unknown'].includes(ok)) return bad('Say whether commercial use is allowed: yes, no or unknown.');
  if (text(f, 'confirm', 10) !== 'true') return bad('Confirm that you have the right to use this file.');
  const tmp = path.join(os.tmpdir(), `ca_${crypto.randomBytes(6).toString('hex')}`);
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(tmp));
    const head = Buffer.alloc(32), fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd);
    if (kind === 'font') {
      if (!isFont(head)) return bad('That is not a TrueType/OpenType font (.ttf or .otf).', 415);
      if (fs.statSync(tmp).size > 8 * 1024 * 1024) return bad('Fonts can be up to 8 MB.', 413);
      const pv = path.join(os.tmpdir(), `fp_${crypto.randomBytes(5).toString('hex')}.png`);
      let fam: { family: string; style: string };
      try { fam = JSON.parse((await run(PY(), [SCRIPT('font_preview.py')], { input: JSON.stringify({ file: tmp, out: pv }), timeoutMs: 30_000 })).stdout); } catch (e) { return bad(`That font could not be used: ${(e as Error).message.slice(-120)}`, 422); } finally { try { fs.unlinkSync(pv); } catch { /* none */ } }
      const a = addCreative(fs.readFileSync(tmp), head.toString('ascii', 0, 4) === 'OTTO' ? 'otf' : 'ttf', { kind, name: text(f, 'name', 80) || `${fam.family} ${fam.style}`.trim(), family: fam.family, tags: [fam.style.toLowerCase()], description: 'User-supplied font. Rendered text falls back to the bundled fonts for any missing character.',
        license: { license, commercialOk: ok === 'yes' ? true : ok === 'no' ? false : null, attribution: text(f, 'attribution', 200) || 'as required by the licence', source: text(f, 'source', 200) || undefined, note: 'User-supplied font. The licence was entered by the user and is not verified by this software.' } });
      return NextResponse.json({ success: true, asset: a });
    }
    if (kind === 'model') {
      if (head.toString('ascii', 0, 4) !== 'glTF') return bad('3D models must be binary glTF (.glb). Export a GLB from your 3D tool.', 415);
      if (fs.statSync(tmp).size > 60 * 1024 * 1024) return bad('Models can be up to 60 MB.', 413);
      let info: { faces: number; vertices: number; notes: string[] };
      try { info = JSON.parse((await run(PY(), [SCRIPT('glb_info.py')], { input: JSON.stringify({ file: tmp }), timeoutMs: 60_000 })).stdout); } catch (e) { return bad(`That model could not be used: ${(e instanceof Error ? e.message : '').split('\n').pop()?.slice(0, 160)}`, 422); }
      const a = addCreative(fs.readFileSync(tmp), 'glb', { kind, name: text(f, 'name', 80) || path.parse(file.name).name.slice(0, 80), tags: ['3d', ...text(f, 'tags', 120).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)].slice(0, 8),
        description: `${info.faces} triangles${info.notes.length ? '. ' + info.notes.join('; ') : ''}`,
        license: { license, commercialOk: ok === 'yes' ? true : ok === 'no' ? false : null, attribution: text(f, 'attribution', 200) || 'as required by the licence', source: text(f, 'source', 200) || undefined, note: 'User-supplied 3D model. Rendered with flat base colours; textures are not applied.' } });
      return NextResponse.json({ success: true, asset: a });
    }
    const k = sniff(head); if (!k || k.kind === 'audio') return bad('Add an image (JPEG, PNG, WebP) or video (MP4, MOV, WebM). Music goes in the Sound Library.', 415);
    if (k.kind === 'video' && (kind === 'texture' || kind === 'illustration')) return bad('Textures and illustrations must be images.'); if (k.kind === 'photo' && kind === 'footage') return bad('That is an image, not footage.'); if (k.kind === 'video' && kind === 'photo') return bad('That is a video, not a photo.');
    if (k.kind === 'photo' && fs.statSync(tmp).size > MAX_BYTES.photo) return bad('Images can be up to 40 MB.', 413);
    const pr = await probe(tmp).catch(() => null); if (!pr || !pr.hasVideo) return bad('That file could not be read.', 422);
    const a = addCreative(fs.readFileSync(tmp), k.ext, { kind, name: text(f, 'name', 80) || path.parse(file.name).name.slice(0, 80), width: pr.width, height: pr.height, duration: k.kind === 'video' ? pr.duration : undefined,
      tags: text(f, 'tags', 120).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 8), description: text(f, 'description', 300),
      license: { license, commercialOk: ok === 'yes' ? true : ok === 'no' ? false : null, attribution: text(f, 'attribution', 200) || 'as required by the licence', source: text(f, 'source', 200) || undefined, note: 'User-supplied asset. The licence was entered by the user and has not been verified by this software.' } });
    return NextResponse.json({ success: true, asset: a });
  } catch (e) { return bad(e instanceof Error ? e.message : 'Import failed.', 500); }
  finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}
export async function DELETE(request: NextRequest) { return deleteCreative(new URL(request.url).searchParams.get('id') ?? '') ? NextResponse.json({ success: true }) : bad('asset not found', 404); }
