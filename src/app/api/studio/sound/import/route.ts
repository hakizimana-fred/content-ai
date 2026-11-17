import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { importTrack } from '@/lib/studio/library';
import { MAX_BYTES, probe, sniff } from '@/lib/auto/media';
import { detectTempo } from '@/lib/auto/tempo';
import { AUDIO_MOODS } from '@/lib/studio/plan';

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const text = (f: FormData, k: string, max: number) => { const v = f.get(k); return typeof v === 'string' ? v.trim().slice(0, max) : ''; };

/**
 * POST multipart: file + label + licence (required) + commercialOk (yes|no|unknown) + confirm=true.
 * Adds a user-supplied licensed track to the Sound Library. The licence is recorded exactly as entered; nothing is assumed commercially usable.
 */
export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES.audio + 1024 * 1024) return bad('That file is too large.', 413);
  let f: FormData; try { f = await request.formData(); } catch { return bad('Upload could not be read.'); }
  const file = f.get('file'); if (!(file instanceof File)) return bad('No audio file provided.');
  const label = text(f, 'label', 80) || path.parse(file.name).name.slice(0, 80), license = text(f, 'license', 200), ok = text(f, 'commercialOk', 10);
  if (!license) return bad('Record the licence for this track (for example "Purchased from <source>, commercial use allowed").');
  if (!['yes', 'no', 'unknown'].includes(ok)) return bad('Say whether commercial use is allowed: yes, no or unknown.');
  if (text(f, 'confirm', 10) !== 'true') return bad('Confirm that you have the right to use this file.');
  const mood = text(f, 'mood', 30); if (mood && !(AUDIO_MOODS as readonly string[]).includes(mood)) return bad('Unknown mood.');
  const energy = text(f, 'energy', 10); if (energy && !['low', 'medium', 'high'].includes(energy)) return bad('Unknown energy level.');
  const tmp = path.join(os.tmpdir(), `imp_${crypto.randomBytes(6).toString('hex')}`);
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(tmp));
    const head = Buffer.alloc(32), fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd);
    const kind = sniff(head); if (!kind || kind.kind !== 'audio') return bad('That is not a supported audio file (MP3, WAV, M4A, OGG or FLAC).', 415);
    const pr = await probe(tmp).catch(() => null); if (!pr || !pr.hasAudio || pr.duration < 1) return bad('That audio file could not be read.', 422);
    if (pr.duration > 600) return bad('Tracks longer than 10 minutes are not supported.', 413);
    const tempo = await detectTempo(tmp, 45).catch(() => ({ bpm: null, beatOffset: 0, confidence: 0 }));
    const conf = tempo.bpm !== null && tempo.confidence >= 0.25;
    const item = importTrack(fs.readFileSync(tmp), kind.ext, { label, genre: text(f, 'genre', 40) || undefined, mood: mood || undefined, description: text(f, 'description', 300) || undefined, seconds: pr.duration,
      bpm: conf ? tempo.bpm! : undefined, beatOffset: conf ? tempo.beatOffset : undefined, energy: (energy || undefined) as never,
      license: { license, commercialOk: ok === 'yes' ? true : ok === 'no' ? false : null, attribution: text(f, 'attribution', 200) || 'as required by the licence', thirdPartySamples: false, note: 'User-supplied track. The licence above was entered by the user and has not been verified by this software.', source: text(f, 'source', 200) || undefined } });
    return NextResponse.json({ success: true, item, tempo: conf ? { bpm: tempo.bpm, confidence: tempo.confidence } : null });
  } catch (e) { return bad(e instanceof Error ? e.message : 'Import failed.', 500); }
  finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}
