import {
  AUDIO_MOODS, CAPTION_POSITIONS, CAPTION_PRESETS, DEFAULT_PLAN, ENDING_STYLES, FORMATS, FRAMINGS, INTENSITIES, STYLES,
  diffPlan, validatePlan, type EditingPlan,
} from './plan.ts';
import { applyRules, defaultMoodForStyle } from './rules.ts';

/** JSON schema handed to llama.cpp so decoding itself is constrained to valid plan structure and enum values. */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    format: { enum: [...FORMATS] },
    duration_target: { type: 'integer', minimum: 5, maximum: 180 },
    style: { enum: [...STYLES] },
    framing: { enum: [...FRAMINGS] },
    captions: {
      type: 'object',
      properties: { preset: { enum: [...CAPTION_PRESETS] }, position: { enum: [...CAPTION_POSITIONS] }, highlight_keywords: { type: 'boolean' } },
      required: ['preset', 'position', 'highlight_keywords'],
    },
    audio: {
      type: 'object',
      properties: {
        mood: { enum: [...AUDIO_MOODS] }, intensity: { enum: [...INTENSITIES] },
        music: { type: 'boolean' }, sound_effects: { type: 'boolean' }, ducking: { type: 'boolean' },
      },
      required: ['mood', 'intensity', 'music', 'sound_effects', 'ducking'],
    },
    ending: { type: 'object', properties: { style: { enum: [...ENDING_STYLES] } }, required: ['style'] },
  },
  required: ['format', 'duration_target', 'style', 'framing', 'captions', 'audio', 'ending'],
} as const;

type Obj = { type: 'object'; properties: Record<string, unknown>; required: string[] };
/**
 * Schema for ONLY the fields the rules did not decide. Fewer fields = fewer generated tokens (this CPU makes ~6 tokens/s) and
 * fewer chances for the model to contradict an explicit request. Returns null when nothing is left to decide.
 */
export function buildPlanSchema(explicit: string[]): Obj | null {
  const full = PLAN_JSON_SCHEMA as unknown as { properties: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const properties: Record<string, unknown> = {}, required: string[] = [];
  for (const [k, v] of Object.entries(full.properties)) {
    if (v.type === 'object') {
      const sub: Record<string, unknown> = {}, req: string[] = [];
      for (const [sk, sv] of Object.entries(v.properties)) if (!explicit.includes(`${k}.${sk}`)) { sub[sk] = sv; req.push(sk); }
      if (req.length) { properties[k] = { type: 'object', properties: sub, required: req }; required.push(k); }
    } else if (!explicit.includes(k)) { properties[k] = v; required.push(k); }
  }
  return required.length ? { type: 'object', properties, required } : null;
}

export type LlmFn = (req: { system: string; user: string; schema: object; maxTokens: number }) => Promise<string>;

export interface DirectorResult {
  plan: EditingPlan;
  /** "rules" = deterministic only; "hybrid" = rules + model for the unstated choices */
  source: 'rules' | 'hybrid';
  explicit: string[];
  changedSections: string[];
  notes: string[];
  warnings: string[];
  llmMs: number | null;
}

const SYSTEM = 'You are a short-form video creative director. Fill in the editing plan for the user\'s instruction. Choose a coherent production style, captions, audio and ending. Output JSON only.';

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k] as Record<string, unknown>; }
  o[keys[keys.length - 1]] = value;
}
function dropPath(obj: Record<string, unknown>, path: string) {
  const keys = path.split('.');
  let o: unknown = obj;
  for (const k of keys.slice(0, -1)) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  if (o && typeof o === 'object') delete (o as Record<string, unknown>)[keys[keys.length - 1]];
}

/** Models sometimes emit near-miss shapes (e.g. "ending": "clean_fade"). Repair only unambiguous cases. */
function repairShape(o: Record<string, unknown>) {
  if (typeof o.ending === 'string') o.ending = { style: o.ending };
  for (const k of ['captions', 'audio', 'pacing']) if (typeof o[k] !== 'object' || o[k] === null) delete o[k];
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/**
 * Instruction -> validated plan.
 *  1. Rules extract everything stated explicitly (always authoritative).
 *  2. The model (if provided) fills the remaining choices. Fresh plans always ask it; refinements ask only when
 *     the rules recognised nothing, so common tweaks ("quieter music") are instant and need no model at all.
 *  3. Invalid model fields are dropped individually, not the whole plan; any model failure falls back to rules.
 */
export async function direct(instruction: string, opts: { base?: EditingPlan; llm?: LlmFn } = {}): Promise<DirectorResult> {
  const text = instruction.trim();
  if (!text) throw new Error('Instruction is empty.');
  const isRefinement = !!opts.base;
  const base = opts.base ?? DEFAULT_PLAN;
  const rules = applyRules(text, base);
  const warnings: string[] = [];
  let source: DirectorResult['source'] = 'rules';
  let llmMs: number | null = null;
  let plan = rules.plan;

  // A fresh plan asks the model only for what the user did not state; if they stated everything, no model call is needed.
  const schema = isRefinement ? buildPlanSchema([]) : buildPlanSchema(rules.explicit);
  const needModel = !!opts.llm && !!schema && (!isRefinement || rules.explicit.length === 0);
  if (needModel && opts.llm) {
    const decided = Object.fromEntries(rules.explicit.map((p) => [p, get(rules.plan as unknown as Record<string, unknown>, p)]));
    const user = isRefinement
      ? `Current plan: ${JSON.stringify(base)}\nChange request: ${text}\nReturn the full updated plan.`
      : `Instruction: ${text}\nAlready decided (do not output these): ${JSON.stringify(decided)}\nOutput only the remaining fields.`;
    const t0 = Date.now();
    try {
      const raw = await opts.llm({ system: SYSTEM, user, schema: schema!, maxTokens: 300 });
      llmMs = Date.now() - t0;
      const obj = parseJson(raw);
      if (!obj) {
        warnings.push('model output was not valid JSON; used rules only');
      } else {
        repairShape(obj);
        for (const p of rules.explicit) setPath(obj, p, get(rules.plan as unknown as Record<string, unknown>, p)); // explicit cues win
        // Keep model-only fields out of the plan if they are invalid, one at a time.
        let result = validatePlan(obj, rules.plan);
        for (let i = 0; i < 8 && !result.ok; i++) {
          for (const e of result.errors) { const path = e.split(':')[0]; if (!path.includes(' ')) { dropPath(obj, path); warnings.push(`dropped invalid model value for ${path}`); } }
          result = validatePlan(obj, rules.plan);
        }
        if (result.ok) { plan = result.plan; source = 'hybrid'; warnings.push(...result.warnings); }
        else warnings.push('model plan could not be repaired; used rules only');
      }
    } catch (e) {
      llmMs = Date.now() - t0;
      warnings.push(`model unavailable (${e instanceof Error ? e.message : String(e)}); used rules only`);
    }
  }

  // Final safety pass: music needs a mood, mood must be consistent, speech must stay audible.
  if (plan.audio.music && plan.audio.mood === 'none') plan = { ...plan, audio: { ...plan.audio, mood: defaultMoodForStyle(plan.style) } };
  if (plan.audio.music && !plan.audio.ducking) plan = { ...plan, audio: { ...plan.audio, ducking: true } };
  const final = validatePlan(plan, base);
  if (!final.ok) throw new Error(`Internal error: director produced an invalid plan: ${final.errors.join('; ')}`);

  const changed = isRefinement ? diffPlan(base, final.plan) : [];
  if (isRefinement && changed.length === 0) warnings.push('no changes were produced; try a more specific instruction (e.g. "make the music quieter")');
  return {
    plan: final.plan, source, explicit: rules.explicit, notes: rules.notes,
    warnings: [...warnings, ...final.warnings], llmMs, changedSections: changed,
  };
}
