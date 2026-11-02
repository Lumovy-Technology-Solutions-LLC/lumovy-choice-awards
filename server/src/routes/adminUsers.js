import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { refreshRegions } from '../lib/contests.js';
import { wrap, bad, notFound, conflict, normEmail, isEmail } from '../lib/util.js';

const r = Router();
const tmpDir = path.join(config.dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 10 * 1024 * 1024 } });

const shape = (u) => ({
  id: u.id, name: u.name, email: u.email, team: u.team, region: u.region, role: u.role,
  active: !!u.active, hasPassword: !!u.password_hash, lastLoginAt: u.last_login_at,
});

// ---- regions ----
r.get('/regions', wrap(async (_req, res) => {
  const regions = await db('regions').orderBy('code');
  const counts = await db('users').where({ active: true }).select('region').count({ n: '*' }).groupBy('region');
  res.json({ regions: regions.map((g) => ({ ...g, enabled: !!g.enabled, employees: Number(counts.find((c) => c.region === g.code)?.n || 0) })) });
}));

r.post('/regions', wrap(async (req, res) => {
  const b = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Use a short region code such as IN or US.'), name: z.string().trim().min(2), timezone: z.string().default('Asia/Kolkata') }).parse(req.body);
  if (await db('regions').where({ code: b.code }).first()) throw conflict('That region already exists.');
  await db('regions').insert({ ...b, enabled: false });
  await refreshRegions();
  await audit(req.user, 'Region added', null, b);
  res.status(201).json({ ok: true });
}));

r.put('/regions/:code', wrap(async (req, res) => {
  const b = z.object({ enabled: z.boolean(), name: z.string().trim().min(2).optional() }).parse(req.body);
  const g = await db('regions').where({ code: req.params.code }).first();
  if (!g) throw notFound();
  if (!b.enabled && g.enabled) {
    const open = (await db('contests').whereIn('status', ['draft', 'live'])).filter((c) => JSON.parse(c.regions).includes(g.code));
    if (open.length) throw conflict(`${g.name} is used by an unfinished contest (${open[0].name}). Finish or change it first.`);
  }
  await db('regions').where({ code: g.code }).update({ enabled: b.enabled, ...(b.name ? { name: b.name } : {}) });
  await refreshRegions();
  await audit(req.user, b.enabled ? 'Region switched on' : 'Region switched off', null, { region: g.code });
  res.json({ ok: true });
}));

// ---- users ----
r.get('/users', wrap(async (req, res) => {
  const { q = '', region = '', status = '', role = '', page = '1', pageSize = '50' } = req.query;
  const ps = Math.min(200, Math.max(10, Number(pageSize) || 50));
  const base = db('users').modify((qb) => {
    if (q) qb.where((w) => w.whereRaw('lower(name) like ?', [`%${String(q).toLowerCase()}%`]).orWhereRaw('lower(email) like ?', [`%${String(q).toLowerCase()}%`]).orWhereRaw('lower(team) like ?', [`%${String(q).toLowerCase()}%`]));
    if (region) qb.where({ region });
    if (status === 'active') qb.where({ active: true });
    if (status === 'inactive') qb.where({ active: false });
    if (role) qb.where({ role });
  });
  const total = Number((await base.clone().count({ n: '*' }).first()).n);
  const rows = await base.clone().orderBy('name').limit(ps).offset((Math.max(1, Number(page)) - 1) * ps);
  const totals = {
    active: Number((await db('users').where({ active: true }).count({ n: '*' }).first()).n),
    inactive: Number((await db('users').where({ active: false }).count({ n: '*' }).first()).n),
    admins: Number((await db('users').where({ active: true, role: 'admin' }).count({ n: '*' }).first()).n),
  };
  res.json({ total, page: Number(page), pageSize: ps, users: rows.map(shape), totals });
}));

const userBody = z.object({
  name: z.string().trim().min(2, 'Enter the employee’s name.').max(120),
  email: z.string().trim().refine(isEmail, 'Enter a valid work email.'),
  team: z.string().trim().max(120).default(''),
  region: z.string().trim().min(2),
  role: z.enum(['employee', 'admin']).default('employee'),
  active: z.boolean().default(true),
});

async function assertRegionExists(code) {
  if (!(await db('regions').where({ code }).first())) throw bad(`Region “${code}” does not exist. Add it under Regions first.`);
}
async function assertNotLastAdmin(id, next) {
  const u = await db('users').where({ id }).first();
  if (u.role === 'admin' && u.active && (next.role === 'employee' || next.active === false)) {
    const n = Number((await db('users').where({ role: 'admin', active: true }).count({ n: '*' }).first()).n);
    if (n <= 1) throw conflict('There must always be at least one active HR admin.');
  }
}

r.post('/users', wrap(async (req, res) => {
  const b = userBody.parse(req.body);
  await assertRegionExists(b.region);
  const email = normEmail(b.email);
  if (await db('users').where({ email }).first()) throw conflict('Someone with that email already exists.');
  const [row] = await db('users').insert({ ...b, email, created_at: nowIso() }).returning('id');
  await audit(req.user, b.role === 'admin' ? 'HR admin added' : 'Employee added', null, { email, region: b.region });
  res.status(201).json({ id: row.id ?? row });
}));

r.put('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = await db('users').where({ id }).first();
  if (!u) throw notFound();
  const b = userBody.partial().parse(req.body);
  if (b.region) await assertRegionExists(b.region);
  if (id === req.user.id && (b.role === 'employee' || b.active === false)) throw conflict('You cannot remove your own admin access or switch yourself off.');
  await assertNotLastAdmin(id, b);
  const patch = { ...b };
  if (b.email) {
    patch.email = normEmail(b.email);
    const other = await db('users').where({ email: patch.email }).whereNot({ id }).first();
    if (other) throw conflict('Someone else already has that email.');
  }
  await db('users').where({ id }).update(patch);
  const what = b.active === false ? 'Employee switched off' : b.active === true && !u.active ? 'Employee switched on'
    : b.role && b.role !== u.role ? (b.role === 'admin' ? 'HR admin added' : 'HR admin removed') : 'Employee updated';
  await audit(req.user, what, null, { email: u.email });
  res.json({ ok: true });
}));

// ---- spreadsheet import ----
const HEAD = { name: ['name', 'full name', 'employee name'], email: ['email', 'e-mail', 'work email', 'email address'], team: ['team', 'department', 'dept'], region: ['region', 'country', 'location'] };
const findCol = (headers, names) => headers.findIndex((h) => names.includes(String(h || '').trim().toLowerCase()));

r.post('/users/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Choose a spreadsheet (.xlsx or .csv) first.');
  try {
    const wb = new ExcelJS.Workbook();
    if (/\.csv$/i.test(req.file.originalname)) await wb.csv.readFile(req.file.path); else await wb.xlsx.readFile(req.file.path);
    const ws = wb.worksheets[0];
    if (!ws) throw bad('That file has no data.');
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v && typeof v === 'object' ? v.text ?? v.result ?? '' : v))));
    if (rows.length < 2) throw bad('The spreadsheet needs a header row (name, email, team, region) and at least one employee.');
    const h = rows[0];
    const col = { name: findCol(h, HEAD.name), email: findCol(h, HEAD.email), team: findCol(h, HEAD.team), region: findCol(h, HEAD.region) };
    if (col.name < 0 || col.email < 0 || col.region < 0) throw bad('The first row must have “name” and “email” columns (team is optional). Every employee must have a region.');
    if (rows.length > 20001) throw bad('Please import at most 20,000 people at a time.');

    const regionRows = await db('regions');
    const regionBy = (v) => { const s = String(v || '').trim().toLowerCase(); return regionRows.find((g) => g.code.toLowerCase() === s || g.name.toLowerCase() === s)?.code; };
    const dryRun = req.query.dryRun === '1';
    const out = { created: 0, updated: 0, skipped: 0, errors: [] };
    const seen = new Set();
    const existing = new Map((await db('users').select('id', 'email')).map((u) => [u.email, u.id]));
    const inserts = []; const updates = [];
    rows.slice(1).forEach((row, i) => {
      const line = i + 2;
      const name = String(row[col.name] ?? '').trim();
      const email = normEmail(row[col.email]);
      if (!name && !email) return;
      if (!name || !isEmail(email)) { out.errors.push({ line, error: !name ? 'Missing name' : `“${email || ''}” is not a valid email` }); return; }
      if (seen.has(email)) { out.skipped++; return; }
      seen.add(email);
      const rawRegion = col.region >= 0 ? row[col.region] : '';
      if (!rawRegion) { out.errors.push({ line, error: 'Region is required: every employee must belong to a region' }); return; }
      const region = regionBy(rawRegion);
      if (!region) { out.errors.push({ line, error: `Region “${rawRegion}” is not set up` }); return; }
      const team = col.team >= 0 ? String(row[col.team] ?? '').trim() : '';
      if (existing.has(email)) updates.push({ id: existing.get(email), name, team, region });
      else inserts.push({ name, email, team, region, role: 'employee', active: true, created_at: nowIso() });
    });
    out.created = inserts.length; out.updated = updates.length;
    if (!dryRun) {
      await db.transaction(async (t) => {
        if (inserts.length) await t.batchInsert('users', inserts, 100);
        for (const u of updates) await t('users').where({ id: u.id }).update({ name: u.name, team: u.team, region: u.region });
        await audit(req.user, 'Employees imported', null, { created: out.created, updated: out.updated, errors: out.errors.length }, t);
      });
    }
    res.json({ ...out, dryRun });
  } finally { fs.rm(req.file.path, { force: true }, () => {}); }
}));

r.get('/users/template.xlsx', wrap(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Employees');
  ws.columns = [{ header: 'name', width: 28 }, { header: 'email', width: 36 }, { header: 'team', width: 22 }, { header: 'region', width: 12 }];
  ws.addRow(['Asha Rao', 'asha.rao@lumovy.com', 'Engineering', 'IN']);
  ws.getRow(1).font = { bold: true };
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="employee-import-template.xlsx"' });
  await wb.xlsx.write(res); res.end();
}));

export default r;
