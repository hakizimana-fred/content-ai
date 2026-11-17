import type { HardwareProfile } from './hardware.ts';

export type ModelKind = 'llm' | 'asr' | 'audio-gen';

export interface ModelSpec {
  id: string;
  kind: ModelKind;
  name: string;
  format: 'gguf' | 'ct2' | 'other';
  quant: string;
  downloadSizeMB: number;
  /** Estimated RAM when loaded (weights + KV cache at default context). */
  ramMB: number;
  minTier: 'low' | 'standard' | 'high';
  license: string;
  /** Weights AND generated outputs usable in commercial software with no extra agreement. */
  commercialOk: boolean;
  /** true only after the license text on the official model card was read and recorded. */
  licenseVerified: boolean;
  licenseNote: string;
  sourceUrl: string | null;
  /** Expected SHA-256 of the downloaded file; downloads are rejected on mismatch. */
  sha256?: string;
  offlineCapable: boolean;
  /** Part of the small default set recommended on first run. */
  recommendedDefault?: boolean;
}

/**
 * Catalog only: nothing is downloaded automatically. licenseVerified stays false until the
 * model card/LICENSE file has been checked against the exact file we ship or fetch.
 */
export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'qwen2.5-0.5b-instruct-q4km', kind: 'llm', name: 'Qwen2.5 0.5B Instruct', format: 'gguf', quant: 'Q4_K_M',
    downloadSizeMB: 469, ramMB: 700, minTier: 'low', license: 'Apache-2.0', commercialOk: true, licenseVerified: true,
    licenseNote: 'Hugging Face model card for Qwen/Qwen2.5-0.5B-Instruct-GGUF lists apache-2.0 (checked 2026-11-17; tag read from the card, full LICENSE text not reviewed). RAM figure is an estimate, not measured. Weakest planner: use only when RAM is very tight.',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db', offlineCapable: true,
  },
  {
    id: 'qwen2.5-1.5b-instruct-q4km', kind: 'llm', name: 'Qwen2.5 1.5B Instruct', format: 'gguf', quant: 'Q4_K_M',
    downloadSizeMB: 1065, ramMB: 1800, minTier: 'low', license: 'Apache-2.0', commercialOk: true, licenseVerified: true,
    licenseNote: 'Hugging Face model cards for Qwen/Qwen2.5-1.5B-Instruct and Qwen/Qwen2.5-1.5B-Instruct-GGUF list license apache-2.0 (checked 2026-11-17). The tag was read from the card; the full LICENSE text was not reviewed. Measured: 1.83 GB RSS, ~6 tok/s on i7-6600U.',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e', offlineCapable: true, recommendedDefault: true,
  },
  {
    id: 'qwen2.5-3b-instruct-q4km', kind: 'llm', name: 'Qwen2.5 3B Instruct', format: 'gguf', quant: 'Q4_K_M',
    downloadSizeMB: 2000, ramMB: 3000, minTier: 'standard', license: 'Qwen Research License (qwen-research)', commercialOk: false, licenseVerified: true,
    licenseNote: 'Hugging Face card for Qwen/Qwen2.5-3B-Instruct lists license "qwen-research" (checked 2026-11-17): NOT Apache-2.0. The card does not state what it permits, so it is treated as non-commercial. No download source is registered; blocked on this machine by tier and for commercial builds by licence.',
    sourceUrl: null, offlineCapable: true,
  },
];

export type ModelState = 'unloaded' | 'loading' | 'loaded' | 'error';

export interface LoadedModel { id: string; state: ModelState; ramMB: number; loadedAt: number | null; lastUsedAt: number | null; error?: string }

/** Runtime adapter (e.g. llama.cpp server). Injected so the manager can be tested without a real runtime. */
export interface ModelRuntime {
  load(spec: ModelSpec, opts: { threads: number }): Promise<void>;
  unload(spec: ModelSpec): Promise<void>;
}

export type Fit = { ok: true } | { ok: false; reason: string };

export function checkFit(spec: ModelSpec, hw: HardwareProfile, opts: { requireCommercial?: boolean } = {}): Fit {
  const order = { low: 0, standard: 1, high: 2 } as const;
  if (order[spec.minTier] > order[hw.tier]) return { ok: false, reason: `needs a ${spec.minTier} tier machine; this is ${hw.tier}` };
  if (spec.ramMB > hw.modelRamBudgetMB) return { ok: false, reason: `needs ~${spec.ramMB} MB RAM but the budget is ${hw.modelRamBudgetMB} MB` };
  if (opts.requireCommercial && !spec.commercialOk) return { ok: false, reason: 'license does not permit commercial use' };
  return { ok: true };
}

/**
 * Keeps at most ONE model resident, serialises all work through a queue,
 * and unloads after an idle timeout. Never loads a model that exceeds the RAM budget.
 */
export class ResourceManager {
  private current: { spec: ModelSpec; info: LoadedModel } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private queued = 0;
  private running: string | null = null;

  private runtime: ModelRuntime;
  private getHardware: () => HardwareProfile;
  private opts: { idleUnloadMs?: number; requireCommercial?: boolean };

  constructor(runtime: ModelRuntime, getHardware: () => HardwareProfile, opts: { idleUnloadMs?: number; requireCommercial?: boolean } = {}) {
    this.runtime = runtime;
    this.getHardware = getHardware;
    this.opts = opts;
  }

  status() {
    return {
      loaded: this.current ? { ...this.current.info } : null,
      queued: this.queued,
      running: this.running,
      budgetMB: this.getHardware().modelRamBudgetMB,
    };
  }

  /** Run `fn` with `spec` loaded. Jobs run strictly one at a time. */
  run<T>(spec: ModelSpec, label: string, fn: () => Promise<T>): Promise<T> {
    this.queued++;
    const job = this.chain.then(async () => {
      this.queued--;
      this.running = label;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      try {
        await this.ensureLoaded(spec);
        const out = await fn();
        if (this.current) this.current.info.lastUsedAt = Date.now();
        return out;
      } finally {
        this.running = null;
        this.armIdle();
      }
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  async unloadAll(): Promise<void> {
    await (this.chain = this.chain.then(() => this.unloadCurrent()));
  }

  private async ensureLoaded(spec: ModelSpec) {
    if (this.current?.spec.id === spec.id && this.current.info.state === 'loaded') return;
    const hw = this.getHardware();
    const fit = checkFit(spec, hw, { requireCommercial: this.opts.requireCommercial });
    if (!fit.ok) throw new Error(`Cannot load ${spec.id}: ${fit.reason}`);
    await this.unloadCurrent(); // never two models at once
    const info: LoadedModel = { id: spec.id, state: 'loading', ramMB: spec.ramMB, loadedAt: null, lastUsedAt: null };
    this.current = { spec, info };
    try {
      await this.runtime.load(spec, { threads: hw.inferenceThreads });
      info.state = 'loaded';
      info.loadedAt = Date.now();
    } catch (e) {
      this.current = null;
      throw new Error(`Failed to load ${spec.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async unloadCurrent() {
    if (!this.current) return;
    const { spec } = this.current;
    this.current = null;
    await this.runtime.unload(spec);
  }

  private armIdle() {
    const ms = this.opts.idleUnloadMs ?? 120_000;
    if (!this.current || this.queued > 0) return;
    this.idleTimer = setTimeout(() => {
      this.chain = this.chain.then(() => this.unloadCurrent()).catch(() => undefined);
    }, ms);
    this.idleTimer.unref?.();
  }
}
