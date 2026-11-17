import { buildCreativePlan, type PlanOpts } from './creative.ts';
import { getCreative } from './creative-assets.ts';
import { getProject, updateProject } from './store.ts';
import type { AutoProject, CreativePlan } from './types.ts';

/** Is a stored plan still valid for the project's current instruction and mode? */
export const planIsCurrent = (p: AutoProject) => !!p.creative && p.creative.originalPrompt === p.config.prompt;

export function creativeAssetsOf(p: AutoProject) {
  return (p.config.creativeAssetIds ?? []).map(getCreative).filter((x): x is NonNullable<typeof x> => !!x && ['background', 'photo', 'footage', 'overlay'].includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, name: x.name }));
}

/** Build (and store) the creative plan. `useModel` asks the local LLM first; any failure falls back to the keyword Director and says why. */
export async function generatePlan(projectId: string, opts: { useModel: boolean; auto?: boolean; signal?: AbortSignal }): Promise<CreativePlan> {
  const p = getProject(projectId); if (!p) throw new Error('project not found');
  const mode = p.config.mode ?? 'video'; const hasMedia = p.assets.some((a) => a.kind !== 'audio');
  const mixed = mode === 'mixed' && hasMedia;
  const po: PlanOpts = { seconds: p.config.durationSec, beat: 0.5, mixed, creativeAssets: creativeAssetsOf(p), signal: opts.signal };
  if (opts.useModel && !mixed) {
    const { plannerLLM } = await import('../studio/service.ts'); const m = plannerLLM('auto-creative-director');
    if (m.ok) po.llm = { id: m.id, run: m.llm }; else po.llmUnavailable = m.reason;
  }
  const plan = await buildCreativePlan(p.config.prompt, p.config, po);
  if (opts.auto) plan.auto = true;
  updateProject(projectId, (q) => { q.creative = plan; q.config = { ...q.config, copyApproval: undefined }; });
  return plan;
}
