import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoidea-')); process.env.STUDIO_DATA_DIR = path.join(dir, 'studio'); process.env.AUTO_DATA_DIR = path.join(dir, 'auto'); fs.mkdirSync(process.env.STUDIO_DATA_DIR);
const keep = process.env.KEEP === '1', SCRATCH = '/tmp/claude-1000/-home-fred-Development-side-projects-content-ai/989875af-0eef-454b-a314-d07a3c18513e/scratchpad/auto';
const { createProject, getProject, updateProject } = await import('../src/lib/auto/store.ts');
const { startRender } = await import('../src/lib/auto/pipeline.ts');
const { refine } = await import('../src/lib/auto/refine.ts');
const { probeMedia } = await import('../src/lib/studio/mix.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');

// the spec's example, with NO uploaded media
const PROMPT = 'Create a 30-second futuristic advertisement for an AI technology company. Use dark backgrounds, elegant animated typography, electronic background music and cinematic transitions. 50% faster answers. Features: runs on your laptop, private by design.';
const p = createProject('Idea', { prompt: PROMPT, mode: 'idea', format: '9:16', durationSec: 30, quality: 'preview', audioMode: 'auto', headline: undefined, cta: 'Try it today' });
assert.equal(p.assets.length, 0);
async function render(label: string) {
  const t0 = Date.now(); const r = startRender(p.id); assert.equal((r as { ok: boolean }).ok, true, JSON.stringify(r));
  while (getProject(p.id)!.render.running) await new Promise((x) => setTimeout(x, 400));
  const d = getProject(p.id)!; assert(!d.render.error, d.render.error);
  console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`); for (const s of d.render.stages) console.log(`   ${s.status.padEnd(8)} ${s.id.padEnd(10)} ${String(s.ms ?? 0).padStart(6)}ms ${s.detail ?? ''}`.slice(0, 200));
  return d;
}
const d1 = await render('PREVIEW 540x960 (first render)');
const tl = d1.timeline!; console.log('scenes:', tl.shots.map((s) => `${s.scene!.kind}/${s.len.toFixed(1)}s/${s.transitionOut?.type ?? 'end'}`).join('  '));
console.log('applied:', d1.render.applied);
const qc = d1.render.qc!; assert(qc, 'QC report was produced'); for (const c of qc.checks) console.log(`   QC ${c.status.padEnd(7)} ${c.label}: ${c.detail}`);
assert(qc.verdict !== 'fail', 'QC must not fail: ' + qc.checks.filter((c) => c.status === 'fail').map((c) => c.label + ' - ' + c.detail).join('; '));
assert(tl.shots.every((s) => s.kind === 'scene'), 'only generated scenes');
assert(tl.shots.length >= 4, 'several scenes'); assert(Math.abs(tl.total - 30) <= 1.2, `~30 s, got ${tl.total}`);
assert(tl.shots.some((s) => s.scene!.kind === 'infographic'), 'numbers from the prompt became a chart scene'); assert(tl.shots.some((s) => s.scene!.kind === 'product'), 'features became a product scene');
const texts = tl.shots.flatMap((s) => [s.scene!.title, s.scene!.subtitle, s.scene!.cta, ...(s.scene!.bullets ?? []), ...(s.scene!.stats ?? []).map((x) => x.label)]).filter(Boolean).join(' | ').toLowerCase();
console.log('on-screen words:', texts); for (const w of texts.split(/[\s|.,]+/).filter((x) => x.length > 3)) assert(PROMPT.toLowerCase().includes(w) || 'try it today'.includes(w), `"${w}" is not from the user's own words`);
const out = path.join(process.env.AUTO_DATA_DIR!, p.id, 'render', d1.render.outputFile!); const m = await probeMedia(out);
const dim = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim();
console.log('output', m.duration.toFixed(2), 's', dim, 'audio', m.hasAudio); assert.equal(dim, '540,960'); assert(m.hasAudio); assert(Math.abs(m.duration - tl.total) < 0.3);
const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vol)![1]); assert(mean > -40, 'audible'); console.log('audio mean', mean);
// not a slideshow: consecutive frames inside a scene differ (animated background/typography)
const a = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'select=eq(n\\,40)+eq(n\\,46),scale=64:-1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout as Buffer; const half = a.length / 2; let diff = 0; for (let i = 0; i < half; i++) diff += Math.abs(a[i] - a[half + i]); console.log('inter-frame motion', (diff / half).toFixed(2)); assert(diff / half > 0.5, 'frames inside a scene move');
if (keep) { fs.mkdirSync(SCRATCH, { recursive: true }); fs.copyFileSync(out, path.join(SCRATCH, 'idea_preview.mp4')); spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', out, '-vf', `select='eq(n,20)+eq(n,110)+eq(n,230)+eq(n,330)+eq(n,430)+eq(n,520)+eq(n,640)+eq(n,800)',scale=216:-1,tile=8x1`, '-frames:v', '1', path.join(SCRATCH, 'idea_frames.png')]); }

// refine: text change re-renders only what changed; a music change reuses every scene and the assembly
const r1 = refine(getProject(p.id)!, 'Reduce the background music'); updateProject(p.id, (q) => { q.config = r1.config; });
const d2 = await render('REFINE: reduce music (audio only)');
assert(/reused/.test(d2.render.stages.find((s) => s.id === 'shots')!.detail!), 'scenes reused'); assert(/reused the previous assembly/.test(d2.render.stages.find((s) => s.id === 'join')!.detail!), 'assembly reused');
const r2 = refine(getProject(p.id)!, 'Use a grid background'); updateProject(p.id, (q) => { q.config = r2.config; });
const r3 = refine(getProject(p.id)!, 'Make the headline "Nova Mind"'); assert(!r3.unrecognised); updateProject(p.id, (q) => { q.config = r3.config; });
if (process.env.FINAL === '1') {
  updateProject(p.id, (q) => { q.config = { ...q.config, quality: 'final' }; });
  const d3 = await render('FINAL 1080x1920'); const o3 = path.join(process.env.AUTO_DATA_DIR!, p.id, 'render', d3.render.outputFile!);
  const dim3 = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', o3], { encoding: 'utf8' }).stdout.trim(); assert.equal(dim3, '1080,1920');
  if (keep) fs.copyFileSync(o3, path.join(SCRATCH, 'idea_final.mp4'));
}
closeStudioDb(); fs.rmSync(dir, { recursive: true, force: true }); console.log('auto idea test passed');
