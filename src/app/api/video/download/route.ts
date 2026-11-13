import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { CLIPS_DIR, UPLOADS_DIR } from '@/lib/paths';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'clip';
  const filename = searchParams.get('filename');
  const downloadName = searchParams.get('downloadName') || filename || 'video.mp4';

  if (!filename) {
    return new NextResponse('Filename is required', { status: 400 });
  }

  const sanitized = path.basename(filename);
  const targetDir = type === 'clip' ? CLIPS_DIR : UPLOADS_DIR;
  const filePath = path.join(targetDir, sanitized);

  if (!fs.existsSync(filePath)) {
    return new NextResponse('File not found', { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileStream = fs.createReadStream(filePath);

  const readable = new ReadableStream({
    start(controller) {
      fileStream.on('data', (chunk) => controller.enqueue(chunk));
      fileStream.on('end', () => controller.close());
      fileStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      fileStream.destroy();
    },
  });

  const safeDownloadName = encodeURIComponent(path.basename(downloadName));

  return new NextResponse(readable, {
    status: 200,
    headers: {
      'Content-Length': stat.size.toString(),
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${safeDownloadName}`,
    },
  });
}
