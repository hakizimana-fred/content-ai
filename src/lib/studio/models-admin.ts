import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MODEL_CATALOG, type ModelSpec } from './models.ts';
import { MODELS_DIR, modelFile } from './llama-runtime.ts';

export interface DownloadState { status: 'downloading' | 'verifying' | 'done' | 'error'; received: number; total: number; error?: string; startedAt: number }
const g = globalThis as unknown as { __studioDownloads?: Record<string, DownloadState> };
const downloads = () => (g.__studioDownloads ??= {});

export const isInstalled = (spec: ModelSpec) => fs.existsSync(modelFile(spec));
export const downloadStates = () => ({ ...downloads() });

/** Starts a verified, resumable-by-restart download. Only one download at a time; nothing starts without an explicit call. */
export function startDownload(spec: ModelSpec, freeDiskMB: number | null): { ok: true } | { ok: false; error: string; status: number } {
  if (!spec.sourceUrl) return { ok: false, status: 400, error: 'No verified download source is registered for this model.' };
  if (!spec.sha256) return { ok: false, status: 400, error: 'Refusing to download a model without a known SHA-256 to verify against.' };
  if (isInstalled(spec)) return { ok: false, status: 409, error: 'Already installed.' };
  if (Object.values(downloads()).some((d) => d.status === 'downloading' || d.status === 'verifying')) return { ok: false, status: 409, error: 'Another download is in progress.' };
  const needMB = Math.ceil(spec.downloadSizeMB * 1.3) + 2048; // headroom: temp file + 2 GB free for the OS
  if (freeDiskMB !== null && freeDiskMB < needMB) return { ok: false, status: 507, error: `Not enough free disk space: need about ${needMB} MB, have ${freeDiskMB} MB.` };
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const st: DownloadState = { status: 'downloading', received: 0, total: spec.downloadSizeMB * 1048576, startedAt: Date.now() };
  downloads()[spec.id] = st;
  void (async () => {
    const part = `${modelFile(spec)}.part`;
    try {
      const r = await fetch(spec.sourceUrl!, { redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`download failed: HTTP ${r.status}`);
      st.total = Number(r.headers.get('content-length')) || st.total;
      const out = fs.createWriteStream(part), hash = crypto.createHash('sha256');
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        hash.update(value); st.received += value.length;
        if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()));
      }
      await new Promise<void>((res, rej) => out.end((e: Error | null | undefined) => (e ? rej(e) : res())));
      st.status = 'verifying';
      if (hash.digest('hex') !== spec.sha256) throw new Error('SHA-256 mismatch: file discarded.');
      fs.renameSync(part, modelFile(spec)); st.status = 'done';
    } catch (e) {
      st.status = 'error'; st.error = e instanceof Error ? e.message : String(e);
      try { fs.unlinkSync(part); } catch { /* none */ }
    }
  })();
  return { ok: true };
}

export function removeModel(spec: ModelSpec): boolean {
  const f = modelFile(spec); if (!f.startsWith(MODELS_DIR) || !fs.existsSync(f)) return false;
  fs.unlinkSync(f); delete downloads()[spec.id]; return true;
}

export function gpuUsage(): { name: string; usedMB: number; totalMB: number; utilPct: number } | null {
  try {
    const o = execFileSync('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0].split(',').map((s) => s.trim());
    return { name: o[0], usedMB: +o[1], totalMB: +o[2], utilPct: +o[3] };
  } catch { return null; }
}

export function systemSnapshot() {
  const total = os.totalmem(), free = os.freemem();
  return { ramTotalMB: Math.round(total / 1048576), ramUsedMB: Math.round((total - free) / 1048576), load1: +os.loadavg()[0].toFixed(2), cpuCores: os.cpus().length, appRssMB: Math.round(process.memoryUsage().rss / 1048576), gpu: gpuUsage() };
}
export const findModel = (id: string) => MODEL_CATALOG.find((m) => m.id === id) ?? null;
