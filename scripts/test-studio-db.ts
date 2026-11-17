import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studiodb-')); process.env.STUDIO_DATA_DIR = dir;
// legacy JSON files from the earlier store, to prove the migration
fs.mkdirSync(path.join(dir, 'library'));
const legacyIdentity = { id: 'idn_old1', name: 'Legacy', createdAt: 1, updatedAt: 1 };
fs.writeFileSync(path.join(dir, 'identities.json'), JSON.stringify({ identities: [legacyIdentity] }));
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ preferredPlanner: 'qwen2.5-0.5b-instruct-q4km' }));
fs.writeFileSync(path.join(dir, 'library', 'aaaaaaaaaaaaaaaa.json'), JSON.stringify({ id: 'aaaaaaaaaaaaaaaa', kind: 'music', label: 'old', seed: 1, seconds: 5, createdAt: 5, renderMs: 1, license: {} }));
fs.writeFileSync(path.join(dir, 'library', 'aaaaaaaaaaaaaaaa.wav'), 'RIFF');

const { listIdentities, getIdentity, createIdentity, updateIdentity, deleteIdentity } = await import('../src/lib/studio/identity-store.ts');
const { getPreferredPlannerId, setPreferredPlannerId } = await import('../src/lib/studio/settings.ts');
const { listItems, saveItem, deleteItem, wavPath } = await import('../src/lib/studio/library.ts');
const { IDENTITY_TEMPLATES } = await import('../src/lib/studio/identity.ts');
const { closeStudioDb } = await import('../src/lib/studio/studio-db.ts');
const { stereo } = await import('../src/lib/studio/dsp.ts');

// migration
assert.deepEqual(listIdentities().map((i) => i.id), ['idn_old1'], 'legacy identity imported');
assert.equal(getPreferredPlannerId(), 'qwen2.5-0.5b-instruct-q4km', 'legacy setting imported');
assert.deepEqual(listItems().map((i) => i.id), ['aaaaaaaaaaaaaaaa'], 'legacy library entry imported');
assert(fs.existsSync(path.join(dir, 'identities.json.migrated')) && !fs.existsSync(path.join(dir, 'identities.json')), 'originals kept as .migrated');
assert(fs.existsSync(path.join(dir, 'library', 'aaaaaaaaaaaaaaaa.wav')), 'audio files untouched');

// identities CRUD + validation
const c = createIdentity(IDENTITY_TEMPLATES.africa_unfiltered); assert(c.ok);
const id = c.ok ? c.identity.id : '';
assert.equal(getIdentity(id)?.name, 'Africa Unfiltered'); assert.equal(listIdentities().length, 2);
const u = updateIdentity(id, { ...IDENTITY_TEMPLATES.africa_unfiltered, name: 'Renamed' }); assert(u.ok && u.identity.name === 'Renamed' && u.identity.createdAt === (c.ok ? c.identity.createdAt : 0));
assert(!updateIdentity(id, { name: '' }).ok, 'invalid update rejected and data unchanged'); assert.equal(getIdentity(id)?.name, 'Renamed');
const nf = updateIdentity('idn_nope', IDENTITY_TEMPLATES.africa_unfiltered); assert(!nf.ok && nf.notFound);
assert(!createIdentity({ nope: 1 }).ok);
assert(deleteIdentity(id) && !deleteIdentity(id) && listIdentities().length === 1);
// injection-shaped input is just data
const evil = createIdentity({ ...IDENTITY_TEMPLATES.clean_editorial, name: "x'); DROP TABLE identities;--" }); assert(evil.ok); assert(listIdentities().length === 2);

// settings
setPreferredPlannerId('qwen2.5-1.5b-instruct-q4km'); assert.equal(getPreferredPlannerId(), 'qwen2.5-1.5b-instruct-q4km');

// library
const s = stereo(0.05); const it = saveItem(s, { kind: 'music', label: 'x', mood: 'cinematic', seed: 3, seconds: 1, renderMs: 5 });
assert.equal(listItems()[0].id, it.id); assert(wavPath(it.id)); assert.equal(saveItem(s, { kind: 'music', label: 'x', mood: 'cinematic', seed: 3, seconds: 1, renderMs: 9 }).id, it.id, 'same sound -> same id (upsert)');
assert.equal(listItems().length, 2); assert(deleteItem(it.id) && !deleteItem(it.id) && !wavPath(it.id)); assert(!deleteItem('../etc'));

// persistence across reopen
closeStudioDb(); assert.equal(listIdentities().length, 2); assert.equal(getPreferredPlannerId(), 'qwen2.5-1.5b-instruct-q4km');
closeStudioDb(); fs.rmSync(dir, { recursive: true, force: true });
console.log('studio db tests passed');
