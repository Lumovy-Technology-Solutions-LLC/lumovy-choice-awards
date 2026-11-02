import { Router } from 'express';
import fs from 'node:fs';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { getContest, isEligible } from '../lib/contests.js';
import { filePath } from '../lib/files.js';
import { wrap, notFound, forbidden, entryLabel } from '../lib/util.js';

const r = Router();
r.use(requireAuth);

const NO_LEAK = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' };

// Entry files: HR any time; employees only while voting is open (or once results are published).
// The download name is always "Entry NN.ext", never the original file name.
async function loadEntryForUser(req) {
  const e = await db('entries').where({ id: Number(req.params.id) }).first();
  if (!e) throw notFound();
  if (req.user.role === 'admin') return e;
  const c = await getContest(e.contest_id);
  // live: participating regions only; published: anyone can see the results
  const ok = c.status === 'published' || (c.status === 'live' && isEligible(req.user, c));
  if (!ok) throw forbidden();
  return e;
}

r.get('/entries/:id', wrap(async (req, res) => {
  const e = await loadEntryForUser(req);
  const key = req.query.thumb ? e.thumb_key : e.file_key;
  if (!key || !fs.existsSync(filePath(key))) throw notFound();
  res.set(NO_LEAK);
  const ext = req.query.thumb ? '.webp' : e.ext;
  res.set('Content-Disposition', `inline; filename="${entryLabel(e.number)}${ext}"`);
  res.type(req.query.thumb ? 'image/webp' : e.mime);
  res.sendFile(filePath(key)); // supports Range requests for video
}));

// Word documents are shown in the built-in viewer as sanitised HTML converted at upload time.
r.get('/entries/:id/html', wrap(async (req, res) => {
  const e = await loadEntryForUser(req);
  if (e.ext !== '.docx' || !e.file_key) throw notFound();
  const p = filePath(e.file_key + '.html');
  if (!fs.existsSync(p)) throw notFound();
  res.set(NO_LEAK);
  res.json({ html: await fs.promises.readFile(p, 'utf8'), pageCount: e.page_count });
}));

r.get('/banners/:contestId', wrap(async (req, res) => {
  const c = await db('contests').where({ id: Number(req.params.contestId) }).first();
  if (!c?.banner_file || !fs.existsSync(filePath(c.banner_file))) throw notFound();
  res.set(NO_LEAK);
  res.type('image/webp').sendFile(filePath(c.banner_file));
}));

export default r;
