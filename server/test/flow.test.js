// End-to-end rules check: boots the real server on a throwaway database and drives it over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-test-'));
const dbFile = path.join(tmp, 'test.db');
const PORT = 4100 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}`;
let proc; let raw;

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const t = await res.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: res.status, data };
  }
  get = (u) => this.call('GET', u); post = (u, b) => this.call('POST', u, b ?? {}); put = (u, b) => this.call('PUT', u, b ?? {});
}

async function otpLogin(c, email) {
  await c.post('/api/auth/otp/request', { email });
  const mb = await c.get(`/api/dev/mailbox?email=${encodeURIComponent(email)}`);
  const code = mb.data.items.find((i) => i.kind === 'otp').text.match(/\d{6}/)[0];
  const r = await c.post('/api/auth/otp/verify', { email, code });
  assert.equal(r.status, 200, 'otp login');
}

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), SQLITE_FILE: dbFile, SQLITE_JOURNAL: 'delete', UPLOAD_DIR: path.join(tmp, 'up'), MAIL_TRANSPORT: 'dev', NODE_ENV: 'development', BOOTSTRAP_ADMIN_EMAIL: 'hr@test.com', BOOTSTRAP_ADMIN_PASSWORD: 'TestPass!12345' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  raw = knex({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
});
after(async () => {
  await raw?.destroy();
  if (proc) await new Promise((resolve) => { proc.once('exit', resolve); proc.kill(); setTimeout(resolve, 3000); });
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows can keep the file a moment; the OS cleans the temp folder */ }
});

test('full contest lifecycle enforces the fairness rules', async () => {
  const admin = new Client();
  assert.equal((await admin.post('/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);

  // people: 5 in India, 1 in US (not eligible), 1 switched off
  const people = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ name: `Person ${x}`, email: `${x}@test.com`, team: 'T', region: 'IN' }));
  for (const p of [...people, { name: 'Us Person', email: 'us@test.com', team: 'T', region: 'US' }, { name: 'Gone Person', email: 'gone@test.com', team: 'T', region: 'IN', active: false }])
    assert.equal((await admin.post('/api/admin/users', p)).status, 201);

  // contest with 4 pasted-writing entries
  const created = await admin.post('/api/admin/contests', { name: 'Writing Test', theme: 'T', description: 'D', entryTypes: ['writing'], regions: ['IN'], places: 3, timezone: 'Asia/Kolkata', endLocal: null });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const eps = [];
  for (let i = 1; i <= 4; i++) {
    const fd = new FormData();
    fd.append('title', `Story ${i}`); fd.append('description', `About ${i}`); fd.append('competitorName', `Author ${i}`); fd.append('body', `Text ${i}`);
    const res = await fetch(`${base}/api/admin/contests/${id}/entries`, { method: 'POST', headers: { cookie: admin.cookie }, body: fd });
    assert.equal(res.status, 201);
    eps.push((await res.json()).id);
  }

  // cannot start without a deadline
  assert.equal((await admin.post(`/api/admin/contests/${id}/start`)).status, 400);
  const soon = new Date(Date.now() + 3 * 3600_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
  assert.equal((await admin.put(`/api/admin/contests/${id}`, { name: 'Writing Test', theme: 'T', description: 'D', rules: '', entryTypes: ['writing'], regions: ['IN'], places: 3, timezone: 'Asia/Kolkata', announced: false, endLocal: soon })).status, 200);

  // employees see nothing until it starts
  const emp = new Client(); await otpLogin(emp, 'a@test.com');
  assert.equal((await emp.get(`/api/portal/contests/${id}`)).status, 404, 'unannounced draft hidden');

  const start = await admin.post(`/api/admin/contests/${id}/start`);
  assert.equal(start.status, 200);
  assert.equal(start.data.emailsQueued, 6, 'India active employees + admin only (not US, not switched off)');
  // entries locked once live
  assert.equal((await admin.call('DELETE', `/api/admin/entries/${eps[0]}`)).status, 409);

  // anonymity: no competitor names in anything an employee can fetch
  const list = await emp.get(`/api/portal/contests/${id}/entries`);
  assert.equal(list.status, 200);
  assert.equal(list.data.entries.length, 4);
  assert.ok(!JSON.stringify(list.data).includes('Author'), 'competitor names never reach voters');
  assert.ok(!JSON.stringify(await emp.get(`/api/portal/contests/${id}`)).includes('Author'));
  assert.equal((await emp.get(`/api/portal/contests/${id}/results`)).status, 403, 'results hidden before publish');

  // US employee cannot see this contest
  const us = new Client(); await otpLogin(us, 'us@test.com');
  // ...but everyone can SEE it; only participating regions can vote
  const seen = await us.get(`/api/portal/contests/${id}`);
  assert.equal(seen.status, 200); assert.equal(seen.data.contest.canVote, false);
  assert.equal((await us.get(`/api/portal/contests/${id}/entries`)).data.code, 'not_eligible');
  assert.equal((await us.post(`/api/portal/contests/${id}/vote`, { picks: [{ entryId: eps[0], rank: 1 }, { entryId: eps[1], rank: 2 }, { entryId: eps[2], rank: 3 }] })).status, 403);
  // switched-off employee cannot sign in
  const gone = new Client(); await gone.post('/api/auth/otp/request', { email: 'gone@test.com' });
  assert.equal((await gone.get('/api/dev/mailbox?email=gone@test.com')).data.items.length, 0);

  // draft save, then validation on submit
  assert.equal((await emp.put(`/api/portal/contests/${id}/ballot`, { picks: [{ entryId: eps[0], rank: 1 }] })).status, 200);
  assert.equal((await emp.get(`/api/portal/contests/${id}/ballot`)).data.picks.length, 1);
  assert.equal((await emp.post(`/api/portal/contests/${id}/vote`, { picks: [{ entryId: eps[0], rank: 1 }] })).status, 400, 'needs 3 picks');
  assert.equal((await emp.post(`/api/portal/contests/${id}/vote`, { picks: [{ entryId: eps[0], rank: 1 }, { entryId: eps[0], rank: 2 }, { entryId: eps[1], rank: 3 }] })).status, 400, 'three different entries');

  const vote = (c, a, b, d) => c.post(`/api/portal/contests/${id}/vote`, { picks: [{ entryId: eps[a], rank: 1 }, { entryId: eps[b], rank: 2 }, { entryId: eps[d], rank: 3 }] });
  assert.equal((await vote(emp, 0, 1, 2)).status, 200);
  assert.equal((await vote(emp, 0, 1, 2)).status, 409, 'one vote per person');
  assert.equal((await emp.put(`/api/portal/contests/${id}/ballot`, { picks: [] })).status, 409, 'cannot save after submitting');
  const mine = await emp.get(`/api/portal/contests/${id}/ballot`);
  assert.equal(mine.data.status, 'submitted'); assert.equal(mine.data.picks.length, 3);

  // parallel double-submit by another voter: exactly one wins
  const b = new Client(); await otpLogin(b, 'b@test.com');
  const both = await Promise.all([vote(b, 1, 0, 2), vote(b, 1, 0, 2), vote(b, 2, 0, 1)]);
  assert.equal(both.filter((r) => r.status === 200).length, 1, 'simultaneous submits count once');

  // more votes to build a tie: entries 0 and 1 end up level on points, 0 has more 1sts
  const c = new Client(); await otpLogin(c, 'c@test.com'); await vote(c, 0, 2, 1);
  const d = new Client(); await otpLogin(d, 'd@test.com'); await vote(d, 1, 3, 0);

  // votes carry no user reference; voter_status holds no entry info
  const cols = (await raw.raw("select name from pragma_table_info('votes')")).map((r) => r.name);
  assert.ok(!cols.includes('user_id'), 'votes table has no user id');
  assert.ok(!(await raw.raw("select name from pragma_table_info('voter_status')")).map((r) => r.name).includes('entry_id'));

  // admin sees who voted, never for whom
  const voters = await admin.get(`/api/admin/contests/${id}/voters`);
  assert.equal(voters.data.voters.length, 4);
  assert.ok(!JSON.stringify(voters.data).includes('entry'));
  const dash = await admin.get(`/api/admin/contests/${id}/dashboard`);
  assert.equal(dash.data.voted, 4); assert.equal(dash.data.eligible, 6);

  // hard close: end time passes -> votes rejected, drafts do not count
  const e = new Client(); await otpLogin(e, 'e@test.com');
  await e.put(`/api/portal/contests/${id}/ballot`, { picks: [{ entryId: eps[3], rank: 1 }] });
  await raw('contests').where({ id }).update({ end_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await vote(e, 3, 2, 1)).status, 409, 'rejected after the end time');
  assert.equal((await e.get(`/api/portal/contests/${id}/entries`)).status, 403);

  // results: scoring 3-2-1 and tie-breaks
  assert.equal((await admin.get(`/api/admin/contests/${id}`)).data.contest.status, 'closed');
  const res = await admin.get(`/api/admin/contests/${id}/results`);
  const rows = [...res.data.winners, ...res.data.others];
  const pts = Object.fromEntries(rows.map((r) => [r.title, r.points]));
  // a:0,1,2  b:1,0,2 (one of the parallel wins)  c:0,2,1  d:1,3,0  -> check totals using DB truth
  const dbPts = await raw('votes').where({ contest_id: id }).select('entry_id').sum({ p: 'points' }).groupBy('entry_id');
  for (const r of rows) assert.equal(r.points, Number(dbPts.find((x) => x.entry_id === r.id)?.p || 0));
  assert.ok(rows[0].points >= rows[1].points && rows[1].points >= rows[2].points, 'sorted by points');
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].points === rows[i].points) assert.ok(rows[i - 1].firsts >= rows[i].firsts, 'tie broken by 1st-place picks');

  // publish: employees can now see results, with names
  assert.equal((await admin.post(`/api/admin/contests/${id}/publish`)).status, 200);
  assert.equal((await admin.post(`/api/admin/contests/${id}/publish`)).status, 409, 'cannot publish twice');
  const pub = await emp.get(`/api/portal/contests/${id}/results`);
  assert.equal(pub.status, 200);
  assert.ok(JSON.stringify(pub.data).includes('Author'));

  // emails: confirmation sent to the voter, none leaked names before publish
  const sent = await raw('outbox').where({ contest_id: id });
  assert.ok(sent.filter((m) => m.kind === 'contest_started').every((m) => !m.html.includes('Author')), 'start email has no names');
  assert.equal(sent.filter((m) => m.kind === 'vote_confirmation').length, 4);
  assert.equal(sent.filter((m) => m.kind === 'results_declared').length, 6);

  // audit trail
  const audit = await admin.get(`/api/admin/audit?contest=${id}`);
  const actions = audit.data.items.map((a) => a.action);
  for (const a of ['Contest started', 'Voting closed automatically', 'Results published', 'Entry added']) assert.ok(actions.includes(a), a);
});

test('HR can switch email off: sign-in codes and notifications are separate switches', async () => {
  const admin = new Client();
  assert.equal((await admin.post('/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);
  const anon = new Client();
  for (const x of ['z1', 'z2']) assert.equal((await admin.post('/api/admin/users', { name: `Person ${x}`, email: `${x}@test.com`, team: 'T', region: 'IN' })).status, 201);
  const outboxCount = async () => Number((await raw('outbox').count({ n: '*' }).first()).n);

  const s0 = await admin.get('/api/admin/settings');
  assert.equal(s0.data.emailNotifications, true);
  assert.equal(s0.data.emailSignIn, true);

  // notifications off: test email refused, nothing queued
  assert.equal((await admin.put('/api/admin/settings', { emailNotifications: false })).data.emailNotifications, false);
  const before = await outboxCount();
  assert.equal((await admin.post('/api/admin/contests/1/emails/contest_started/test', {})).status, 409);
  assert.equal(await outboxCount(), before);
  // sign-in codes still work while notifications are off
  assert.equal((await anon.post('/api/auth/otp/request', { email: 'z1@test.com' })).status, 200);
  assert.equal(await outboxCount(), before + 1);
  assert.equal((await admin.put('/api/admin/settings', { emailNotifications: true })).data.emailNotifications, true);
  assert.equal((await admin.post('/api/admin/contests/1/emails/contest_started/test', {})).status, 200);

  // sign-in codes off: the request is refused and /me tells the login page to hide the option
  await admin.put('/api/admin/settings', { emailSignIn: false });
  assert.equal((await anon.post('/api/auth/otp/request', { email: 'z1@test.com' })).status, 403);
  assert.equal((await anon.get('/api/auth/me')).data.emailSignIn, false);
  assert.equal((await admin.post('/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200, 'password sign-in still works');
  await admin.put('/api/admin/settings', { emailSignIn: true });
  assert.equal((await anon.get('/api/auth/me')).data.emailSignIn, true);

  // only admins can change it
  const emp = new Client(); await otpLogin(emp, 'z2@test.com');
  assert.equal((await emp.put('/api/admin/settings', { emailNotifications: false })).status, 403);
});

test('SQLite: runs without WAL (Azure mode) and a backup holds all the data', async () => {
  const admin = new Client();
  assert.equal((await admin.post('/api/auth/login', { email: 'hr@test.com', password: 'TestPass!12345' })).status, 200);
  assert.equal((await raw.raw('pragma journal_mode')).at(0).journal_mode, 'delete');

  const r = await admin.post('/api/admin/backup');
  assert.equal(r.status, 200);
  assert.ok(r.data.backups.count >= 1);
  const dir = path.join(path.dirname(dbFile), 'backups');
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().at(-1);
  const copy = knex({ client: 'better-sqlite3', connection: { filename: path.join(dir, file), flags: ['readonly'] }, useNullAsDefault: true });
  try {
    for (const t of ['users', 'contests', 'entries', 'votes', 'voter_status', 'outbox']) {
      const live = Number((await raw(t).count({ n: '*' }).first()).n);
      const bak = Number((await copy(t).count({ n: '*' }).first()).n);
      assert.equal(bak, live, `${t}: backup has the same rows`);
    }
    assert.ok(Number((await copy('votes').count({ n: '*' }).first()).n) > 0, 'votes are in the backup');
  } finally { await copy.destroy(); }
});
