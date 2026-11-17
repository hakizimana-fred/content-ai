// Benchmarks the local Creative Director: latency, JSON validity, and how much of the model's copy survives the claim check.
// usage: node --import ./scripts/ts-resolve.mjs scripts/bench-director.ts
import { plannerLLM } from '../src/lib/studio/service.ts';
import { buildCreativePlan } from '../src/lib/auto/creative.ts';
import { DEFAULT_CONFIG } from '../src/lib/auto/types.ts';
import { pendingReview } from '../src/lib/auto/copy.ts';

const PROMPTS = [
  'Create a 30 second futuristic promo video for an AI technology company with neon visuals and electronic music.',
  'A calm morning coffee ad. Elegant, slow, warm light.',
  'Explain how our app works. Steps: sign up, connect your bank, track spending. Clean corporate look. 40% faster setup.',
  'Energetic restaurant promo with bold text and a call to action "Book a table".',
  'Cinematic travel teaser about a journey through the mountains.',
];
const p = plannerLLM('bench');
if (!p.ok) { console.log('model unavailable:', p.reason); process.exit(1); }
console.log('model:', p.id);
let ok = 0, tot = 0;
for (const prompt of PROMPTS) {
  const t = Date.now();
  const plan = await buildCreativePlan(prompt, { ...DEFAULT_CONFIG, prompt, mode: 'idea' }, { seconds: 30, beat: 0.5, mixed: false, llm: { id: p.id, run: p.llm } });
  tot++; if (plan.source === 'model') ok++;
  const rej = plan.notes.filter((n) => /removed/.test(n)).length;
  console.log(`\n"${prompt.slice(0, 60)}…"\n  ${plan.source} in ${((Date.now() - t) / 1000).toFixed(1)} s${plan.fallbackReason ? ' (' + plan.fallbackReason + ')' : ''}  direction=${plan.direction}  scenes=${plan.scenes.map((s) => s.kind + (s.composition ? ':' + s.composition : '')).join(' > ')}`);
  console.log(`  suggested copy awaiting approval: ${pendingReview(plan.copy).map((c) => `"${c.text}"`).join(', ') || 'none'}; rejected claims: ${rej}`);
  for (const n of plan.notes.filter((x) => /removed/.test(x))) console.log('   -', n);
}
console.log(`\nvalid model plans: ${ok}/${tot}`);
process.exit(0);
