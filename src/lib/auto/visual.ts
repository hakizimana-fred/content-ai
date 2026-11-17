// Visual Intelligence: chooses HOW each scene gets its visuals (flat 2D, layered 2.5D, real 3D) from what the video is about.
// Deterministic and inspectable: a domain is matched from the wording of the instruction, the domain supplies a recipe
// (direction, hero object, filler scenes), and every conversion is recorded in `decided` so the plan shows what was chosen and why.
import type { SceneSpec, Technique, ThreeSpec, Object3D, AutoConfig } from './types.ts';

export interface Domain {
  id: string; name: string; match: RegExp; direction: string; story: string[];
  /** intro treatment: hero object or extruded title */
  intro?: (accent?: string) => Partial<SceneSpec>;
  /** treatments applied to text-free ("abstract") scenes, in order */
  fillers: Partial<SceneSpec>[];
  photos?: boolean; palette?: { colors: string[]; accent: string; text?: string };
  why: string;
}

const warm = [-0.6, 0.7, 0.5] as [number, number, number];
const obj = (o: Object3D): Object3D => o;
const three = (t: ThreeSpec): ThreeSpec => t;

export const DOMAINS: Domain[] = [
  { id: 'luxury_fragrance', name: 'Luxury / fragrance', palette: { colors: ['#07050b', '#1b0f1f', '#43203a'], accent: '#e3b97a' }, match: /\b(perfume|fragrance|cologne|parfum|eau de|scent|jewel(?:l)?ery|watch(?:es)?|luxur(?:y|ious))\b/i, direction: 'editorial_luxe',
    story: ['reveal the object slowly', 'detail close-up', 'quiet statement', 'signature close'],
    intro: () => ({ kind: 'product3d', three: three({ objects: [obj({ shape: 'bottle', color: '#7d3052', spin: { dps: 30 }, metal: 0.2, gloss: 0.97 })], floor: -0.95, particles: 46, camera: { orbit: [-24, 22], dolly: [6.6, 5.4], height: 0.55 }, light: { key: warm } }) }),
    fillers: [
      { kind: 'product3d', three: three({ objects: [obj({ shape: 'gem', color: '#c9a35e', spin: { dps: 22, axis: 'y' }, tilt: 12, size: 0.9 })], floor: -1.0, particles: 30, camera: { orbit: [30, -10], dolly: [7.2, 6.4], height: 0.2 }, light: { key: [0.6, 0.8, 0.4] } }) },
    ],
    why: 'a premium object ad reads best as one object seen slowly in 3D under a moving camera, with sparse particles and restrained type' },
  { id: 'fitness', name: 'Fitness / sport', palette: { colors: ['#050607', '#12171a', '#1f3012'], accent: '#c6ff1a' }, match: /\b(fitness|gym|workout|training|athlet\w*|sport\w*|running|exercise|muscle|crossfit|yoga)\b/i, direction: 'kinetic_pop',
    story: ['hit hard with the name', 'energy of motion', 'proof of effort', 'call to act'],
    intro: () => ({ kind: 'title3d', three: three({ objects: [obj({ shape: 'text', spin: { dps: 16, start: -22 }, metal: 0.6 })], floor: -0.85, camera: { orbit: [-8, 8], dolly: [6.4, 5.6], height: 0.3 } }) }),
    fillers: [
      { kind: 'product3d', three: three({ objects: [obj({ shape: 'dumbbell', color: '#c6ff1a', spin: { dps: 60, axis: 'y' }, tilt: -14, size: 1.15 })], floor: -0.9, particles: 24, camera: { orbit: [-40, 40], dolly: [6.0, 4.8], height: 0.5 } }) },
      { kind: 'product3d', three: three({ objects: [obj({ shape: 'knot', color: '#c6ff1a', spin: { dps: 70, axis: 'y' }, size: 0.85 })], floor: -1.2, camera: { orbit: [20, -30], dolly: [5.6, 5.0], height: 0.4 } }) },
    ],
    why: 'sport content wants speed and mass: extruded type, heavy metallic objects spinning fast, wide fast camera orbits' },
  { id: 'fintech_education', name: 'Money / education explainer', palette: { colors: ['#06182e', '#0b3b6b', '#1a6fb0'], accent: '#3ddc97' }, match: /\b(mobile money|momo|m-?pesa|remit\w*|wallet|savings?|payments?|bank\w*|explain\w*|how .{0,20}works|tutorial|learn\w*|lesson|course|education\w*|financial literacy)\b/i, direction: 'clean_corporate',
    story: ['name the problem', 'show the idea as a picture', 'step through it', 'summarise and invite'],
    fillers: [
      { kind: 'scenery25', scenery: 'city', bg: 'sky' },
      { kind: 'product3d', three: three({ objects: [obj({ shape: 'coin', spin: { dps: 55, axis: 'y' }, tilt: 8, size: 0.85 })], floor: -1.0, particles: 18, camera: { orbit: [-18, 18], dolly: [7.0, 6.2], height: 0.4 } }) },
      { kind: 'product3d', three: three({ objects: [obj({ shape: 'phone', spin: { dps: 24, axis: 'y', start: -28 }, size: 1.15 })], floor: -1.1, camera: { orbit: [-10, 10], dolly: [6.4, 5.6], height: 0.3 } }) },
    ],
    why: 'an explainer needs concrete pictures of the idea: a city skyline (layered 2.5D), a coin and a phone in 3D, plus diagrams for steps' },
  { id: 'motivation', name: 'Motivational / story', palette: { colors: ['#14122b', '#3b2a5a', '#e2744f'], accent: '#ffbe76' }, match: /\b(motivat\w*|inspir\w*|journey|never give up|believe|dream\w*|courage|resilien\w*|perseveran\w*|success story|keep going|climb\w*)\b/i, direction: 'cinematic_film',
    story: ['quiet opening', 'the struggle', 'the turn', 'the horizon'],
    fillers: [
      { kind: 'journey3d', three: three({ objects: [], environment: 'terrain', camera: { speed: 1.1 } }), bg: 'sky' },
      { kind: 'scenery25', scenery: 'mountains', bg: 'sky' },
    ],
    why: 'a journey is shown as a journey: a real 3D terrain flyover, then layered mountain parallax toward a horizon' },
  { id: 'food_hospitality', name: 'Restaurant / food', palette: { colors: ['#1c0f07', '#3a2212', '#6b3f1d'], accent: '#e8b04a' }, match: /\b(restaurant|cafe|café|bistro|menu|chef|dining|bakery|coffee|kitchen|brunch|dish(?:es)?|cuisine)\b/i, direction: 'organic_calm',
    story: ['open on the food', 'let each dish breathe', 'the room and the welcome', 'book a table'], photos: true,
    fillers: [], why: 'food is sold by its photography: uploaded photos become floating depth cards with a blurred far layer and drifting light, not 3D objects' },
  { id: 'tech_app', name: 'App / software', palette: { colors: ['#05070f', '#0d1530', '#17306b'], accent: '#5cc8ff' }, match: /\b(app|software|saas|platform|startup|dashboard|api|ai|tech)\b/i, direction: 'tech_grid',
    story: ['state the product', 'show the interface', 'show the benefit', 'invite'],
    fillers: [{ kind: 'product3d', three: three({ objects: [obj({ shape: 'phone', spin: { dps: 22, start: -25 }, size: 1.15 })], floor: -1.1, camera: { orbit: [-12, 12], dolly: [6.4, 5.6], height: 0.3 } }) }],
    why: 'software is shown through its interface: a 3D phone with the screen as a textured plane' },
];

/** A repeated treatment is mirrored and re-posed so two scenes from one recipe never look the same. */
function variant(f: Partial<SceneSpec>, n: number): Partial<SceneSpec> {
  if (n === 0 || !f.three) return f;
  const c = JSON.parse(JSON.stringify(f)) as Partial<SceneSpec>; const cam = c.three!.camera; if (cam && Array.isArray(cam.orbit)) cam.orbit = [cam.orbit[1], cam.orbit[0]];
  if (c.three!.environment === 'terrain') { c.three!.seed = 3 + 11 * n; if (cam) cam.speed = (cam.speed ?? 1) * 0.8; }
  for (const o of c.three!.objects) { if (o.spin) o.spin.start = (o.spin.start ?? 0) + 70 * n; o.size = (o.size ?? 1) * 0.92; o.tilt = -(o.tilt ?? 6); } return c;
}
export const pickDomain = (prompt: string): Domain | undefined => DOMAINS.find((d) => d.match.test(prompt));

export const techniqueOf = (s: SceneSpec): Technique =>
  s.three ? 'real3d' : s.kind === 'scenery25' || s.kind === 'photo25d' || s.kind === 'showcase' || s.bg === 'geo' ? 'depth25d' : 'flat2d';

export interface VisualResult { scenes: SceneSpec[]; domain?: Domain; decided: string[] }

/** Upgrade a styled scene list with the domain's treatments. Text, facts and approvals are untouched: only visual fields change. */
export function applyVisuals(scenes: SceneSpec[], prompt: string, cfg: AutoConfig, opts: { hasPhotos: boolean; mixed: boolean; models?: { id: string; name: string }[]; maxScenes?: number }): VisualResult {
  const dom = pickDomain(prompt); const decided: string[] = [];
  const out0 = scenes.map((s) => ({ ...s }));
  // a 3D model the user uploaded is placed by the engine: no rendering instructions needed. Hero scene = intro (kept as title card if no title), then a close-up.
  const models = opts.models ?? [];
  if (models.length) {
    const hero = (m: { id: string }, kind: SceneSpec['kind'], orbit: [number, number], title?: string): Partial<SceneSpec> => ({ kind, creativeAssetId: m.id, title, three: { objects: [{ shape: 'glb', spin: { dps: 26 }, metal: 0.4, gloss: 0.7 }], floor: -0.95, particles: 28, camera: { orbit, dolly: [6.6, 5.6], height: 0.5 }, light: { key: warm } } });
    const i = out0.findIndex((s) => s.kind === 'intro'); const m0 = models[0];
    if (i >= 0 && out0[i].title) out0[i] = { ...out0[i], ...hero(m0, 'product3d', [-24, 22], out0[i].title) }; else out0.unshift({ id: 'model1', weight: 1.6, bg: 'aurora', ...hero(m0, 'product3d', [-24, 22]) } as SceneSpec);
    const j = out0.findIndex((s, k) => s.kind === 'abstract' && k > 0); if (j >= 0) out0[j] = { ...out0[j], ...hero(models[1] ?? m0, 'product3d', [28, -12]) };
    decided.push(`3D model "${m0.name}" placed as the hero object (software 3D engine, base colours only)`);
  }
  if (!dom || opts.mixed) return { scenes: out0, decided };
  const out = out0; let fi = 0;
  const wants3d = cfg.look?.bg === undefined;                    // an explicit background choice from the user wins over plan visuals
  if (dom.intro && wants3d && !models.length) { const i = out.findIndex((s) => s.kind === 'intro'); if (i >= 0 && out[i].title) { const p = dom.intro(); out[i] = { ...out[i], ...p, subtitle: out[i].subtitle }; decided.push(`intro → ${p.kind} (${dom.name})`); } }
  if (dom.photos || opts.hasPhotos) {
    for (const s of out) if (s.kind === 'image' || s.kind === 'footage') { s.kind = 'photo25d'; decided.push('photo scene → layered 2.5D card'); }
    // the user's own media is the content: it replaces filler scenes and is interleaved with the text instead of trailing at the end
    const photos = out.filter((s) => s.kind === 'photo25d');
    if (photos.length) {
      const rest = out.filter((s) => s.kind !== 'photo25d'); let keptAbstract = 0; const trimmed = rest.filter((s) => s.kind !== 'abstract' || ++keptAbstract <= 1);
      if (trimmed.length < rest.length) decided.push(`${rest.length - trimmed.length} text-free filler scene(s) dropped: your photos carry the video`);
      const intro = trimmed.filter((s) => s.kind === 'intro'), outro = trimmed.filter((s) => s.kind === 'outro'), mid = trimmed.filter((s) => s.kind !== 'intro' && s.kind !== 'outro'); const seq: SceneSpec[] = [];
      for (let i = 0; i < Math.max(photos.length, mid.length); i++) { if (photos[i]) seq.push(photos[i]); if (mid[i]) seq.push(mid[i]); }
      out.splice(0, out.length, ...intro, ...seq, ...outro);
    }
  }
  if (wants3d) for (let i = 0; i < out.length && dom.fillers.length; i++) if (out[i].kind === 'abstract') { out[i] = { ...out[i], ...variant(dom.fillers[fi % dom.fillers.length], Math.floor(fi / dom.fillers.length)) }; fi++; decided.push(`text-free scene → ${out[i].kind}${out[i].scenery ? ' (' + out[i].scenery + ')' : ''}`); }
  // guarantee: a domain recipe is visible even when the plan had no text-free scenes to convert. Treatments are inserted (never replacing text) while the scene budget allows.
  if (wants3d && dom.fillers.length) {
    const want = Math.min(2, dom.fillers.length), have = out.filter((x) => x.three || x.kind === 'scenery25' || x.kind === 'journey3d').length; const room = Math.max(0, (opts.maxScenes ?? 8) - out.length);
    for (let k = 0, add = Math.min(want - have, room); k < add; k++) {
      const f = dom.fillers[fi % dom.fillers.length]; fi++; const at = Math.max(1, Math.min(out.length - 1, Math.round(((k + 1) * (out.length - 1)) / (add + 1) + 1)));
      out.splice(at, 0, { id: `${f.kind}${k + 1}`, weight: 1.4, bg: 'aurora', ...variant(f, 0) } as SceneSpec); decided.push(`inserted a ${f.kind} scene (${dom.name}): the plan had no text-free scene to convert`);
    }
  }
  decided.unshift(`visual domain: ${dom.name}: ${dom.why}`);
  return { scenes: out, domain: dom, decided };
}
