import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR, CLIPS_DIR } from '@/lib/paths';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'source'; // 'source' or 'clip'
  const filename = searchParams.get('filename');

  if (!filename) {
    return new NextResponse('Filename is required', { status: 400 });
  }

  // Prevent directory traversal
  const sanitized = path.basename(filename);
  const targetDir = type === 'clip' ? CLIPS_DIR : UPLOADS_DIR;
  const filePath = path.join(targetDir, sanitized);

  if (!fs.existsSync(filePath)) {
    return new NextResponse('File not found', { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get('range');

  const MAX_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunk limit for memory safety & fast start

  if (range) {
    // Parse Range header e.g. "bytes=0-1048576" or "bytes=0-"
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || start < 0) {
      return new NextResponse('Requested range not satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      });
    }

    const end = Math.min(rawEnd, fileSize - 1);
    const chunkEnd = Math.min(start + MAX_CHUNK_SIZE - 1, end);
    const chunksize = chunkEnd - start + 1;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(chunksize);
    fs.readSync(fd, buffer, 0, chunksize, start);
    fs.closeSync(fd);

    return new Response(buffer, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${chunkEnd}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      },
    });
  } else {
    // If no range header, send either the entire file (if small) or the initial chunk
    const chunksize = Math.min(fileSize, MAX_CHUNK_SIZE);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(chunksize);
    fs.readSync(fd, buffer, 0, chunksize, 0);
    fs.closeSync(fd);

    if (chunksize < fileSize) {
      return new Response(buffer, {
        status: 206,
        headers: {
          'Content-Range': `bytes 0-${chunksize - 1}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
        },
      });
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Length': fileSize.toString(),
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      },
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
    },
  });
}
