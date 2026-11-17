import type { AutoConfig, CopyItem, CopySource, SceneSpec } from './types.ts';

/**
 * Copy provenance and claim checking.
 *  user      : text the user wrote (found verbatim in their prompt / headline / CTA fields / approved edits)
 *  suggested : creative copy the Director proposed (headlines, hooks, CTAs). Shown for approval and never rendered unapproved.
 *  label     : structural words drawn by the renderer (step numbers, "%" signs). Not claims.
 * Provenance is decided HERE by comparing against the user's text, never by what a model says about its own output.
 */
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9'%$# ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Words that assert something checkable about a product, price, place, ingredient, result or reputation. */
const CLAIM_WORDS = [
  'best', 'number one', 'top rated', 'award', 'winning', 'guarantee', 'guaranteed', 'free', 'cheap', 'cheapest', 'cheaper', 'discount', 'sale', 'save', 'saves', 'off', 'deal', 'price', 'only', 'now',
  'organic', 'vegan', 'vegetarian', 'gluten', 'sugar', 'natural', 'handmade', 'homemade', 'ingredient', 'ingredients', 'made with', 'fresh baked', 'freshly',
  'certified', 'clinically', 'proven', 'cure', 'cures', 'risk', 'lifetime', 'unlimited', 'fastest', 'faster', 'lowest', 'cheapest', 'official', 'trusted', 'loved', 'customers', 'reviews', 'rated', 'verified',
  'waterproof', 'battery', 'hours', 'warranty', 'secure', 'safest', 'safe', 'instant', 'instantly', 'results', 'doubles', 'triples', 'boost', 'boosts', 'increase', 'increases', 'reduce', 'reduces',
  'delivery', 'shipping', 'open', 'closed', 'daily', 'everyday', 'since', 'years', 'nationwide', 'worldwide', 'local', 'locally',
];
const claimRe = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i');
/** Common sentence-opening / pronoun capitals that are not proper nouns. */
const SOFT_CAPS = new Set(['i', 'a', 'an', 'the', 'your', 'you', 'we', 'our', 'it', 'this', 'that', 'let', 'make', 'start', 'begin', 'meet', 'discover', 'find', 'feel', 'taste', 'try', 'join', 'see', 'be', 'get', 'every', 'what', 'why', 'how', 'when', 'there', 'for', 'to', 'built', 'made', 'ready', 'simple', 'smart', 'bold', 'new', 'now', 'today', 'tomorrow', 'dream', 'imagine', 'go', 'take', 'turn', 'do']);

export interface ClaimResult { ok: boolean; reason?: string }

/** Is this proposed line safe to show as *creative* copy (no facts the user did not give us)? `source` = everything the user supplied. */
export function checkSuggested(text: string, source: string): ClaimResult {
  const t = text.trim(), src = norm(source);
  if (!t) return { ok: false, reason: 'empty' };
  const words = t.split(/\s+/);
  if (/\b(our|the|a|an|and|with|to|of|for|your|in|on|at|by|or|is|are)$/i.test(t.replace(/[.!?]+$/, ''))) return { ok: false, reason: 'line is cut off mid-sentence' };
  if (/\b(no text|placeholder|lorem|mock-?up|text-free|scene|abstract|untitled|title here|headline)\b/i.test(t) && !/\b(no text|placeholder|lorem|mock-?up|text-free|scene|abstract|untitled|title here|headline)\b/i.test(source)) return { ok: false, reason: 'looks like a template label, not copy' };
  if (words.length > 9 || t.length > 70) return { ok: false, reason: 'too long for a headline or hook (9 words max)' };
  for (const d of t.match(/\d[\d.,]*/g) ?? []) if (!src.includes(norm(d))) return { ok: false, reason: `number "${d}" is not in your instruction` };
  if (/[$€£%#@]|https?:|www\.|\.com\b/i.test(t)) return { ok: false, reason: 'prices, percentages, handles and links must come from you' };
  for (const w of CLAIM_WORDS) if (claimRe(w).test(t) && !claimRe(w).test(source)) return { ok: false, reason: `"${w}" makes a factual claim you did not provide` };
  const raw = t.replace(/^[^A-Za-z]+/, '').split(/\s+/);
  for (let i = 1; i < raw.length; i++) {          // capitalised word mid-sentence that is not in the prompt = invented name or place
    const w = raw[i].replace(/[^A-Za-z']/g, ''); if (w.length < 2 || w !== w[0].toUpperCase() + w.slice(1).toLowerCase()) continue;
    if (!SOFT_CAPS.has(w.toLowerCase()) && !src.includes(w.toLowerCase())) return { ok: false, reason: `"${w}" looks like a name or place you did not provide` };
  }
  return { ok: true };
}

export const userSource = (prompt: string, cfg: Pick<AutoConfig, 'headline' | 'cta'>) => [prompt, cfg.headline ?? '', cfg.cta ?? ''].join(' \n ');
const isUserText = (text: string, source: string) => { const n = norm(text); return n.length > 0 && ` ${norm(source)} `.includes(` ${n} `); };

const TEXT_FIELDS = ['title', 'subtitle', 'cta', 'quote', 'attribution'] as const;
/** Fields where creative copy is allowed. Quotes, attributions and bullets/stats are facts: they must come from the user. */
const CREATIVE_OK = new Set(['title', 'subtitle', 'cta', 'steps']);

export interface Classified { scenes: SceneSpec[]; copy: CopyItem[]; rejected: string[] }

/**
 * Walk every text field of every scene, decide its provenance, strip anything that is an unsupported claim and
 * produce the copy table. Mutates nothing in the input.
 */
export function classifyScenes(input: SceneSpec[], source: string): Classified {
  const scenes: SceneSpec[] = JSON.parse(JSON.stringify(input)); const copy: CopyItem[] = []; const rejected: string[] = []; let n = 0;
  const add = (s: SceneSpec, field: string, text: string, src: CopySource, status: CopyItem['status'], reason?: string) => copy.push({ id: `c${++n}`, sceneId: s.id, field, text, source: src, status, reason });
  const judge = (s: SceneSpec, field: string, text: string): 'user' | 'suggested' | 'drop' => {
    if (isUserText(text, source)) { add(s, field, text, 'user', 'ok'); return 'user'; }
    if (!CREATIVE_OK.has(field)) { rejected.push(`${s.id}.${field} "${text.slice(0, 40)}" removed: this must come from you (it states a fact)`); add(s, field, text, 'suggested', 'rejected', 'must come from the user'); return 'drop'; }
    const r = checkSuggested(text, source);
    if (!r.ok) { rejected.push(`${s.id}.${field} "${text.slice(0, 40)}" removed: ${r.reason}`); add(s, field, text, 'suggested', 'rejected', r.reason); return 'drop'; }
    add(s, field, text, 'suggested', 'needs_review'); return 'suggested';
  };
  for (const s of scenes) {
    s.prov = {};
    for (const f of TEXT_FIELDS) {
      const v = s[f]; if (!v) continue;
      const j = judge(s, f, v); if (j === 'drop') delete s[f]; else s.prov[f] = j;
    }
    if (s.bullets?.length) {
      const keep = s.bullets.filter((b) => judge(s, 'bullets', b) === 'user'); s.bullets = keep.length ? keep : undefined; if (keep.length) s.prov.bullets = 'user';
    }
    if (s.steps?.length) {
      const res = s.steps.map((b) => ({ b, j: judge(s, 'steps', b) })); const keep = res.filter((x) => x.j !== 'drop');
      s.steps = keep.length >= 2 ? keep.map((x) => x.b) : undefined; if (keep.some((x) => x.j === 'suggested')) s.prov.steps = 'suggested'; else if (s.steps) s.prov.steps = 'user';
    }
    if (s.stats?.length) {   // a chart value is a statistic: it must be a number the user gave, with a label the user wrote
      s.stats = s.stats.filter((st) => { const ok = norm(source).includes(String(st.value).replace(/\.0+$/, '')) && isUserText(st.label, source); if (ok) add(s, 'stats', `${st.label}: ${st.value}${st.suffix ?? ''}`, 'user', 'ok'); else { rejected.push(`${s.id} chart "${st.label}" removed: its number is not in your instruction`); add(s, 'stats', `${st.label}: ${st.value}${st.suffix ?? ''}`, 'suggested', 'rejected', 'number not provided by the user'); } return ok; });
      if (!s.stats.length) s.stats = undefined;
    }
  }
  return { scenes, copy, rejected };
}

/**
 * Apply the user's approval. Suggested lines not in `approved` are removed; edits replace text and become the user's own words.
 * A scene left with nothing to show falls back to a text-free scene kind so the renderer never gets an empty text scene.
 */
export function applyApproval(scenes: SceneSpec[], copy: CopyItem[], approval?: { approved: string[]; edits?: Record<string, string> }): { scenes: SceneSpec[]; dropped: string[]; used: number } {
  const out: SceneSpec[] = JSON.parse(JSON.stringify(scenes)); const dropped: string[] = []; let used = 0; const ok = new Set(approval?.approved ?? []);
  const arrSeen: Record<string, number> = {};
  for (const c of copy) {
    if (c.source !== 'suggested' || c.status !== 'needs_review') continue;
    const s = out.find((x) => x.id === c.sceneId); if (!s) continue; const f = c.field as keyof SceneSpec;
    if (!ok.has(c.id)) {
      dropped.push(`${c.sceneId}.${c.field} "${c.text}"`);
      if (c.field === 'steps') { s.steps = s.steps?.filter((x) => x !== c.text); if (s.steps && s.steps.length < 2) s.steps = undefined; } else delete (s as unknown as Record<string, unknown>)[f];
      continue;
    }
    used++; const edit = approval?.edits?.[c.id]?.trim();
    if (edit && edit !== c.text) {
      if (c.field === 'steps') { const i = (arrSeen[s.id] = arrSeen[s.id] ?? 0); void i; s.steps = s.steps?.map((x) => (x === c.text ? edit : x)); } else (s as unknown as Record<string, unknown>)[f] = edit;
    }
  }
  for (const s of out) {
    const empty = (s.kind === 'intro' || s.kind === 'text' || s.kind === 'outro') && !s.title && !s.cta && !s.subtitle;
    if (empty) { s.kind = 'abstract'; }
    if (s.kind === 'diagram' && !(s.steps?.length)) s.kind = 'abstract';
  }
  return { scenes: out, dropped, used };
}

export function pendingReview(copy: CopyItem[]) { return copy.filter((c) => c.source === 'suggested' && c.status === 'needs_review'); }
