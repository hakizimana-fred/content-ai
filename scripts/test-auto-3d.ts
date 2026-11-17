// Visual intelligence + 3D engine tests: domain selection, honest technique labels, GLB validation and rendering through the real scene renderer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickDomain, applyVisuals, techniqueOf, DOMAINS } from '../src/lib/auto/visual.ts';
import { buildCreativePlan } from '../src/lib/auto/creative.ts';
import { DEFAULT_CONFIG, type AutoConfig, type SceneSpec } from '../src/lib/auto/types.ts';

const cfg = (o: Partial<AutoConfig> = {}): AutoConfig => ({ ...DEFAULT_CONFIG, mode: 'idea', ...o });
const PY = path.join(process.cwd(), '.venv/bin/python3'), SRC = path.join(process.cwd(), 'src/lib/auto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a3d-'));

// domains are chosen by subject, and unrelated subjects get different recipes
const subjects: Record<string, string> = { luxury_fragrance: 'A premium perfume advertisement for NOIR', fitness: 'Energetic gym workout ad', fintech_education: 'Educational explainer about mobile money', motivation: 'A motivational story about never giving up', food_hospitality: 'Restaurant ad for a bistro' };
for (const [id, p] of Object.entries(subjects)) assert.equal(pickDomain(p)?.id, id, p);
assert.equal(pickDomain('a video about nothing in particular'), undefined, 'no domain, no forced treatment');
assert.equal(new Set(DOMAINS.map((d) => d.direction)).size >= 5, true, 'domains map to different directions');

// technique labels never claim 3D for 2D effects
const s = (o: Partial<SceneSpec>): SceneSpec => ({ id: 'x', kind: 'abstract', weight: 1, bg: 'aurora', ...o });
assert.equal(techniqueOf(s({ kind: 'scenery25', scenery: 'city' })), 'depth25d'); assert.equal(techniqueOf(s({ kind: 'photo25d' })), 'depth25d');
assert.equal(techniqueOf(s({ kind: 'showcase' })), 'depth25d'); assert.equal(techniqueOf(s({ kind: 'text' })), 'flat2d');
assert.equal(techniqueOf(s({ kind: 'product3d', three: { objects: [{ shape: 'bottle' }] } })), 'real3d');

// the five brief subjects plan to visibly different scene mixes (keyword Director, no model)
const plan = async (prompt: string, headline: string) => buildCreativePlan(prompt, cfg({ prompt, headline }), { seconds: 30, beat: 0.5, mixed: false, llm: null });
const plans = await Promise.all(Object.values(subjects).map((p) => plan(p, 'BRAND')));
const sigs = plans.map((p) => p.scenes.map((x) => x.kind).join(','));
assert.equal(new Set(sigs).size, plans.length, 'every subject gets its own scene sequence: ' + sigs.join(' | '));
assert.equal(new Set(plans.map((p) => p.look.accent)).size >= 4, true, 'palettes differ per subject');
assert(plans[0].scenes.some((x) => x.three?.objects.some((o) => o.shape === 'bottle')), 'perfume plan has a real 3D bottle');
assert(plans[3].scenes.some((x) => x.kind === 'journey3d' || x.kind === 'scenery25'), 'motivation plan has a journey');
assert(plans[4].scenes.every((x) => !x.three), 'restaurant without photos does not get invented 3D');
// uploaded photos always survive planning (also when a model plan replaces the middle scenes) and become 2.5D cards
const withPhotos = await buildCreativePlan('Restaurant ad for a bistro', cfg({ prompt: 'Restaurant ad for a bistro', headline: 'Bistro' }), { seconds: 30, beat: 0.5, mixed: false,
  creativeAssets: [{ id: 'ca_aaaaaaaaaaaa', kind: 'photo', name: 'dish' }, { id: 'ca_bbbbbbbbbbbb', kind: 'photo', name: 'room' }],
  llm: { id: 'fake', run: async () => JSON.stringify({ concept: 'Warm dining', audience: 'diners', objective: 'book a table', direction: 'organic_calm', mood: ['warm'], ending: 'title_card', headline: 'Bistro', subtitle: '', cta: '', scenes: [{ kind: 'text', title: 'Come hungry', subtitle: '', bullets: [], steps: [], composition: 'default' }, { kind: 'abstract', title: '', subtitle: '', bullets: [], steps: [], composition: 'default' }] }) } });
assert.equal(withPhotos.scenes.filter((x) => x.kind === 'photo25d').length, 2, 'both uploaded photos are in the plan as 2.5D photo scenes: ' + withPhotos.scenes.map((x) => x.kind).join(','));
assert.equal(withPhotos.scenes[1].kind, 'photo25d', 'photos lead right after the intro: ' + withPhotos.scenes.map((x) => x.kind).join(','));
assert.deepEqual(withPhotos.scenes.filter((x) => x.kind === 'photo25d').map((x) => x.creativeAssetId).sort(), ['ca_aaaaaaaaaaaa', 'ca_bbbbbbbbbbbb']);
const v = applyVisuals([s({ kind: 'intro', title: 'T' }), s({ kind: 'abstract' })], 'perfume', cfg(), { hasPhotos: false, mixed: false });
assert(v.decided.some((d) => /visual domain/.test(d)));
const v2 = applyVisuals([s({ kind: 'intro', title: 'T' }), s({ kind: 'abstract' }), s({ kind: 'abstract' }), s({ kind: 'abstract' })], 'gym workout', cfg(), { hasPhotos: false, mixed: false });
assert(v2.scenes.every((x) => x.kind !== 'abstract'), 'text-free scenes are all given a real treatment (fillers cycle)');
const [a1, a2] = [v2.scenes[1].three!.objects[0], v2.scenes[3].three!.objects[0]]; assert.notDeepEqual(a1.spin, a2.spin, 'a repeated recipe is varied');

// user-supplied model: a hand-written GLB cube is validated, then rendered by the real scene renderer
function glbCube(): Buffer {
  const pos = new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]); const pad = (4 - (bin.length % 4)) % 4; const binP = Buffer.concat([bin, Buffer.alloc(pad)]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.2, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }], buffers: [{ byteLength: binP.length }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binP.length, 8);
  const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(binP.length, 0x004e4942), binP]);
}
const glb = path.join(tmp, 'cube.glb'); fs.writeFileSync(glb, glbCube());
const info = JSON.parse(execFileSync(PY, [path.join(SRC, 'glb_info.py')], { input: JSON.stringify({ file: glb, out: path.join(tmp, 'prev.png') }) }).toString());
assert.equal(info.faces, 12); assert(fs.statSync(path.join(tmp, 'prev.png')).size > 2000, 'preview image written');
fs.writeFileSync(path.join(tmp, 'bad.glb'), Buffer.from('glTF\x02\x00\x00\x00nonsense'));
assert.throws(() => execFileSync(PY, [path.join(SRC, 'glb_info.py')], { input: JSON.stringify({ file: path.join(tmp, 'bad.glb') }), stdio: 'pipe' }), /./, 'a corrupt model is rejected, not rendered');

const out = path.join(tmp, 'model.mp4');
const job = { out, w: 270, h: 480, fps: 12, seconds: 1, seed: 1, bg: { type: 'gradient', colors: ['#05060f', '#10153a', '#3b2a8c'], accent: '#7c5cff' }, text: { color: '#ffffff', font: 'modern' }, fx: {}, motif: 'none',
  scene: { kind: 'product3d', three: { objects: [{ shape: 'glb', file: glb }], floor: -0.9 } } };
execFileSync(PY, [path.join(SRC, 'scene_render.py')], { input: JSON.stringify(job) });
const meta = JSON.parse(fs.readFileSync(out + '.meta.json', 'utf8')); assert.equal(meta.engine3d.faces >= 12, true, 'the model was drawn by the 3D engine'); assert.equal(meta.depth25, false);
const city = path.join(tmp, 'city.mp4');
execFileSync(PY, [path.join(SRC, 'scene_render.py')], { input: JSON.stringify({ ...job, out: city, scene: { kind: 'scenery25', scenery: 'city' } }) });
const m2 = JSON.parse(fs.readFileSync(city + '.meta.json', 'utf8')); assert.equal(m2.engine3d, null, '2.5D scenery is not reported as 3D'); assert.equal(m2.depth25, true);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('auto 3d + visual intelligence tests passed');
