import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { db, nowIso, parseJson } from '../db/index.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { getContest, closeContest, hydrate, contestShape, entryShape, isComplete, regionRecipients, resultsPayload } from '../lib/contests.js';
import { processUpload, saveBanner, removeFiles, ENTRY_TYPES, typeForExt } from '../lib/files.js';
import { getFlags } from '../lib/settings.js';
import { backupNow } from '../lib/backup.js';
import { queueTemplated, getTemplate, renderEmail, queue, TEMPLATE_META, TEMPLATE_KEYS, voteButton, resultsButton, listBlock } from '../lib/mail.js';
import { tally } from '../lib/scoring.js';
import { wrap, bad, notFound, conflict, localToUtcIso, formatDeadline, entryLabel } from '../lib/util.js';

const r = Router();

const tmpDir = path.join(config.dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 100 } });
const cleanup = (...files) => files.flat().filter(Boolean).forEach((f) => fs.rm(f.path || f, { force: true }, () => {}));

const TZ = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];

const contestBody = z.object({
  name: z.string().trim().min(2, 'Give the contest a name.').max(120),
  theme: z.string().trim().max(200).default(''),
  description: z.string().trim().max(2000).default(''),
  rules: z.string().trim().max(4000).default(''),
  entryTypes: z.array(z.enum(ENTRY_TYPES)).min(1, 'Choose at least one entry type.'),
  scope: z.enum(['regional', 'selected', 'global']).default('regional'),
  regions: z.array(z.string()).default([]),
  places: z.number().int().min(1).max(5).default(3),
  timezone: z.enum(TZ).default('Asia/Kolkata'),
  announced: z.boolean().default(false),
  endLocal: z.string().optional().nullable(),
});

// ----- list / create -----
r.get('/contests', wrap(async (_req, res) => {
  const rows = (await db('contests').orderBy('id', 'desc')).map(hydrate);
  const counts = await db('entries').select('contest_id').count({ n: '*' }).groupBy('contest_id');
  const voters = await db('voter_status').select('contest_id').count({ n: '*' }).groupBy('contest_id');
  const n = (list, id) => Number(list.find((x) => x.contest_id === id)?.n || 0);
  res.json({ contests: rows.map((c) => contestShape(c, { entryCount: n(counts, c.id), voterCount: n(voters, c.id) })) });
}));

r.post('/contests', wrap(async (req, res) => {
  const b = normaliseScope(contestBody.parse({ places: 3, ...req.body }));
  await assertRegions(b.regions);
  const now = nowIso();
  const [id] = await db('contests').insert({
    name: b.name, theme: b.theme, description: b.description, rules: b.rules,
    entry_types: JSON.stringify(b.entryTypes), regions: JSON.stringify(b.regions), is_global: b.scope === 'global', places: b.places,
    timezone: b.timezone, announced: b.announced, end_at: b.endLocal ? localToUtcIso(b.endLocal, b.timezone) : null,
    created_by: req.user.id, created_at: now, updated_at: now,
  }).returning('id').then((x) => x.map((v) => v.id ?? v));
  await audit(req.user, 'Contest created', id, { name: b.name });
  res.status(201).json({ id });
}));

function normaliseScope(b) {
  if (b.scope === 'global') return { ...b, regions: [] };
  if (b.regions.length < 1) throw bad('Choose at least one region.');
  if (b.scope === 'regional' && b.regions.length !== 1) throw bad('A regional contest has exactly one region. Use Selected regions for several.');
  return b;
}
async function assertRegions(codes) {
  const ok = await db('regions').whereIn('code', codes).where({ enabled: true }).select('code');
  if (ok.length !== new Set(codes).size) throw bad('One of those regions is not switched on yet. Turn it on under Users and regions first.');
}

r.post('/contests/:id/copy', wrap(async (req, res) => {
  const src = await getContest(req.params.id);
  const now = nowIso();
  const [row] = await db('contests').insert({
    name: `${src.name} (copy)`, theme: src.theme, description: src.description, rules: src.rules, banner_file: null,
    entry_types: JSON.stringify(src.entry_types), regions: JSON.stringify(src.regions), is_global: src.is_global, places: src.places,
    timezone: src.timezone, copied_from: src.id, created_by: req.user.id, created_at: now, updated_at: now,
  }).returning('id');
  const id = row.id ?? row;
  const tpls = await db('email_templates').where({ contest_id: src.id });
  if (tpls.length) await db('email_templates').insert(tpls.map((t) => ({ contest_id: id, key: t.key, subject: t.subject, body: t.body, updated_at: now })));
  if (src.banner_file) {
    const nk = src.banner_file.replace(`/${src.id}/`, `/${id}/`);
    try { fs.mkdirSync(path.dirname(path.join(config.uploadDir, nk)), { recursive: true }); fs.copyFileSync(path.join(config.uploadDir, src.banner_file), path.join(config.uploadDir, nk)); await db('contests').where({ id }).update({ banner_file: nk }); } catch { /* banner optional */ }
  }
  await audit(req.user, 'Contest copied', id, { from: src.id, fromName: src.name });
  res.status(201).json({ id });
}));

// ----- single contest -----
async function readiness(c) {
  const entries = await db('entries').where({ contest_id: c.id });
  const enabled = await db('regions').whereIn('code', c.regions).where({ enabled: true }).count({ n: '*' }).first();
  const regionsOk = c.is_global || Number(enabled.n) === c.regions.length;
  const recips = await regionRecipients(c);
  const checks = [
    { key: 'details', ok: !!c.name && !!c.description?.trim(), label: 'Contest name and description are filled in' },
    { key: 'entries', ok: entries.length >= Math.max(c.places, 2), label: `At least ${Math.max(c.places, 2)} entries uploaded (${entries.length} so far)` },
    { key: 'complete', ok: entries.length > 0 && entries.every(isComplete), label: 'Every entry has a file or text, a title and a description' },
    { key: 'names', ok: entries.length > 0 && entries.every((e) => e.competitor_name.trim()), label: 'Every entry has the competitor’s name (hidden from voters)' },
    { key: 'deadline', ok: !!c.end_at && new Date(c.end_at) > new Date(), label: 'Voting end date and time is set and in the future' },
    { key: 'region', ok: regionsOk && recips.length > 0, label: `Region has eligible employees (${recips.length} will be emailed)` },
  ];
  return { checks, ready: checks.every((x) => x.ok), recipients: recips.length };
}

r.get('/contests/:id', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const entryCount = Number((await db('entries').where({ contest_id: c.id }).count({ n: '*' }).first()).n);
  res.json({ contest: contestShape(c, { entryCount }), readiness: await readiness(c), timezones: TZ });
}));

r.put('/contests/:id', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status === 'closed' || c.status === 'published') throw conflict('This contest has finished and can no longer be edited.');
  if (c.status === 'live') {
    // Once voting is open only wording can change; entries, regions and rules of play are locked.
    const b = z.object({ theme: z.string().max(200), description: z.string().max(2000), rules: z.string().max(4000) }).parse(req.body);
    await db('contests').where({ id: c.id }).update({ ...b, updated_at: nowIso() });
    await audit(req.user, 'Contest wording edited while live', c.id);
    return res.json({ ok: true });
  }
  const b = normaliseScope(contestBody.parse({ places: c.places, ...req.body }));
  await assertRegions(b.regions);
  await db('contests').where({ id: c.id }).update({
    name: b.name, theme: b.theme, description: b.description, rules: b.rules,
    entry_types: JSON.stringify(b.entryTypes), regions: JSON.stringify(b.regions), is_global: b.scope === 'global', places: b.places,
    timezone: b.timezone, announced: b.announced,
    end_at: b.endLocal ? localToUtcIso(b.endLocal, b.timezone) : null, updated_at: nowIso(),
  });
  await audit(req.user, 'Contest details updated', c.id, { name: b.name, end: b.endLocal });
  res.json({ ok: true });
}));

r.post('/contests/:id/banner', upload.single('file'), wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (!req.file) throw bad('Choose an image first.');
  try {
    const key = await saveBanner({ tmpPath: req.file.path, contestId: c.id });
    removeFiles(c.banner_file);
    await db('contests').where({ id: c.id }).update({ banner_file: key, updated_at: nowIso() });
    await audit(req.user, 'Banner changed', c.id);
  } finally { cleanup(req.file); }
  res.json({ ok: true });
}));

r.delete('/contests/:id', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status !== 'draft') throw conflict('Only contests that have not started can be deleted. Finished contests are kept as history.');
  const entries = await db('entries').where({ contest_id: c.id });
  entries.forEach((e) => removeFiles(e.file_key, e.thumb_key, e.file_key && `${e.file_key}.html`));
  removeFiles(c.banner_file);
  await db.transaction(async (t) => {
    await t('entries').where({ contest_id: c.id }).del();
    await t('email_templates').where({ contest_id: c.id }).del();
    await t('contests').where({ id: c.id }).del();
    await audit(req.user, 'Draft contest deleted', null, { name: c.name }, t);
  });
  res.json({ ok: true });
}));

// ----- lifecycle -----
r.post('/contests/:id/start', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status !== 'draft') throw conflict('This contest has already started.');
  const rd = await readiness(c);
  if (!rd.ready) throw bad('Finish the checklist before starting: ' + rd.checks.filter((x) => !x.ok).map((x) => x.label).join('; '), 'not_ready');
  const recipients = await regionRecipients(c);
  await db.transaction(async (t) => {
    const n = await t('contests').where({ id: c.id, status: 'draft' }).update({ status: 'live', started_at: nowIso(), updated_at: nowIso() });
    if (!n) throw conflict('This contest has already started.');
    await queueTemplated({
      contest: c, key: 'contest_started', recipients, trx: t,
      vars: () => ({ contest_name: c.name, theme: c.theme || '', deadline: formatDeadline(c.end_at, c.timezone), vote_link: voteButton(c.id) }),
    });
    await audit(req.user, 'Contest started', c.id, { emails: recipients.length, end: c.end_at }, t);
  });
  backupNow().catch(() => {}); // safe copy at the start of voting (SQLite only)
  res.json({ ok: true, emailsQueued: recipients.length });
}));

r.post('/contests/:id/extend', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status !== 'live') throw conflict('The deadline can only be extended while voting is open.');
  const { endLocal, notify } = z.object({ endLocal: z.string(), notify: z.boolean().default(true) }).parse(req.body);
  const endAt = localToUtcIso(endLocal, c.timezone);
  if (new Date(endAt) <= new Date(c.end_at)) throw bad('The new end time must be later than the current one.');
  await db('contests').where({ id: c.id }).update({ end_at: endAt, updated_at: nowIso() });
  let queued = 0;
  if (notify) {
    queued = await queueTemplated({
      contest: c, key: 'deadline_extended', recipients: await regionRecipients(c),
      vars: () => ({ contest_name: c.name, deadline: formatDeadline(endAt, c.timezone), vote_link: voteButton(c.id) }),
    });
  }
  await audit(req.user, 'Deadline extended', c.id, { from: c.end_at, to: endAt, notified: queued });
  res.json({ ok: true, endAt, emailsQueued: queued });
}));

r.post('/contests/:id/close', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status !== 'live') throw conflict('Only a contest that is open for voting can be closed.');
  await closeContest(c.id);
  await audit(req.user, 'Voting closed early by HR', c.id, { scheduledEnd: c.end_at });
  res.json({ ok: true });
}));

r.post('/contests/:id/publish', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status === 'published') throw conflict('Results are already published.');
  if (c.status !== 'closed') throw conflict('Results can be published once voting has closed.');
  const results = await resultsPayload(c);
  const recipients = await regionRecipients(c);
  await db.transaction(async (t) => {
    const n = await t('contests').where({ id: c.id, status: 'closed' }).update({ status: 'published', published_at: nowIso(), updated_at: nowIso() });
    if (!n) throw conflict('Results are already published.');
    await queueTemplated({
      contest: c, key: 'results_declared', recipients, trx: t,
      vars: () => ({
        contest_name: c.name, results_link: resultsButton(c.id),
        winners: listBlock(results.winners.map((w) => ({ label: `${w.place === 1 ? '1st' : w.place === 2 ? '2nd' : '3rd'}${w.shared ? ' (shared)' : ''}`, title: `${w.label}: ${w.title}, by ${w.competitorName}`, sub: `${w.points} points. ${w.description}` }))),
      }),
    });
    await audit(req.user, 'Results published', c.id, { emails: recipients.length }, t);
  });
  res.json({ ok: true, emailsQueued: recipients.length });
}));

// ----- entries -----
const entryFields = z.object({
  title: z.string().trim().max(160).default(''),
  description: z.string().trim().max(1000).default(''),
  altText: z.string().trim().max(300).default(''),
  competitorName: z.string().trim().max(160).default(''),
  body: z.string().max(60000).optional(),
});

async function nextNumber(trx, contestId) {
  const c = await trx('contests').where({ id: contestId }).first('next_entry_no');
  await trx('contests').where({ id: contestId }).update({ next_entry_no: c.next_entry_no + 1 });
  return c.next_entry_no;
}
async function assertDraft(c) {
  if (c.status !== 'draft') throw conflict('Entries are locked because voting has started.', 'locked');
}

r.get('/contests/:id/entries', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const rows = await db('entries').where({ contest_id: c.id }).orderBy('number');
  res.json({ locked: c.status !== 'draft', entries: rows.map((e) => entryShape(e, { admin: true })) });
}));

// "See it as an employee sees it": same shape the voting page receives, with no names.
r.get('/contests/:id/preview', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const rows = await db('entries').where({ contest_id: c.id }).orderBy('number');
  res.json({ contest: contestShape(c), entries: rows.map((e) => entryShape(e)) });
}));

// One upload = one entry = one file (or pasted writing).
r.post('/contests/:id/entries', upload.single('file'), wrap(async (req, res) => {
  try {
    const c = await getContest(req.params.id);
    await assertDraft(c);
    const f = entryFields.parse(req.body);
    let info;
    if (req.file) {
      info = await processUpload({ tmpPath: req.file.path, originalName: req.file.originalname, contestId: c.id, allowedTypes: c.entry_types });
    } else {
      if (!c.entry_types.includes('writing')) throw bad('This contest does not accept pasted writing.');
      if (!f.body?.trim()) throw bad('Add a file, or paste the writing.');
      info = { type: 'writing' };
    }
    const now = nowIso();
    let id;
    try {
      await db.transaction(async (t) => {
        const number = await nextNumber(t, c.id);
        const row = await t('entries').insert({
          contest_id: c.id, number, type: info.type, title: f.title, description: f.description, alt_text: f.altText,
          file_key: info.file_key ?? null, thumb_key: info.thumb_key ?? null, mime: info.mime ?? null, ext: info.ext ?? null,
          size: info.size ?? null, page_count: info.page_count ?? null, body: info.type === 'writing' ? f.body : null,
          competitor_name: f.competitorName, created_at: now, updated_at: now,
        }).returning('id');
        id = row[0].id ?? row[0];
        await audit(req.user, 'Entry added', c.id, { entry: entryLabel(number), type: info.type }, t);
      });
    } catch (e) { removeFiles(info.file_key, info.thumb_key, info.file_key && `${info.file_key}.html`); throw e; }
    res.status(201).json({ id });
  } finally { cleanup(req.file); }
}));

r.put('/entries/:entryId', upload.single('file'), wrap(async (req, res) => {
  try {
    const e = await db('entries').where({ id: Number(req.params.entryId) }).first();
    if (!e) throw notFound();
    const c = await getContest(e.contest_id);
    await assertDraft(c);
    const f = entryFields.parse(req.body);
    const patch = { title: f.title, description: f.description, alt_text: f.altText, competitor_name: f.competitorName, updated_at: nowIso() };
    if (e.type === 'writing' && f.body !== undefined) patch.body = f.body;
    let info;
    if (req.file) {
      info = await processUpload({ tmpPath: req.file.path, originalName: req.file.originalname, contestId: c.id, allowedTypes: c.entry_types });
      Object.assign(patch, { type: info.type, file_key: info.file_key, thumb_key: info.thumb_key ?? null, mime: info.mime, ext: info.ext, size: info.size, page_count: info.page_count ?? null, body: null });
    }
    await db('entries').where({ id: e.id }).update(patch);
    if (info) removeFiles(e.file_key, e.thumb_key, e.file_key && `${e.file_key}.html`);
    await audit(req.user, 'Entry edited', c.id, { entry: entryLabel(e.number), fileReplaced: !!info });
    res.json({ ok: true });
  } finally { cleanup(req.file); }
}));

r.delete('/entries/:entryId', wrap(async (req, res) => {
  const e = await db('entries').where({ id: Number(req.params.entryId) }).first();
  if (!e) throw notFound();
  const c = await getContest(e.contest_id);
  await assertDraft(c);
  await db('entries').where({ id: e.id }).del();
  removeFiles(e.file_key, e.thumb_key, e.file_key && `${e.file_key}.html`);
  await audit(req.user, 'Entry removed', c.id, { entry: entryLabel(e.number) });
  res.json({ ok: true });
}));

// ----- emails -----
r.get('/contests/:id/emails', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const templates = [];
  for (const key of TEMPLATE_KEYS) {
    const t = await getTemplate(c.id, key);
    const sent = Number((await db('outbox').where({ contest_id: c.id, kind: key }).count({ n: '*' }).first()).n);
    templates.push({ key, ...TEMPLATE_META[key], subject: t.subject, body: t.body, custom: t.custom, defaultSubject: TEMPLATE_META[key].subject, defaultBody: TEMPLATE_META[key].body, sent });
  }
  res.json({ templates });
}));

r.put('/contests/:id/emails/:key', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (!TEMPLATE_META[req.params.key]) throw notFound();
  const b = z.object({ subject: z.string().trim().min(2).max(200), body: z.string().trim().min(5).max(6000) }).parse(req.body);
  await db('email_templates').insert({ contest_id: c.id, key: req.params.key, ...b, updated_at: nowIso() }).onConflict(['contest_id', 'key']).merge();
  await audit(req.user, 'Email wording edited', c.id, { template: req.params.key });
  res.json({ ok: true });
}));

r.delete('/contests/:id/emails/:key', wrap(async (req, res) => {
  await db('email_templates').where({ contest_id: Number(req.params.id), key: req.params.key }).del();
  res.json({ ok: true });
}));

function sampleVars(c, user, key) {
  const deadline = formatDeadline(c.end_at || new Date(Date.now() + 7 * 864e5).toISOString(), c.timezone);
  return {
    contest_name: c.name, theme: c.theme || '', deadline, vote_link: voteButton(c.id), results_link: resultsButton(c.id),
    picks: listBlock([{ label: '1st', title: 'Entry 07: Sample title', sub: 'A line about the work' }, { label: '2nd', title: 'Entry 02: Another title', sub: 'A line about the work' }, { label: '3rd', title: 'Entry 11: A third title', sub: 'A line about the work' }]),
    winners: listBlock([{ label: '1st', title: 'Entry 07: Sample title, by Sample Winner', sub: '38 points' }, { label: '2nd', title: 'Entry 02: Another title, by Another Winner', sub: '31 points' }, { label: '3rd', title: 'Entry 11: A third title, by Third Winner', sub: '24 points' }]),
  };
}

async function requireEmailOn() {
  if (!(await getFlags()).emailNotifications) throw conflict('Email notifications are switched off. Turn them on in Settings first.', 'email_off');
}

// A test email goes only to the admin who asks for it.
r.post('/contests/:id/emails/:key/test', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (!TEMPLATE_META[req.params.key]) throw notFound();
  await requireEmailOn();
  const b = z.object({ subject: z.string().optional(), body: z.string().optional() }).parse(req.body || {});
  const saved = await getTemplate(c.id, req.params.key);
  const msg = renderEmail({ subject: b.subject || saved.subject, body: b.body || saved.body }, { name: req.user.name, ...sampleVars(c, req.user, req.params.key) });
  await queue([{ contestId: c.id, kind: 'test', to: req.user.email, toName: req.user.name, ...msg, subject: `[TEST] ${msg.subject}` }]);
  res.json({ ok: true, sentTo: req.user.email });
}));

r.post('/contests/:id/emails/preview', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const b = z.object({ key: z.string(), subject: z.string(), body: z.string() }).parse(req.body);
  const msg = renderEmail({ subject: b.subject, body: b.body }, { name: req.user.name, ...sampleVars(c, req.user, b.key) });
  res.json(msg);
}));

r.post('/contests/:id/reminder', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status !== 'live') throw conflict('Reminders can only be sent while voting is open.');
  await requireEmailOn();
  const voted = new Set((await db('voter_status').where({ contest_id: c.id }).select('user_id')).map((v) => v.user_id));
  const todo = (await regionRecipients(c)).filter((u) => !voted.has(u.id));
  await queueTemplated({
    contest: c, key: 'reminder', recipients: todo,
    vars: () => ({ contest_name: c.name, deadline: formatDeadline(c.end_at, c.timezone), vote_link: voteButton(c.id) }),
  });
  await audit(req.user, 'Reminder sent', c.id, { recipients: todo.length });
  res.json({ ok: true, emailsQueued: todo.length });
}));

export default r;
