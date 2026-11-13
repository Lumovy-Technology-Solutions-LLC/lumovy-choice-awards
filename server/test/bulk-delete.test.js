// Bulk delete of people and regions: what is removed, and what is protected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-bd-'));
const dbFile = path.join(tmp, 'test.db');
const PORT = 4700 + Math.floor(Math.random() * 300);
const base = `http://localhost:${PORT}`;
let proc; let raw; let cookie = '';

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await res.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: res.status, data };
};

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), SQLITE_FILE: dbFile, SQLITE_JOURNAL: 'delete', UPLOAD_DIR: path.join(tmp, 'up'), MAIL_TRANSPORT: 'dev', NODE_ENV: 'development', BOOTSTRAP_ADMIN_EMAIL: 'hr@test.com', BOOTSTRAP_ADMIN_PASSWORD: 'TestPass!12345' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  raw = knex({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
});
after(async () => {
  await raw?.destroy();
  if (proc) await new Promise((resolve) => { proc.once('exit', resolve); proc.kill(); setTimeout(resolve, 3000); });
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder is cleaned by the OS */ }
});

test('bulk delete keeps voters, yourself and regions that are in use', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);
  const me = (await call('GET', '/api/auth/me')).data.user.id;
  const ids = {};
  for (const x of ['a', 'b', 'c']) {
    const r = await call('POST', '/api/admin/users', { name: `Person ${x}`, email: `${x}@test.com`, team: 'T', region: 'IN' });
    assert.equal(r.status, 201); ids[x] = r.data.id;
  }
  // c has voted in some contest, so must be kept
  const created = await call('POST', '/api/admin/contests', { name: 'C1', theme: 'T', description: 'D', entryTypes: ['writing'], regions: ['IN'], places: 3, timezone: 'Asia/Kolkata', endLocal: null });
  await raw('voter_status').insert({ contest_id: created.data.id, user_id: ids.c, submitted_at: new Date().toISOString() });

  const r = await call('POST', '/api/admin/users/bulk-delete', { ids: [ids.a, ids.b, ids.c, me, 999999] });
  assert.equal(r.status, 200);
  assert.equal(r.data.deleted, 2);
  assert.equal(r.data.skipped.length, 3);
  assert.match(r.data.skipped.find((s) => s.id === ids.c).reason, /voted/);
  assert.match(r.data.skipped.find((s) => s.id === me).reason, /yourself/);
  assert.equal(await raw('users').whereIn('id', [ids.a, ids.b]).count({ n: '*' }).first().then((x) => Number(x.n)), 0);
  assert.ok(await raw('users').where({ id: ids.c }).first());

  assert.equal((await call('POST', '/api/admin/users/bulk-delete', { ids: [] })).status, 400);
});

test('bulk delete of regions keeps those with people or contests', async () => {
  for (const [code, name] of [['SG', 'Singapore'], ['DE', 'Germany'], ['FR', 'France']])
    assert.equal((await call('POST', '/api/admin/regions', { code, name })).status, 201);
  await call('POST', '/api/admin/users', { name: 'Uk Person', email: 'uk@test.com', team: 'T', region: 'US' });
  await call('PUT', '/api/admin/regions/DE', { enabled: true });
  assert.equal((await call('POST', '/api/admin/contests', { name: 'DE contest', theme: 'T', description: 'D', entryTypes: ['writing'], regions: ['DE'], places: 3, timezone: 'Asia/Kolkata', endLocal: null })).status, 201);

  const r = await call('POST', '/api/admin/regions/bulk-delete', { codes: ['SG', 'FR', 'US', 'DE', 'ZZ'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.deleted, 2);
  assert.deepEqual(r.data.skipped.map((s) => s.id).sort(), ['DE', 'US', 'ZZ']);
  const left = (await call('GET', '/api/admin/regions')).data.regions.map((g) => g.code);
  assert.ok(!left.includes('SG') && !left.includes('FR') && left.includes('US') && left.includes('DE'));
});
