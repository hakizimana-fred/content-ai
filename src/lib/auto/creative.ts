import crypto from 'node:crypto';
import { applyVisuals, pickDomain } from './visual.ts';
import { applyBrand, type BrandCtx } from './brand.ts';
import { checkSuggested, classifyScenes, userSource } from './copy.ts';
import { ALL_DIRECTIONS, COMPOSITIONS, DIRECTIONS, directionById, lookFromDirection, pickDirection, styleScenes, type Direction } from './directions.ts';
import { bulletsOf, directIdea, explicitOverrides, stats, subjectPhrase } from './idea.ts';
import type { AutoConfig, BgType, Composition, CreativePlan, SceneKind, SceneSpec } from './types.ts';
import { AUDIO_MOODS } from '../studio/plan.ts';
import { interpretIntent } from './profiles.ts';
import { SFX_KINDS } from '../studio/sonic.ts';
import type { ChatRequest } from '../studio/llama-runtime.ts';

/**
 * Creative Director v2. A local open-weight model (when installed and the hardware allows) proposes a structured plan; every field is then
 * validated, clamped and provenance-checked by code before the renderer sees it. The keyword Director remains the fallback, and also
 * supplies every fact (numbers, bullet lists, quotes) because those must come from the user, not a model.
 */
export type Llm = (req: ChatRequest) => Promise<string>;
export interface PlanOpts { seconds: number; beat: number; mixed: boolean; creativeAssets?: { id: string; kind: string; name: string }[]; llm?: { id: string; run: Llm } | null; llmUnavailable?: string; signal?: AbortSignal; brand?: BrandCtx & { updatedAt?: number } }

const KINDS: SceneKind[] = ['text', 'quote', 'product', 'infographic', 'diagram', 'showcase', 'abstract'];
const ENDINGS = ['call_to_action', 'title_card', 'fade_out'] as const;
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['concept', 'audience', 'objective', 'direction', 'mood', 'ending', 'soundtrackMood', 'scenes'],
  properties: {
    concept: { type: 'string', maxLength: 140 }, audience: { type: 'string', maxLength: 80 }, objective: { type: 'string', maxLength: 80 },
    direction: { type: 'string', enum: ALL_DIRECTIONS.map((d) => d.id) },
    mood: { type: 'array', items: { type: 'string', maxLength: 20 }, maxItems: 4 },
    ending: { type: 'string', enum: [...ENDINGS] },
    soundtrackMood: { type: 'string', enum: [...AUDIO_MOODS] },
    soundtrackNotes: { type: 'string', maxLength: 100 },
    sfx: { type: 'array', items: { type: 'string', enum: [...SFX_KINDS] }, maxItems: 3 },
    headline: { type: 'string', maxLength: 60 }, subtitle: { type: 'string', maxLength: 60 }, cta: { type: 'string', maxLength: 40 },
    scenes: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
      kind: { type: 'string', enum: KINDS }, title: { type: 'string', maxLength: 60 }, weight: { type: 'number' },
      composition: { type: 'string', enum: ['default', 'slam', 'stack', 'split', 'wave', 'bar', 'cards', 'bignum', 'donuts'] },
      steps: { type: 'array', items: { type: 'string', maxLength: 24 }, maxItems: 4 },
    } } },
  },
};
const SYSTEM = `You are the creative director of a short video. Reply with JSON only.
Pick the visual direction that fits the idea: ${ALL_DIRECTIONS.map((d) => `${d.id} (${d.blurb})`).join('; ')}.
Plan 3 to 6 middle scenes (intro and ending are added for you). Scene kinds: text (one headline), quote, product (feature list), infographic (chart), diagram (steps), showcase (phone mockup), abstract (no text).
RULES: never invent facts, numbers, prices, places, names, ingredients, features or statistics. Headlines and hooks must be creative and short (max 7 words), e.g. "Your morning deserves better." Do not copy long phrases from the instruction. Use only words that make no factual claim.`;

const clamp = (n: unknown, lo: number, hi: number, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/[<>{}\\]/g, '').trim().slice(0, max) : '');
const id = () => crypto.randomBytes(4).toString('hex');

export interface ModelPlan { concept: string; audience: string; objective: string; direction: Direction; mood: string[]; ending: (typeof ENDINGS)[number]; soundtrackMood?: string; soundtrackNotes: string; sfx: string[]; headline?: string; subtitle?: string; cta?: string; scenes: SceneSpec[] }

/** Validate untrusted model JSON. Returns a clean ModelPlan or throws with the reason (caller falls back to the keyword Director). */
export function validateModelPlan(raw: unknown, cap: { maxScenes: number; allowShowcase?: boolean }): ModelPlan {
  if (!raw || typeof raw !== 'object') throw new Error('model output is not an object');
  const r = raw as Record<string, unknown>;
  const dir = directionById(str(r.direction, 30)); if (!dir) throw new Error('unknown direction');
  const scenesIn = Array.isArray(r.scenes) ? r.scenes : []; if (!scenesIn.length) throw new Error('no scenes');
  const scenes: SceneSpec[] = []; const counters: Record<string, number> = {};
  for (const sIn of scenesIn.slice(0, cap.maxScenes)) {
    if (!sIn || typeof sIn !== 'object') continue; const s = sIn as Record<string, unknown>;
    const kind = str(s.kind, 20) as SceneKind; if (!KINDS.includes(kind)) continue;
    counters[kind] = (counters[kind] ?? 0) + 1;
    const comp = str(s.composition, 12) as Composition; const spec: SceneSpec = { id: `${kind}${counters[kind]}`, kind, weight: clamp(s.weight, 0.7, 2.2, 1), bg: 'aurora' };
    if ((COMPOSITIONS[kind] ?? []).includes(comp)) spec.composition = comp;
    const t = str(s.title, 60); if (t && kind === 'text') spec.title = t;      // other kinds take their title from the user's subject, not from the model
    if (kind === 'diagram' && Array.isArray(s.steps)) { const st = s.steps.map((x) => str(x, 24)).filter(Boolean).slice(0, 4); if (st.length >= 2) spec.steps = st; }
    scenes.push(spec);
  }
  const seen = new Set<string>(); let abs = 0;
  const dedup = scenes.filter((s) => { const k = `${s.kind}|${(s.title ?? '').toLowerCase()}`; if (s.kind === 'abstract') { if (++abs > 2) return false; return true; } if (seen.has(k) && s.kind === 'text') return false; seen.add(k); return !(s.kind === 'showcase' && !cap.allowShowcase); });
  scenes.length = 0; scenes.push(...dedup);
  if (!scenes.length) throw new Error('no usable scenes');
  const conc = str(r.concept, 140); return { concept: /^[a-z_ ]+$/.test(conc) && conc.includes('_') ? '' : conc, audience: str(r.audience, 80), objective: str(r.objective, 80), direction: dir, mood: (Array.isArray(r.mood) ? r.mood : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 4),
    ending: (ENDINGS as readonly string[]).includes(str(r.ending, 20)) ? (str(r.ending, 20) as ModelPlan['ending']) : 'title_card',
    soundtrackMood: (AUDIO_MOODS as readonly string[]).includes(str(r.soundtrackMood, 20)) ? str(r.soundtrackMood, 20) : undefined, soundtrackNotes: str(r.soundtrackNotes, 100),
    sfx: (Array.isArray(r.sfx) ? r.sfx : []).map((x) => str(x, 20)).filter((x) => (SFX_KINDS as readonly string[]).includes(x)).slice(0, 3),
    headline: str(r.headline, 60) || undefined, subtitle: str(r.subtitle, 60) || undefined, cta: str(r.cta, 40) || undefined, scenes };
}

/** Safe, non-factual hook lines the keyword Director may suggest (always shown for approval, never rendered unapproved). */
const SHOWCASE_RE = /\b(app|website|dashboard|mock-?up|phone|screen|interface)\b/i;
export const userSteps = (prompt: string): string[] => { const m = /(?:steps?|process|how it works|workflow)\s*[:\-]\s*([^.\n]+)/i.exec(prompt)?.[1]; if (!m) return []; const st = m.split(/,|;|\u2192|->|\bthen\b/i).map((x) => x.trim()).filter((x) => x.length > 1 && x.length < 24).slice(0, 4); return st.length >= 2 ? st : []; };
const HOOKS = ['Ready when you are.', 'Make it yours.', 'Start here.', 'This is the moment.', 'Made to be noticed.', 'Meet what is next.'];

/** Convert planned scenes + user facts into the final scene list (adds charts/bullets only from user-provided facts). */
function withFacts(scenes: SceneSpec[], prompt: string, cfg: AutoConfig, mixed: boolean): SceneSpec[] {
  const st = stats(prompt), bl = bulletsOf(prompt), subject = subjectPhrase(prompt); const out: SceneSpec[] = [];
  let usedStats = false, usedBullets = false;
  for (const s of scenes) {
    const x = { ...s };
    if (x.kind === 'infographic') { if (st.length && !usedStats) { x.stats = st; usedStats = true; if (!x.title && subject) x.title = subject; } else x.kind = 'abstract'; }
    if (x.kind === 'product') { if (bl.length && !usedBullets) { x.bullets = bl; usedBullets = true; if (!x.title && subject) x.title = subject; } else x.kind = x.title ? 'text' : 'abstract'; }
    if (x.kind === 'diagram') { const us = userSteps(prompt); if (us.length) { x.steps = us; if (!x.title && subject) x.title = subject; } else if (!(x.steps && x.steps.length >= 2)) x.kind = 'abstract'; }
    out.push(x);
  }
  void cfg; void mixed;
  return out;
}

function asBg(s: SceneSpec, b: BgType): SceneSpec { return { ...s, bg: b }; }

const domainDirection = (prompt: string) => { const d = pickDomain(prompt); return d ? directionById(d.direction) : undefined; };
export async function buildCreativePlan(prompt: string, cfg: AutoConfig, opts: PlanOpts): Promise<CreativePlan> {
  const t0 = Date.now(); const src = userSource(prompt, cfg) + (opts.brand ? `\n${opts.brand.name}\n${opts.brand.tagline ?? ''}` : ''); const subject = subjectPhrase(prompt);
  const base = directIdea(prompt, cfg, { seconds: opts.seconds, beat: opts.beat, mixed: opts.mixed, creativeAssets: opts.creativeAssets });
  let source: CreativePlan['source'] = 'keywords', model: string | undefined, ms: number | undefined, fallbackReason = opts.llmUnavailable;
  let mp: ModelPlan | null = null; const notes = [...base.notes], decided = [...base.decided];
  if (opts.llm && !opts.mixed) {
    const maxScenes = Math.max(2, Math.min(6, Math.floor(opts.seconds / 3.2) - 2)); const m0 = Date.now();
    try {
      const raw = await opts.llm.run({ system: SYSTEM, user: `Instruction: ${prompt.slice(0, 700)}\nVideo length: ${Math.round(opts.seconds)} seconds. At most ${maxScenes} middle scenes.`, schema: SCHEMA, maxTokens: 650, signal: opts.signal });
      mp = validateModelPlan(JSON.parse(raw), { maxScenes, allowShowcase: SHOWCASE_RE.test(prompt) }); source = 'model'; model = opts.llm.id; ms = Date.now() - m0;
    } catch (e) { fallbackReason = `local model output not used (${(e as Error).message.slice(0, 90)})`; ms = Date.now() - m0; mp = null; }
  }

  let dir: Direction, scenes: SceneSpec[], concept = '', audience = 'not specified in your instruction', objective = 'not specified in your instruction', mood: string[] = [], ending = 'title_card', sMood: string | undefined, sNotes = '', sfx: string[] = [];
  const userKinds = new Set(base.scenes.map((s) => s.kind));
  if (mp) {
    const kwDir = DIRECTIONS.find((d) => d.match.test(prompt.toLowerCase())) ?? domainDirection(prompt); dir = kwDir ?? mp.direction; if (kwDir && kwDir.id !== mp.direction.id) decided.push(`direction: your wording matched ${kwDir.name}, so it overrides the model's pick (${mp.direction.name})`); concept = mp.concept; audience = mp.audience || audience; objective = mp.objective || objective; mood = mp.mood; ending = mp.ending; { const wording = interpretIntent(prompt, 'auto').mood; sMood = wording ?? mp.soundtrackMood; if (wording && mp.soundtrackMood && wording !== mp.soundtrackMood) decided.push(`soundtrack: your wording says "${wording}", which overrides the model's "${mp.soundtrackMood}"`); } sNotes = mp.soundtrackNotes; sfx = mp.sfx;
    const intro = base.scenes.find((s) => s.kind === 'intro'), outro = base.scenes.find((s) => s.kind === 'outro');
    const introS: SceneSpec = { ...(intro ?? { id: 'intro', kind: 'intro' as const, weight: 1.3, bg: 'aurora' as const }), title: intro?.title ?? mp.headline, subtitle: intro?.subtitle ?? mp.subtitle };
    const outroS: SceneSpec = { ...(outro ?? { id: 'outro', kind: 'outro' as const, weight: 1.3, bg: 'aurora' as const }), title: outro?.title ?? mp.headline, cta: outro?.cta ?? (ending === 'call_to_action' ? mp.cta : undefined) };
    // user-provided scenes (quotes, features, numbers) are kept in front of model scenes so facts are never lost
    const factual = base.scenes.filter((s) => ['quote', 'product', 'infographic', 'image', 'footage'].includes(s.kind));       // the user's own facts and media are never dropped
    const creative = withFacts(mp.scenes.filter((s) => !(s.kind === 'quote')), prompt, cfg, false).filter((s) => !(s.kind === 'product' && factual.some((f) => f.kind === 'product')) && !(s.kind === 'infographic' && factual.some((f) => f.kind === 'infographic')));
    const mid = [...creative, ...factual]; const cap = Math.max(2, Math.floor(opts.seconds / 2.2) - 2);
    const order = mid.slice(0, cap); scenes = [introS, ...order.map((s, i) => ({ ...s, id: s.id.replace(/\d+$/, '') + (i + 1) })), outroS];
    decided.push(`creative plan from local model ${model} in ${((ms ?? 0) / 1000).toFixed(1)} s`);
  } else {
    dir = DIRECTIONS.find((d) => d.match.test(prompt.toLowerCase())) ?? domainDirection(prompt) ?? pickDirection(prompt); scenes = base.scenes.map((s) => ({ ...s }));
    // creative hook suggestions replace up to two text-free scenes; they pass through the same claim check and approval as model copy
    let h = parseInt(crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 6), 16), n = 0;
    for (const s of scenes) if (s.kind === 'abstract' && n < 2) { const line = HOOKS[(h++) % HOOKS.length]; if (checkSuggested(line, src).ok) { s.kind = 'text'; s.title = line; n++; } }
    { const st = userSteps(prompt); if (st.length) { const i = scenes.findIndex((s) => s.kind === 'abstract' || s.kind === 'text'); const d = { id: 'diagram1', kind: 'diagram' as const, weight: 1.6, bg: 'aurora' as const, title: subject ?? undefined, steps: st }; if (i > 0) scenes.splice(i, 1, d); else scenes.splice(Math.max(1, scenes.length - 1), 0, d); } }
    if (SHOWCASE_RE.test(prompt) && !scenes.some((s) => s.kind === 'showcase')) { const i = scenes.findIndex((s) => s.kind === 'abstract'); const d = { id: 'showcase1', kind: 'showcase' as const, weight: 1.8, bg: 'aurora' as const, title: subject ?? undefined }; if (i > 0) scenes.splice(i, 1, d); else scenes.splice(Math.max(1, scenes.length - 1), 0, d); }
    concept = `${dir.name} video${subject ? ` about ${subject}` : ''}`;
    if (!fallbackReason && opts.llm === undefined) fallbackReason = undefined;
    decided.push('creative plan from keyword Director' + (fallbackReason ? ` (${fallbackReason})` : ''));
  }
  void userKinds;

  const cls = classifyScenes(scenes, src);
  let finalScenes = cls.scenes.map((s) => ({ ...s }));
  // a scene whose text was all stripped becomes a text-free scene instead of an empty card
  finalScenes = finalScenes.map((s) => {
    if (s.kind === 'text' && !s.title && !s.subtitle) return { ...s, kind: 'abstract' as const };
    if (s.kind === 'quote' && !s.quote) return { ...s, kind: 'abstract' as const };
    if (s.kind === 'product' && !s.bullets?.length) return { ...s, kind: s.title ? ('text' as const) : ('abstract' as const) };
    if (s.kind === 'diagram' && !(s.steps && s.steps.length >= 2 && userSteps(prompt).length >= 2)) return { ...s, kind: 'abstract' as const };       // a diagram needs steps the user actually listed
    return s;
  });
  finalScenes = styleScenes(finalScenes, dir, false);
  { const v = applyVisuals(finalScenes, prompt, cfg, { hasPhotos: finalScenes.some((s) => s.kind === 'image' || s.kind === 'footage'), mixed: opts.mixed, models: (opts.creativeAssets ?? []).filter((a) => a.kind === 'model'), maxScenes: Math.max(4, Math.floor(opts.seconds / 3.0)) }); finalScenes = v.scenes; decided.push(...v.decided); }
  const brandR = opts.brand ? applyBrand(finalScenes, opts.brand) : null; if (brandR) { finalScenes = brandR.scenes; decided.push(...brandR.decided); }
  const dom = pickDomain(prompt); const look = lookFromDirection(dir, { ...(dom?.palette && !cfg.look?.accent ? dom.palette : {}), ...(brandR?.look ?? {}), ...explicitOverrides(prompt, cfg) });
  if (cfg.look?.bg) finalScenes = finalScenes.map((s) => (s.bg === 'asset' ? s : asBg(s, cfg.look!.bg!)));
  for (const s of finalScenes) { const e = cfg.sceneEdits?.[s.id]; if (e) { Object.assign(s, e); s.prov = { ...(s.prov ?? {}) }; for (const k of Object.keys(e)) if (k in (s.prov ?? {})) (s.prov as Record<string, string>)[k] = 'user'; } }
  // reclassify after edits: edited text is the user's own words
  const cls2 = classifyScenes(finalScenes, src + '\n' + Object.values(cfg.sceneEdits ?? {}).flatMap((e) => Object.values(e).flat()).join('\n'));
  notes.push(...cls.rejected);
  if (source === 'keywords' && opts.llmUnavailable) notes.push(`Local model not used: ${opts.llmUnavailable}. The keyword Director planned this video.`);
  else if (source === 'keywords' && fallbackReason) notes.push(fallbackReason + '; the keyword Director planned this video.');
  decided.push(`direction: ${dir.name} (${dir.blurb})`);
  return { id: `cp_${id()}`, createdAt: Date.now(), source, model, ms: ms ?? Date.now() - t0, fallbackReason, originalPrompt: prompt, concept: concept || `${dir.name} video`, audience, objective, direction: dir.id, mood: mood.length ? mood : [dir.name.toLowerCase()],
    ending, soundtrack: { mood: sMood, notes: sNotes || 'chosen from the wording of your instruction' }, sfx, scenes: cls2.scenes, look, copy: cls2.copy, notes, decided,
    ...(opts.brand ? { brand: { id: opts.brand.id, name: opts.brand.name, decisions: brandR?.decided ?? [], updatedAt: opts.brand.updatedAt ?? 0 } } : {}) };
}

/** Apply everything that can change after a plan was made: approval, user text edits, removed scenes, look overrides. */
import { applyApproval } from './copy.ts';
import type { SceneLook } from './types.ts';
export function materialize(plan: CreativePlan, cfg: AutoConfig): { scenes: SceneSpec[]; look: SceneLook; dropped: string[]; used: number } {
  const ap = cfg.copyApproval && cfg.copyApproval.planId === plan.id ? cfg.copyApproval : undefined;
  const r = applyApproval(plan.scenes, plan.copy, ap); let scenes = r.scenes;
  for (const s of scenes) { const e = cfg.sceneEdits?.[s.id]; if (e) Object.assign(s, e); }
  scenes = scenes.filter((s) => !(cfg.excludeUnits ?? []).includes(`scene:${s.id}@0.0`));
  const look: SceneLook = { ...plan.look, ...explicitOverrides(plan.originalPrompt, cfg) };
  if (cfg.look?.bg) scenes = scenes.map((s) => (s.bg === 'asset' ? s : { ...s, bg: cfg.look!.bg! }));
  return { scenes, look, dropped: r.dropped, used: r.used };
}
