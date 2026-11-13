import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { videoStore } from '@/lib/store';
import { getProjectById } from '@/lib/db';

const MAX_RANGE_SECONDS = 180;

/** POST { sourceId, start, end } -> { keyframes: [{t,x}], faces } via the local OpenCV worker. */
export async function POST(request: NextRequest) {
  const { sourceId, start, end } = await request.json();
  if (!sourceId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return NextResponse.json({ success: false, error: 'sourceId, start and end (end > start) are required.' }, { status: 400 });
  }
  if (end - start > MAX_RANGE_SECONDS) {
    return NextResponse.json({ success: false, error: `Tracking is limited to ${MAX_RANGE_SECONDS}s at a time. Pick a shorter segment.` }, { status: 400 });
  }
  const source = videoStore.getSource(sourceId) ?? getProjectById(sourceId);
  if (!source || !fs.existsSync(source.localPath)) {
    return NextResponse.json({ success: false, error: 'Source video not found.' }, { status: 404 });
  }

  const py = path.join(process.cwd(), '.venv', 'bin', 'python3');
  const script = path.join(process.cwd(), 'src', 'lib', 'intelligence', 'track_faces.py');
  if (!fs.existsSync(py)) {
    return NextResponse.json({ success: false, error: 'Python environment (.venv) not found. Face tracking needs OpenCV: python3 -m venv .venv && .venv/bin/pip install opencv-python-headless' }, { status: 501 });
  }

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(py, [script, '--input', source.localPath, '--start', String(start), '--end', String(end)]);
    let out = '', err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 180_000);
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => { clearTimeout(timer); resolve(NextResponse.json({ success: false, error: e.message }, { status: 500 })); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out.trim().split('\n').pop() || '{}');
        if (code !== 0 || data.error) throw new Error(data.error || err.slice(-200) || `exit ${code}`);
        resolve(NextResponse.json({ success: true, ...data }));
      } catch (e) {
        const msg = (e as Error).message;
        resolve(NextResponse.json({ success: false, error: /No module named 'cv2'/.test(err) ? 'OpenCV is not installed: .venv/bin/pip install opencv-python-headless' : `Face tracking failed: ${msg}` }, { status: 500 }));
      }
    });
  });
}
