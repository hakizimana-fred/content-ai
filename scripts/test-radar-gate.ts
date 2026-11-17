// Runs in a throw-away working directory so it can NEVER touch the real storage/ (paths.ts resolves from cwd).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-gate-')));
const { addCreator, grantPermission, revokePermission, getCreator } = await import(path.join(here, '../src/lib/radar/store.ts'));
const { authorize, streamForRecording, PermissionError } = await import(path.join(here, '../src/lib/radar/gate.ts'));
const { createHttpJsonProvider } = await import(path.join(here, '../src/lib/radar/providers/http-json.ts'));

const a = addCreator({ username: 'gate_test' }); assert(a.ok); const id = a.creator.id;
const rec = { grantedBy: 'Test creator', evidence: 'test fixture', scope: { recording: true, editing: false, redistribution: false, monetization: false }, platforms: ['tiktok', 'youtube'] };
const prov = createHttpJsonProvider({ url: 'https://x.test/{username}', livePath: 'l', streamPath: 's', dataSource: 'third-party-service' },
  (async () => new Response(JSON.stringify({ l: true, s: 'https://s/a.m3u8' }))) as unknown as typeof fetch);

assert.throws(() => authorize(id, 'recording'), PermissionError);                       // no permission yet
await assert.rejects(streamForRecording(prov, id), PermissionError);                    // and no stream access either
assert(grantPermission(id, rec).ok);
assert.equal(authorize(id, 'recording').username, 'gate_test');
assert.equal((await streamForRecording(prov, id))?.kind, 'hls');
assert.throws(() => authorize(id, 'redistribution', { platform: 'youtube' }), PermissionError); // not in scope
revokePermission(id, 'creator asked');
assert.throws(() => authorize(id, 'recording'), PermissionError);                       // revocation takes effect on the very next call
await assert.rejects(streamForRecording(prov, id), PermissionError);
const log = getCreator(id)!.audit.map((x: { action: string }) => x.action);
for (const expected of ['recording blocked', 'recording allowed', 'Permission revoked']) assert(log.includes(expected), expected);
console.log('radar gate tests passed');
