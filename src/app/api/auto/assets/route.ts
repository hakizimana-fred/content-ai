import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { addAsset, AUTO_DIR, getProject, removeAsset, reorderAssets, updateProject, isAssetId } from '@/lib/auto/store';
import { MAX_ASSETS, MAX_BYTES, ingestFile } from '@/lib/auto/media';
import { currentJob } from '@/lib/auto/pipeline';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const q = (r: NextRequest, k: string) => new URL(r.url).searchParams.get(k) ?? '';
const busy = (id: string) => currentJob()?.projectId === id;
const MAX_REQUEST = Math.max(...Object.values(MAX_BYTES)) + 2 * 1024 * 1024;

/** POST ?project=ID  multipart: file (required), replace (optional asset id to swap in place). One file per request. */
export async function POST(request: NextRequest) {
  const pid = q(request, 'project'), p = getProject(pid); if (!p) return bad('project not found', 404);
  if (busy(pid)) return bad('This video is being made right now. Wait for it to finish.', 409);
  const len = Number(request.headers.get('content-length') ?? 0); if (len > MAX_REQUEST) return bad('That file is too large.', 413);
  let form: FormData; try { form = await request.formData(); } catch { return bad('Upload could not be read.'); }
  const file = form.get('file'); if (!(file instanceof File)) return bad('No file provided.');
  const replace = typeof form.get('replace') === 'string' ? (form.get('replace') as string) : '';
  if (replace && (!isAssetId(replace) || !p.assets.some((a) => a.id === replace))) return bad('The item to replace was not found.', 404);
  if (!replace && p.assets.length >= MAX_ASSETS) return bad(`A project can hold up to ${MAX_ASSETS} files.`);
  const tmpDir = path.join(AUTO_DIR(), '_tmp'); fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${crypto.randomBytes(6).toString('hex')}.upload`);
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(tmp));
    const asset = await ingestFile(pid, tmp, file.name || 'upload');
    if (replace) { const old = p.assets.find((a) => a.id === replace)!; asset.order = old.order; removeAsset(pid, replace); const withNew = addAsset(pid, asset)!; const order = p.assets.map((a) => (a.id === replace ? asset.id : a.id)); return NextResponse.json({ success: true, asset, project: reorderAssets(pid, order) ?? withNew }); }
    return NextResponse.json({ success: true, asset, project: addAsset(pid, asset) });
  } catch (e) { const st = (e as { status?: number }).status ?? 500; return bad((e as Error).message, st); }
  finally { try { fs.unlinkSync(tmp); } catch { /* moved or gone */ } }
}
/** PUT ?project=ID  { order: [assetId...] } */
export async function PUT(request: NextRequest) {
  const pid = q(request, 'project'); if (!getProject(pid)) return bad('project not found', 404); if (busy(pid)) return bad('Wait for the render to finish.', 409);
  let b: { order?: unknown }; try { b = await request.json(); } catch { return bad('Invalid JSON body.'); }
  if (!Array.isArray(b.order) || !b.order.every((x) => typeof x === 'string')) return bad('order must be a list of asset ids.');
  return NextResponse.json({ success: true, project: reorderAssets(pid, b.order as string[]) });
}
/** DELETE ?project=ID&asset=ID */
export async function DELETE(request: NextRequest) {
  const pid = q(request, 'project'), aid = q(request, 'asset'); if (busy(pid)) return bad('Wait for the render to finish.', 409);
  if (!isAssetId(aid)) return bad('invalid asset id'); const r = removeAsset(pid, aid); void updateProject;
  return r ? NextResponse.json({ success: true, project: r }) : bad('asset not found', 404);
}
