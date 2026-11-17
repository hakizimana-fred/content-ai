import { detectHardware } from './hardware.ts';
import { MODEL_CATALOG, ResourceManager, checkFit, type ModelSpec } from './models.ts';
import { LlamaServerRuntime, llamaChat, runtimeAvailable } from './llama-runtime.ts';
import { direct, type DirectorResult } from './director.ts';
import type { EditingPlan } from './plan.ts';
import { getPreferredPlannerId } from './settings.ts';


interface Singleton { manager: ResourceManager; runtime: LlamaServerRuntime }
const g = globalThis as unknown as { __studio?: Singleton };

/** One shared manager per server process (survives Next.js dev hot reloads) so only one model is ever resident. */
function manager(): ResourceManager {
  if (!g.__studio) {
    const runtime = new LlamaServerRuntime();
    g.__studio = { runtime, manager: new ResourceManager(runtime, () => detectHardware(), { idleUnloadMs: 120_000, requireCommercial: true }) };
  }
  return g.__studio.manager;
}

export function modelServerRssMB(): number | null { manager(); return g.__studio!.runtime.rssMB(); }

/** Run one real planning request and report timings (used by the Model Manager "Test" button). */
export async function testPlanner(spec: ModelSpec): Promise<{ ok: boolean; totalMs: number; llmMs: number | null; rssMB: number | null; source: string; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await direct('Make a 30 second vertical short with suspenseful music and bold captions, documentary feel.', {
      llm: (req) => manager().run(spec, 'model-test', () => llamaChat(req)),
    });
    return { ok: r.source === 'hybrid', totalMs: Date.now() - t0, llmMs: r.llmMs, rssMB: modelServerRssMB(), source: r.source, error: r.source === 'hybrid' ? undefined : r.warnings.join('; ') };
  } catch (e) {
    return { ok: false, totalMs: Date.now() - t0, llmMs: null, rssMB: modelServerRssMB(), source: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

export const DEFAULT_PLANNER_ID = 'qwen2.5-1.5b-instruct-q4km';

export function plannerStatus(spec: ModelSpec = MODEL_CATALOG.find((m) => m.id === (getPreferredPlannerId() ?? DEFAULT_PLANNER_ID)) ?? MODEL_CATALOG.find((m) => m.id === DEFAULT_PLANNER_ID)!) {
  const hw = detectHardware();
  const fit = checkFit(spec, hw, { requireCommercial: true });
  const rt = runtimeAvailable(spec);
  return { spec, usable: fit.ok && rt.ok, reason: !fit.ok ? fit.reason : !rt.ok ? rt.reason : null };
}

export function resourceStatus() { return manager().status(); }

/** Plan (or refine) from natural language. Uses the local model when it fits and is installed, otherwise rules only. */
export async function createPlan(instruction: string, opts: { base?: EditingPlan; useModel?: boolean } = {}): Promise<DirectorResult & { model: string | null }> {
  const st = plannerStatus();
  const wantModel = opts.useModel !== false;
  if (!wantModel || !st.usable) {
    const r = await direct(instruction, { base: opts.base });
    if (wantModel && st.reason) r.warnings.push(`local model not used: ${st.reason}`);
    return { ...r, model: null };
  }
  const result = await direct(instruction, {
    base: opts.base,
    llm: (req) => manager().run(st.spec, 'creative-director', () => llamaChat(req)),
  });
  return { ...result, model: result.source === 'hybrid' ? st.spec.id : null };
}
