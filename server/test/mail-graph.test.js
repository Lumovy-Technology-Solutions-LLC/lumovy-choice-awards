// Microsoft Graph sending: request shape, and how throttling, permission and bad-address answers are handled.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-graph-'));
Object.assign(process.env, { SQLITE_FILE: path.join(tmp, 't.db'), SQLITE_JOURNAL: 'delete', DATA_DIR: tmp, UPLOAD_DIR: path.join(tmp, 'up'), MAIL_TRANSPORT: 'graph', MAIL_MAX_PER_MINUTE: '0', MAIL_FROM: 'Lumovy Employee Choice Awards <choice-awards@lumovy.com>', GRAPH_TENANT_ID: 'tenant-1', GRAPH_CLIENT_ID: 'client-1', GRAPH_CLIENT_SECRET: 'secret-1', NODE_ENV: 'development' });
const { db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const mail = await import('../src/lib/mail.js');
await migrate();
const realFetch = globalThis.fetch;
after(async () => { globalThis.fetch = realFetch; await db.destroy(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } });

const calls = []; let answer = { status: 202 };
globalThis.fetch = async (url, init) => {
  if (String(url).includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
  calls.push({ url: String(url), init });
  return new Response(answer.body ? JSON.stringify(answer.body) : null, { status: answer.status, headers: answer.headers || {} });
};
const add = (to) => db('outbox').insert({ kind: 'reminder', to_email: to, to_name: 'Asha Rao', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', status: 'queued', attempts: 0, created_at: new Date().toISOString() });
const row = (to) => db('outbox').where({ to_email: to }).first();

test('sends as the mailbox with the right request', async () => {
  await add('a@t.com');
  while ((await mail.processOutbox()) > 0);
  assert.equal((await row('a@t.com')).status, 'sent');
  const c = calls.at(-1);
  assert.match(c.url, /\/users\/choice-awards%40lumovy\.com\/sendMail$/);
  assert.equal(c.init.headers.authorization, 'Bearer tok');
  const b = JSON.parse(c.init.body);
  assert.equal(b.message.toRecipients[0].emailAddress.address, 'a@t.com');
  assert.equal(b.message.subject, 'Hello');
  assert.deepEqual(b.message.from, { emailAddress: { name: 'Lumovy Employee Choice Awards', address: 'choice-awards@lumovy.com' } });
  assert.equal(b.saveToSentItems, false);
});

test('throttling (429) keeps the email queued and pauses', async () => {
  mail.resetPauseForTests();
  await add('b@t.com');
  answer = { status: 429, headers: { 'retry-after': '30' }, body: { error: { code: 'ApplicationThrottled', message: 'Too many requests' } } };
  await mail.processOutbox();
  const r = await row('b@t.com');
  assert.equal(r.status, 'queued'); assert.equal(r.attempts, 0);
  answer = { status: 202 };
  assert.equal(await mail.processOutbox(), 0, 'paused');
});

test('missing permission (403) keeps the email queued with a clear reason', async () => {
  mail.resetPauseForTests();
  await db('outbox').del();
  await add('c@t.com');
  answer = { status: 403, body: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } } };
  await mail.processOutbox();
  const r = await row('c@t.com');
  assert.equal(r.status, 'queued');
  assert.match(r.error, /not allowed to send as choice-awards@lumovy\.com/);
});

test('a bad address (400) fails only that email', async () => {
  mail.resetPauseForTests();
  await db('outbox').del();
  await add('bad@t.com');
  answer = { status: 400, body: { error: { code: 'ErrorInvalidRecipients', message: 'Invalid recipient' } } };
  await mail.processOutbox();
  assert.equal((await row('bad@t.com')).status, 'failed');
});
