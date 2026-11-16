// Sending pace: a per-minute cap, "too fast" answers that pause and retry without losing mail, and sign-in codes first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-pace-'));
Object.assign(process.env, { SQLITE_FILE: path.join(tmp, 't.db'), SQLITE_JOURNAL: 'delete', DATA_DIR: tmp, UPLOAD_DIR: path.join(tmp, 'up'), MAIL_TRANSPORT: 'smtp', MAIL_MAX_PER_MINUTE: '3', MAIL_MAX_PER_HOUR: '0', NODE_ENV: 'development' });
const { db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const mail = await import('../src/lib/mail.js');
await migrate();
after(async () => { await db.destroy(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } });

const sent = [];
let mode = 'ok';
mail.setTransporterForTests({ sendMail: async (m) => {
  if (mode === 'rate') throw Object.assign(new Error('450 4.5.127 Message rejected. Excessive message rate from sender.'), { responseCode: 450 });
  if (mode === 'bad' && /bad@/.test(m.to)) throw Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 });
  sent.push(m.to);
} });
const add = (n, kind = 'reminder') => db.batchInsert('outbox', Array.from({ length: n }, (_, i) => ({ kind, to_email: `${kind}${i}@t.com`, to_name: '', subject: 's', html: '<p>x</p>', text: 'x', status: 'queued', attempts: 0, created_at: new Date().toISOString() })), 50);
const count = async (status) => Number((await db('outbox').where({ status }).count({ n: '*' }).first()).n);

test('bulk mail goes out within the per-minute cap and the rest waits', async () => {
  await add(8);
  while ((await mail.processOutbox()) > 0);
  assert.equal(sent.length, 3);
  assert.equal(await count('sent'), 3);
  assert.equal(await count('queued'), 5);
  // asking again straight away sends nothing more: the minute has not reset
  assert.equal(await mail.processOutbox(), 0);
  assert.equal(sent.length, 3);
  // after the window passes, the next batch goes
  await db('outbox').where({ status: 'sent' }).update({ sent_at: new Date(Date.now() - 61_000).toISOString() });
  while ((await mail.processOutbox()) > 0);
  assert.equal(sent.length, 6);
});

test('sign-in codes are sent first and are not held by the cap', async () => {
  await add(2, 'otp');
  const before = sent.length;
  await mail.processOutbox();
  assert.deepEqual(sent.slice(before), ['otp0@t.com', 'otp1@t.com']);
});

test('a "too fast" answer keeps every email queued, uncounted as failed, and pauses sending', async () => {
  await db('outbox').del(); sent.length = 0; mail.resetPauseForTests();
  await add(4);
  mode = 'rate';
  await mail.processOutbox();
  assert.equal(await count('queued'), 4);
  assert.equal(await count('failed'), 0);
  assert.equal((await db('outbox').where({ status: 'queued' }).max({ a: 'attempts' }).first()).a, 0);
  // still paused: even though the provider is fine again, bulk mail waits
  mode = 'ok';
  assert.equal(await mail.processOutbox(), 0);
  assert.equal(sent.length, 0);
  mail.resetPauseForTests(); // the pause is over
  await db('outbox').update({ sent_at: null });
  while ((await mail.processOutbox()) > 0);
  assert.equal(sent.length, 3);
});

test('a permanent refusal fails that one email and the others still go', async () => {
  await db('outbox').del(); sent.length = 0; mail.resetPauseForTests();
  await db.batchInsert('outbox', ['bad@t.com', 'ok@t.com'].map((to) => ({ kind: 'reminder', to_email: to, to_name: '', subject: 's', html: 'x', text: 'x', status: 'queued', attempts: 0, created_at: new Date().toISOString() })));
  mode = 'bad';
  while ((await mail.processOutbox()) > 0);
  assert.equal(await count('failed'), 1);
  assert.deepEqual(sent, ['ok@t.com']);
});
