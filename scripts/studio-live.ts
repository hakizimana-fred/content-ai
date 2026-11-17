// Manual end-to-end check against the real local model (not part of test:studio). Usage: node scripts/studio-live.ts
import fs from 'node:fs';
import { createPlan, plannerStatus, resourceStatus } from '../src/lib/studio/service.ts';

const temp = () => { try { for (const z of fs.readdirSync('/sys/class/thermal')) { if (!z.startsWith('thermal_zone')) continue; if (fs.readFileSync(`/sys/class/thermal/${z}/type`, 'utf-8').trim() === 'x86_pkg_temp') return Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf-8')) / 1000; } } catch { /* ignore */ } return NaN; };
const st = plannerStatus();
console.log('planner:', st.spec.id, 'usable:', st.usable, st.reason ?? '');
const prompts = [
  'Turn this conversation into a 45-second TikTok. Find the most interesting moment, make the opening captivating, use cinematic captions, add a premium advertising-style soundtrack, introduce subtle sound effects and finish with a memorable ending.',
  'Generate a suspenseful documentary background with atmospheric percussion and a dark cinematic feeling.',
];
let base;
for (const p of prompts) {
  base = undefined; // each is a fresh request
  const t0 = Date.now(); const t = temp();
  const r = await createPlan(p, { base });
  console.log(`\n> ${p.slice(0, 80)}...\n  source=${r.source} model=${r.model} total=${((Date.now() - t0) / 1000).toFixed(1)}s llm=${r.llmMs ?? '-'}ms temp ${t}C -> ${temp()}C`);
  console.log('  explicit:', r.explicit.join(', ')); console.log('  warnings:', r.warnings.join(' | ') || 'none'); console.log('  ', JSON.stringify(r.plan));
  base = r.plan;
}
const rulesOnly = await createPlan(prompts[0], { useModel: false });
base = rulesOnly.plan;
// refinement that rules can handle: should be instant, no model call
let t0 = Date.now(); let r = await createPlan('Reduce the background music and make the subtitles larger', { base });
console.log(`\n> refine (rules) ${Date.now() - t0}ms source=${r.source} changed=${r.changedSections}`);
// vague refinement: needs the model
t0 = Date.now(); r = await createPlan('make it feel more like a thriller trailer', { base });
console.log(`> refine (model) ${((Date.now() - t0) / 1000).toFixed(1)}s source=${r.source} changed=${r.changedSections} warnings=${r.warnings.join('|') || 'none'}`);
console.log('  ', JSON.stringify(r.plan));
console.log('\nresources:', JSON.stringify(resourceStatus()));
process.exit(0);
