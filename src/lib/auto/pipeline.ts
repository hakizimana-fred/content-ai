import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyseProject } from './analyze.ts';
import { compose } from './compose.ts';
import { STYLE_PROFILES, interpretIntent } from './profiles.ts';
import { renderProject } from './render.ts';
import { resolveSoundtrack } from './soundtrack.ts';
import { assetPath, getProject, renderDir, updateProject } from './store.ts';
import type { AutoAsset, AutoProject, StageState } from './types.ts';
import { applyRules } from '../studio/rules.ts';
import { DEFAULT_PLAN } from '../studio/plan.ts';

export const STAGE_DEFS: { id: string; label: string }[] = [
  { id: 'analyse', label: 'Analyse materials' }, { id: 'understand', label: 'Understand creative instruction' }, { id: 'plan', label: 'Generate production plan' },
  { id: 'compose', label: 'Select and arrange footage' }, { id: 'shots', label: 'Apply motion and visual effects' }, { id: 'transcribe', label: 'Captions and text' },
  { id: 'join', label: 'Assemble and synchronise to the beat' }, { id: 'audio', label: 'Soundtrack and audio mix' }, { id: 'finish', label: 'Finish' },
];

interface Job { projectId: string; cancelled: boolean; startedAt: number }
const g = globalThis as unknown as { __autoJob?: Job | null };
export const currentJob = () => g.__autoJob ?? null;
export function cancelJob(projectId: string): boolean { const j = g.__autoJob; if (j && j.projectId === projectId) { j.cancelled = true; return true; } return false; }

const stableSeed = (id: string) => parseInt(crypto.createHash('sha1').update(id).digest('hex').slice(0, 6), 16) % 9000 + 1;

/** Start a render in the background. Only one runs at a time (low-resource laptops). Returns immediately; poll the project for stage state. */
export function startRender(projectId: string, opts: { transcribe?: (a: AutoAsset, p: AutoProject) => Promise<{ segments: unknown[] } | null> } = {}): { ok: true } | { ok: false; error: string; status: number } {
  const p = getProject(projectId); if (!p) return { ok: false, error: 'project not found', status: 404 };
  if (g.__autoJob) return { ok: false, error: g.__autoJob.projectId === projectId ? 'This video is already being made.' : 'Another video is being made. Wait for it to finish.', status: 409 };
  if (!p.assets.some((a) => a.kind !== 'audio')) return { ok: false, error: 'Add at least one photo or video first.', status: 400 };
  if (!p.config.prompt.trim()) return { ok: false, error: 'Describe the video you want first.', status: 400 };
  const job: Job = { projectId, cancelled: false, startedAt: Date.now() }; g.__autoJob = job;
  updateProject(projectId, (q) => { q.render = { jobId: crypto.randomBytes(4).toString('hex'), running: true, startedAt: Date.now(), stages: STAGE_DEFS.map((s) => ({ ...s, status: 'pending' as const })) }; });
  void execute(job, opts).finally(() => { g.__autoJob = null; });
  return { ok: true };
}

let lastWrite = 0;
function setStage(projectId: string, id: string, patch: Partial<StageState>, force = false) {
  const now = Date.now(); if (!force && patch.status === 'running' && now - lastWrite < 700) return; lastWrite = now;
  updateProject(projectId, (q) => { const s = q.render.stages.find((x) => x.id === id); if (s) { if (patch.status === 'running' && !s.ms) (s as StageState & { t0?: number }).t0 ??= now; Object.assign(s, patch); const t0 = (s as StageState & { t0?: number }).t0; if (patch.status === 'done' && t0) s.ms = now - t0; } });
}

async function execute(job: Job, opts: { transcribe?: (a: AutoAsset, p: AutoProject) => Promise<{ segments: unknown[] } | null> }) {
  const id = job.projectId; const st = (sid: string, patch: Partial<StageState>) => setStage(id, sid, patch, patch.status !== 'running');
  let current = 'analyse';
  try {
    let p = getProject(id)!;
    // 1. analyse
    st('analyse', { status: 'running', detail: 'looking at your photos and videos', progress: 0 });
    const needs = p.assets.filter((a) => (a.kind === 'video' && !a.video) || (a.kind === 'audio' && !a.audio)).length;
    p = await analyseProject(p, (done, total, label) => { if (job.cancelled) throw new Error('Cancelled'); setStage(id, 'analyse', { status: 'running', detail: total ? `analysing ${label} (${done + 1} of ${total})` : 'photos were analysed on upload', progress: total ? Math.round((done / total) * 100) : 100 }); });
    st('analyse', { status: 'done', detail: `${p.assets.filter((a) => a.kind === 'photo').length} photos, ${p.assets.filter((a) => a.kind === 'video').length} videos${needs ? ` (${needs} analysed now)` : ' (analysis reused)'}`, progress: 100 });
    if (job.cancelled) throw new Error('Cancelled');

    // 2. understand the instruction (rules first; optional local model)
    current = 'understand'; st('understand', { status: 'running', detail: 'reading your instruction', progress: 0 });
    let plan = applyRules(p.config.prompt, { ...DEFAULT_PLAN }).plan, planSource = 'rules', modelNote = '';
    if (p.config.useModel) {
      try { const { createPlan } = await import('../studio/service.ts'); const r = await createPlan(p.config.prompt, { useModel: true }); plan = r.plan; planSource = r.source; if (r.warnings.length) modelNote = r.warnings[0]; }
      catch (e) { modelNote = `local model not used: ${(e as Error).message.slice(0, 80)}`; }
    }
    const intent = interpretIntent(p.config.prompt, p.config.style, plan.style, plan.audio.mood);
    if (p.config.musicVariation && intent.mood === null) intent.mood = null;
    st('understand', { status: 'done', detail: `style: ${intent.style}; ${intent.why.slice(0, 2).join('; ')}${modelNote ? ` (${modelNote})` : ''}`, progress: 100 });

    // 3. plan: soundtrack first, because the cut points are placed on its beats
    current = 'plan'; st('plan', { status: 'running', detail: 'choosing the soundtrack', progress: 0 });
    const profile = STYLE_PROFILES[intent.style];
    const sound = resolveSoundtrack(p, { ...intent });
    if (sound.source === 'generated' && p.config.musicVariation) { sound.seed = ((sound.seed ?? 1) + p.config.musicVariation * 37) % 9000 + 1; const { musicBpm } = await import('../studio/sonic.ts'); sound.bpm = musicBpm(sound.mood!, sound.seed); sound.label = `generated ${sound.mood} #${sound.seed}`; }
    st('plan', { status: 'done', detail: `${sound.label}: ${sound.reason}`, progress: 100 });
    if (job.cancelled) throw new Error('Cancelled');

    // 4. compose
    current = 'compose'; st('compose', { status: 'running', detail: 'selecting and ordering shots', progress: 0 });
    const timeline = compose({ assets: p.assets, config: p.config, profile, intent, grid: { bpm: sound.bpm, beatOffset: sound.beatOffset, mood: sound.mood, seed: sound.seed }, seed: stableSeed(p.id) });
    p = updateProject(id, (q) => { q.timeline = timeline; q.plan = { plan, planSource, intent, soundtrack: { ...sound, file: undefined } }; })!;
    st('compose', { status: 'done', detail: `${timeline.shots.length} shots, ${timeline.total.toFixed(1)} s${timeline.dropped.length ? `, ${timeline.dropped.length} left out` : ''}`, progress: 100 });

    // 5-8. render (shots, captions, join, audio)
    const result = await renderProject({ project: p, timeline, soundtrack: sound, intent, profile, signal: job,
      stage: (sid, patch) => { current = sid; setStage(id, sid, patch, patch.status !== 'running'); },
      transcribe: opts.transcribe ? (a) => opts.transcribe!(a, p) : undefined });

    current = 'finish'; st('finish', { status: 'running', detail: 'saving the video' });
    const out = path.join(renderDir(id), `video_${Date.now()}.mp4`); fs.copyFileSync(result.file, out);
    for (const f of fs.readdirSync(renderDir(id)).filter((x) => /^video_\d+\.mp4$/.test(x)).sort().slice(0, -3)) try { fs.unlinkSync(path.join(renderDir(id), f)); } catch { /* ignore */ }
    updateProject(id, (q) => { q.render = { ...q.render, running: false, error: undefined, outputFile: path.basename(out), outputUrl: `/api/auto/output?project=${id}&file=${path.basename(out)}`, outputSeconds: result.seconds, finishedAt: Date.now(), applied: result.applied, skipped: result.skipped }; });
    st('finish', { status: 'done', detail: `${result.seconds.toFixed(1)} s video ready`, progress: 100 });
  } catch (e) {
    const msg = (e as Error).message === 'Cancelled' ? 'Cancelled by you.' : (e as Error).message.slice(0, 400);
    updateProject(id, (q) => { q.render.running = false; q.render.error = msg; q.render.finishedAt = Date.now(); const s = q.render.stages.find((x) => x.id === current); if (s && s.status !== 'done') { s.status = 'error'; s.detail = msg; } });
    console.error('Auto Studio render failed:', e);
  }
}
void assetPath;
