// Gender: optional on a person, and a contest can be limited to some genders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-gd-'));
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

test('a contest limited by gender only counts, emails and admits those people', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);
  const mk = async (x, gender) => (await call('POST', '/api/admin/users', { name: `Person ${x}`, email: `${x}@test.com`, team: 'T', region: 'IN', ...(gender ? { gender } : {}) })).data.id;
  const f = await mk('f', 'female'); const m = await mk('m', 'male'); await mk('n', null);
  const mkContest = async (name, genders) => (await call('POST', '/api/admin/contests', { name, theme: 'T', description: 'D', entryTypes: ['writing'], regions: ['IN'], genders, announced: true, timezone: 'Asia/Kolkata', endLocal: null })).data.id;
  const everyone = await mkContest('All', []); const women = await mkContest('Women', ['female']); const both = await mkContest('Women and men', ['female', 'male']);

  const recips = async (id) => (await call('GET', `/api/admin/contests/${id}`)).data.readiness.recipients;
  const base0 = await recips(everyone);
  assert.equal(await recips(women), 1);              // only the female employee
  assert.equal(await recips(both), 2);               // multi-select: female + male, not the one with no gender
  assert.ok(base0 >= 4);                              // no restriction: everyone in the region
  assert.deepEqual((await call('GET', `/api/admin/contests/${women}`)).data.contest.genders, ['female']);

  // bulk set gender
  const r = await call('POST', '/api/admin/users/bulk-gender', { ids: [m], gender: 'female' });
  assert.equal(r.data.updated, 1);
  assert.equal(await recips(women), 2);
  assert.equal((await call('POST', '/api/admin/users/bulk-gender', { ids: [m], gender: 'robot' })).status, 400);

  // portal: the signed-in admin (no gender) cannot vote in a gender-limited live contest, but can see it
  const live = await call('GET', '/api/portal/contests/' + women);
  assert.equal(live.data.contest.canVote, false);
  assert.equal(live.data.contest.genderLabel, undefined);   // employees never see which gender a contest is limited to
  assert.equal(live.data.contest.genders, undefined);
  assert.equal(live.data.contest.viewOnlyNote, 'Not open to you');
  assert.equal((await call('GET', '/api/auth/me')).data.user.gender, undefined); // and never their own gender
  assert.equal((await call('GET', `/api/admin/contests/${women}`)).data.contest.genderLabel, 'Female');
  await call('POST', '/api/admin/users/bulk-gender', { ids: [(await call('GET', '/api/auth/me')).data.user.id], gender: 'female' });
  assert.equal((await call('GET', '/api/portal/contests/' + women)).data.contest.canVote, true);
  assert.equal((await call('GET', '/api/portal/contests/' + everyone)).data.contest.canVote, true);
  assert.ok(f);
});
