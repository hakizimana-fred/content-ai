import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ModelRuntime, ModelSpec } from './models.ts';

/** Where the llama.cpp build and model files live (outside the repo; override with env vars). */
export const STUDIO_HOME = process.env.STUDIO_HOME || path.join(os.homedir(), '.local', 'share', 'content-ai');
export const LLAMA_SERVER_BIN = process.env.LLAMA_SERVER_BIN || path.join(STUDIO_HOME, 'llama.cpp', 'build', 'bin', 'llama-server');
export const MODELS_DIR = process.env.STUDIO_MODELS_DIR || path.join(STUDIO_HOME, 'models');
const PORT = Number(process.env.LLAMA_PORT || 8089);

export function modelFile(spec: ModelSpec): string {
  // qwen2.5-1.5b-instruct-q4km -> qwen2.5-1.5b-instruct-q4_k_m.gguf
  return path.join(MODELS_DIR, `${spec.id.replace(/q4km$/, 'q4_k_m')}.gguf`);
}

export function runtimeAvailable(spec: ModelSpec): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(LLAMA_SERVER_BIN)) return { ok: false, reason: `llama-server not found at ${LLAMA_SERVER_BIN}` };
  if (!fs.existsSync(modelFile(spec))) return { ok: false, reason: `model file missing: ${modelFile(spec)}` };
  return { ok: true };
}

/** Runs llama.cpp's server as a child process on localhost only (never network-exposed), at reduced CPU priority. */
export class LlamaServerRuntime implements ModelRuntime {
  private proc: ChildProcess | null = null;
  private ctx: number;

  constructor(opts: { contextSize?: number } = {}) { this.ctx = opts.contextSize ?? 2048; }

  /** Resident memory of the model server in MB, or null when not running. */
  rssMB(): number | null {
    const pid = this.proc?.pid;
    if (!pid) return null;
    try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf-8').match(/VmRSS:\s+(\d+) kB/); return m ? Math.round(Number(m[1]) / 1024) : null; } catch { return null; }
  }

  async load(spec: ModelSpec, opts: { threads: number }): Promise<void> {
    const avail = runtimeAvailable(spec);
    if (!avail.ok) throw new Error(avail.reason);
    const bin = path.dirname(LLAMA_SERVER_BIN);
    this.proc = spawn('nice', ['-n', '10', LLAMA_SERVER_BIN, '-m', modelFile(spec), '-t', String(opts.threads), '-c', String(this.ctx),
      '--host', '127.0.0.1', '--port', String(PORT), '--no-webui'], {
      env: { ...process.env, LD_LIBRARY_PATH: `${bin}${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}` },
      stdio: 'ignore',
    });
    const child = this.proc;
    process.once('exit', () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } });
    let exited = false;
    this.proc.once('exit', () => { exited = true; });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error('llama-server exited during startup');
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.unload(spec);
    throw new Error('llama-server did not become ready within 90s');
  }

  async unload(_spec: ModelSpec): Promise<void> {
    const p = this.proc;
    this.proc = null;
    if (!p || p.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { p.kill('SIGKILL'); resolve(); }, 5000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      p.kill('SIGTERM');
    });
  }
}

export interface ChatRequest { system: string; user: string; schema: object; maxTokens: number; signal?: AbortSignal }

/** Schema-constrained chat completion against the running llama-server. Returns the raw JSON text. */
export async function llamaChat(req: ChatRequest): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: req.signal ?? AbortSignal.timeout(180_000),
    body: JSON.stringify({
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      response_format: { type: 'json_object', schema: req.schema },
      temperature: 0.2,
      max_tokens: req.maxTokens,
    }),
  });
  if (!r.ok) throw new Error(`llama-server returned ${r.status}`);
  const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('llama-server returned no content');
  return text;
}
