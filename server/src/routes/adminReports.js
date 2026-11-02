import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db, parseJson } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { getContest, participantRegions, contestShape, entryShape, regionRecipients, resultsPayload, STATUS_LABEL, hydrate } from '../lib/contests.js';
import { tally } from '../lib/scoring.js';
import { wrap, notFound, conflict, entryLabel } from '../lib/util.js';

const r = Router();

async function dashboardData(c) {
  const recipients = await regionRecipients(c);
  const votedRows = await db('voter_status').where({ contest_id: c.id }).select('user_id', 'submitted_at');
  const voted = new Set(votedRows.map((v) => v.user_id));
  const eligible = recipients.length;
  const draftCount = c.status === 'live' ? Number((await db('ballot_drafts').where({ contest_id: c.id }).count({ n: '*' }).first()).n) : 0;

  const lb = await tally(c.id);
  const maxPts = Math.max(1, ...lb.map((t) => t.points));
  // votes per hour (or per day for long contests), no entry information
  const span = c.started_at ? Date.now() - new Date(c.started_at).getTime() : 0;
  const bucketMs = span > 3 * 864e5 ? 864e5 : 36e5;
  const buckets = new Map();
  for (const v of votedRows) {
    const k = Math.floor(new Date(v.submitted_at).getTime() / bucketMs) * bucketMs;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  const timeline = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t: new Date(t).toISOString(), n }));

  const byTeam = new Map();
  const teamUsers = await db('users').whereIn('id', recipients.map((u) => u.id)).select('id', 'team');
  for (const u of teamUsers) {
    const k = u.team || 'No team';
    const t = byTeam.get(k) || { team: k, eligible: 0, voted: 0 };
    t.eligible++; if (voted.has(u.id)) t.voted++;
    byTeam.set(k, t);
  }
  return {
    serverTime: new Date().toISOString(),
    eligible, voted: voted.size, notVoted: Math.max(0, eligible - [...voted].filter((id) => recipients.some((u) => u.id === id)).length),
    turnout: eligible ? Math.round((voted.size / eligible) * 1000) / 10 : 0,
    savedDrafts: draftCount,
    leaderboard: lb.map((t) => ({ ...entryShape(t.entry, { admin: true }), points: t.points, firsts: t.firsts, seconds: t.seconds, thirds: t.thirds, place: t.place, shared: t.shared, pct: Math.round((t.points / maxPts) * 100) })),
    timeline, bucketMs, byTeam: [...byTeam.values()].sort((a, b) => b.eligible - a.eligible),
  };
}

r.get('/contests/:id/dashboard', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  res.json({ contest: contestShape(c), ...(await dashboardData(c)) });
}));

r.get('/contests/:id/non-voters', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const voted = new Set((await db('voter_status').where({ contest_id: c.id }).select('user_id')).map((v) => v.user_id));
  const users = (await db('users').where({ active: true }).whereIn('region', participantRegions(c)).orderBy('name')).filter((u) => !voted.has(u.id));
  res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, team: u.team })) });
}));

r.get('/contests/:id/voters', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const rows = await db('voter_status').join('users', 'users.id', 'voter_status.user_id').where({ contest_id: c.id })
    .select('users.id', 'users.name', 'users.email', 'users.team', 'voter_status.submitted_at').orderBy('submitted_at', 'desc');
  res.json({ voters: rows }); // who voted only; never what they voted for
}));

// Results for HR to check before publishing (also available as soon as voting closes).
r.get('/contests/:id/results', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status === 'draft') throw conflict('Voting has not started yet.');
  res.json(await resultsPayload(c));
}));

const sheet = (wb, name, cols) => { const ws = wb.addWorksheet(name); ws.columns = cols; ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D31C4' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; return ws; };
async function send(res, wb, filename) {
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
  await wb.xlsx.write(res); res.end();
}
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

r.get('/contests/:id/export/results.xlsx', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  if (c.status === 'draft') throw conflict('Voting has not started yet.');
  const list = await tally(c.id);
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, 'Results', [
    { header: 'Place', key: 'place', width: 8 }, { header: 'Entry', key: 'entry', width: 12 }, { header: 'Title', key: 'title', width: 32 },
    { header: 'Description', key: 'desc', width: 50 }, { header: 'Competitor', key: 'who', width: 26 }, { header: 'Points', key: 'pts', width: 9 },
    { header: '1st picks', key: 'f', width: 10 }, { header: '2nd picks', key: 's', width: 10 }, { header: '3rd picks', key: 't', width: 10 }, { header: 'Shared place', key: 'sh', width: 12 },
  ]);
  list.forEach((t) => ws.addRow({ place: t.place, entry: entryLabel(t.entry.number), title: t.entry.title, desc: t.entry.description, who: t.entry.competitor_name, pts: t.points, f: t.firsts, s: t.seconds, t: t.thirds, sh: t.shared ? 'Yes' : '' }));
  const sm = sheet(wb, 'Summary', [{ header: 'Item', width: 26 }, { header: 'Value', width: 40 }]);
  const eligible = (await regionRecipients(c)).length; const voters = Number((await db('voter_status').where({ contest_id: c.id }).count({ n: '*' }).first()).n);
  [['Contest', c.name], ['Status', STATUS_LABEL[c.status]], ['Eligible employees', eligible], ['Votes cast', voters], ['Turnout %', eligible ? Math.round((voters / eligible) * 1000) / 10 : 0], ['Scoring', '1st = 3, 2nd = 2, 3rd = 1 points'], ['Tie-break', 'More 1st picks, then more 2nd picks, else shared place']].forEach((x) => sm.addRow(x));
  await audit(req.user, 'Results downloaded', c.id);
  await send(res, wb, `${slug(c.name)}-results.xlsx`);
}));

r.get('/contests/:id/export/voters.xlsx', wrap(async (req, res) => {
  const c = await getContest(req.params.id);
  const users = await regionRecipients(c);
  const full = await db('users').whereIn('id', users.map((u) => u.id));
  const voted = new Map((await db('voter_status').where({ contest_id: c.id }).select('user_id', 'submitted_at')).map((v) => [v.user_id, v.submitted_at]));
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, 'Voters', [{ header: 'Name', width: 28 }, { header: 'Email', width: 36 }, { header: 'Team', width: 22 }, { header: 'Region', width: 10 }, { header: 'Voted', width: 10 }, { header: 'Voted at (UTC)', width: 24 }]);
  full.sort((a, b) => a.name.localeCompare(b.name)).forEach((u) => ws.addRow([u.name, u.email, u.team, u.region, voted.has(u.id) ? 'Yes' : 'No', voted.get(u.id) || '']));
  await audit(req.user, 'Voter list downloaded', c.id);
  await send(res, wb, `${slug(c.name)}-voters.xlsx`);
}));

// ---- history, audit, outbox, overview ----
r.get('/audit', wrap(async (req, res) => {
  const { contest, page = '1' } = req.query;
  const q = db('audit_log').modify((qb) => { if (contest) qb.where({ contest_id: Number(contest) }); });
  const total = Number((await q.clone().count({ n: '*' }).first()).n);
  const rows = await q.clone().orderBy('id', 'desc').limit(100).offset((Math.max(1, Number(page)) - 1) * 100);
  res.json({ total, items: rows.map((a) => ({ id: a.id, actor: a.actor_name, action: a.action, contestId: a.contest_id, detail: parseJson(a.detail, {}), at: a.at })) });
}));

r.get('/outbox', wrap(async (req, res) => {
  const { contest, status, kind, page = '1' } = req.query;
  const q = db('outbox').modify((qb) => { if (contest) qb.where({ contest_id: Number(contest) }); if (status) qb.where({ status }); if (kind) qb.where({ kind }); });
  const total = Number((await q.clone().count({ n: '*' }).first()).n);
  const rows = await q.clone().orderBy('id', 'desc').limit(50).offset((Math.max(1, Number(page)) - 1) * 50).select('id', 'contest_id', 'kind', 'to_email', 'to_name', 'subject', 'status', 'attempts', 'error', 'created_at', 'sent_at');
  const stats = await db('outbox').select('status').count({ n: '*' }).groupBy('status');
  res.json({ total, items: rows, stats: Object.fromEntries(stats.map((s) => [s.status, Number(s.n)])) });
}));

r.get('/outbox/:id', wrap(async (req, res) => {
  const m = await db('outbox').where({ id: Number(req.params.id) }).first();
  if (!m) throw notFound();
  res.json({ message: m });
}));

r.get('/overview', wrap(async (_req, res) => {
  const contests = (await db('contests').orderBy('id', 'desc')).map(hydrate);
  const users = await db('users').where({ active: true }).count({ n: '*' }).first();
  const live = contests.filter((c) => c.status === 'live');
  const out = [];
  for (const c of live) out.push({ ...contestShape(c), ...(await dashboardData(c).then((d) => ({ eligible: d.eligible, voted: d.voted, turnout: d.turnout }))) });
  const queued = Number((await db('outbox').where({ status: 'queued' }).count({ n: '*' }).first()).n);
  res.json({
    serverTime: new Date().toISOString(),
    totals: { contests: contests.length, live: live.length, drafts: contests.filter((c) => c.status === 'draft').length, finished: contests.filter((c) => c.status === 'closed' || c.status === 'published').length, awaitingPublish: contests.filter((c) => c.status === 'closed').length, employees: Number(users.n), queuedEmails: queued },
    live: out,
    awaitingPublish: contests.filter((c) => c.status === 'closed').map((c) => contestShape(c)),
    recentAudit: (await db('audit_log').orderBy('id', 'desc').limit(8)).map((a) => ({ id: a.id, actor: a.actor_name, action: a.action, contestId: a.contest_id, at: a.at })),
  });
}));

export default r;
