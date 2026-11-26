// Several photos in one entry, and the per-person entry limit set by HR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import knex from 'knex';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-ph-'));
const dbFile = path.join(tmp, 'test.db');
const PORT = 5100 + Math.floor(Math.random() * 300);
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

const png = (c) => sharp({ create: { width: 64, height: 48, channels: 3, background: c } }).png().toBuffer();
async function addEntry(contestId, fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const [k, buf] of files) fd.append(k, new Blob([buf], { type: 'image/png' }), `${k}.png`);
  const res = await fetch(`${base}/api/admin/contests/${contestId}/entries`, { method: 'POST', headers: { cookie }, body: fd });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('an entry holds several photos, and HR can cap entries per person', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);
  const u = (await call('POST', '/api/admin/users', { name: 'Photo Person', email: 'pp@test.com', team: 'T', region: 'IN' })).data.id;
  const v = (await call('POST', '/api/admin/users', { name: 'Other Person', email: 'op@test.com', team: 'T', region: 'IN' })).data.id;
  const created = await call('POST', '/api/admin/contests', { name: 'Photos', theme: 'T', description: 'D', entryTypes: ['image'], regions: ['IN'], maxEntriesPerPerson: 2, timezone: 'Asia/Kolkata', endLocal: null });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal((await call('GET', `/api/admin/contests/${id}`)).data.contest.maxEntriesPerPerson, 2);

  const base1 = { title: 'T', description: 'D', competitorUserId: u };
  const a = await addEntry(id, base1, [['file', await png('#f00')], ['extra', await png('#0f0')], ['extra', await png('#00f')]]);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  let list = (await call('GET', `/api/admin/contests/${id}/entries`)).data;
  assert.equal(list.maxPerPerson, 2);
  assert.equal(list.entries[0].images.length, 2, 'two extra angles');
  assert.equal(list.entries[0].competitorName, 'Photo Person');
  // the extra photo can be fetched
  assert.equal((await fetch(base + list.entries[0].images[0].url, { headers: { cookie } })).status, 200);

  assert.equal((await addEntry(id, base1, [['file', await png('#ff0')]])).status, 201, 'second entry is within the limit');
  const third = await addEntry(id, base1, [['file', await png('#0ff')]]);
  assert.equal(third.status, 409, 'third entry is over the limit');
  assert.equal(third.data.code, 'entry_limit');
  assert.equal((await addEntry(id, { ...base1, competitorUserId: v }, [['file', await png('#0ff')]])).status, 201, 'someone else is unaffected');

  // remove an angle, add another
  const first = list.entries[0];
  const fd = new FormData();
  fd.append('title', 'T'); fd.append('description', 'D'); fd.append('competitorUserId', String(u)); fd.append('removeImages', JSON.stringify([first.images[0].id]));
  fd.append('extra', new Blob([await png('#888')], { type: 'image/png' }), 'x.png');
  assert.equal((await fetch(`${base}/api/admin/entries/${first.id}`, { method: 'PUT', headers: { cookie }, body: fd })).status, 200);
  list = (await call('GET', `/api/admin/contests/${id}/entries`)).data;
  assert.equal(list.entries[0].images.length, 2);
  assert.ok(!list.entries[0].images.some((i) => i.id === first.images[0].id));
  // limit can be lifted
  const put = await call('PUT', `/api/admin/contests/${id}`, { name: 'Photos', theme: 'T', description: 'D', rules: '', entryTypes: ['image'], regions: ['IN'], timezone: 'Asia/Kolkata', announced: false, endLocal: null, maxEntriesPerPerson: null });
  assert.equal(put.status, 200);
  assert.equal((await addEntry(id, base1, [['file', await png('#123')]])).status, 201, 'no limit now');
});
