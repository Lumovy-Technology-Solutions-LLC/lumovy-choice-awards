import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, parseJson } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { getContest, contestShape, entryShape, isEligible, regionLabel, resultsPayload, hydrate, STATUS_LABEL } from '../lib/contests.js';
import { voterCount, pointsFor } from '../lib/scoring.js';
import { queueTemplated, listBlock } from '../lib/mail.js';
import { wrap, bad, forbidden, notFound, conflict, entryLabel, encryptReceipt, decryptReceipt } from '../lib/util.js';

const r = Router();
r.use(requireAuth);

const month = (iso) => iso ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '';

/** Contests this person may see: their region, and not an unannounced draft. */
async function visibleContests(user) {
  const all = (await db('contests').orderBy('id', 'desc')).map(hydrate);
  const now = Date.now();
  // Everyone can SEE every contest; only participating regions can vote.
  return all.filter((c) => c.status !== 'draft' || c.announced)
    // a live contest whose time has passed is closed even if the scheduler has not run yet
    .map((c) => (c.status === 'live' && c.end_at && new Date(c.end_at).getTime() <= now ? { ...c, status: 'closed' } : c));
}

r.get('/home', wrap(async (req, res) => {
  const list = await visibleContests(req.user);
  const live = list.filter((c) => c.status === 'live').sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
  const soon = list.filter((c) => c.status === 'draft');
  const done = list.filter((c) => c.status === 'closed' || c.status === 'published').sort((a, b) => new Date(b.end_at || b.closed_at || 0) - new Date(a.end_at || a.closed_at || 0)); // newest first
  const featured = live[0] || null; // the banner shows only contests open for voting

  const myVotes = new Set((await db('voter_status').where({ user_id: req.user.id }).select('contest_id')).map((v) => v.contest_id));
  const withMeta = async (c) => contestShape(c, {
    entryCount: Number((await db('entries').where({ contest_id: c.id }).count({ n: '*' }).first()).n),
    hasVoted: myVotes.has(c.id), canVote: isEligible(req.user, c),
  });
  const past = [];
  for (const c of done) {
    past.push({ id: c.id, name: c.name, month: month(c.end_at || c.closed_at), votes: await voterCount(c.id), status: c.status, statusLabel: STATUS_LABEL[c.status] });
  }
  res.json({
    serverTime: nowIso(),
    featured: featured ? await withMeta(featured) : null,
    alsoOpen: await Promise.all(live.filter((c) => c.id !== featured?.id).map(withMeta)),
    upcoming: await Promise.all(soon.filter((c) => c.id !== featured?.id).map(withMeta)),
    past,
  });
}));

async function loadVisible(req) {
  const c = await getContest(req.params.id);
  if (c.status === 'draft' && !c.announced) throw notFound('Contest not found');
  return c;
}
async function loadParticipant(req) {
  const c = await loadVisible(req);
  if (!isEligible(req.user, c)) throw forbidden(`This contest is open to employees in ${regionLabel(c)}. You can follow it, but you cannot vote in it.`, 'not_eligible');
  return c;
}

r.get('/contests/:id', wrap(async (req, res) => {
  const c = await loadVisible(req);
  const voted = await db('voter_status').where({ contest_id: c.id, user_id: req.user.id }).first();
  const draft = await db('ballot_drafts').where({ contest_id: c.id, user_id: req.user.id }).first();
  const entryCount = Number((await db('entries').where({ contest_id: c.id }).count({ n: '*' }).first()).n);
  res.json({
    serverTime: nowIso(),
    contest: contestShape(c, { entryCount, canVote: isEligible(req.user, c), myStatus: voted ? 'submitted' : draft && parseJson(draft.picks, []).length ? 'draft' : 'none' }),
  });
}));

// Entries are only ever shown on the voting page, and only while voting is open.
r.get('/contests/:id/entries', wrap(async (req, res) => {
  const c = await loadParticipant(req);
  if (c.status !== 'live') throw forbidden('Entries can only be seen while voting is open.', 'not_live');
  const entries = await db('entries').where({ contest_id: c.id }).orderBy('number');
  res.json({ serverTime: nowIso(), contest: contestShape(c), entries: entries.map((e) => entryShape(e)) });
}));

async function myBallot(c, userId) {
  const vs = await db('voter_status').where({ contest_id: c.id, user_id: userId }).first();
  if (vs) {
    const picks = decryptReceipt(userId, vs.receipt) || [];
    const ids = picks.map((p) => p.entryId);
    const rows = ids.length ? await db('entries').whereIn('id', ids) : [];
    return {
      status: 'submitted', submittedAt: vs.submitted_at,
      picks: picks.map((p) => ({ rank: p.rank, entry: entryShape(rows.find((e) => e.id === p.entryId) || { id: p.entryId, number: 0, type: 'image' }) })),
    };
  }
  const d = await db('ballot_drafts').where({ contest_id: c.id, user_id: userId }).first();
  return { status: 'draft', picks: d ? parseJson(d.picks, []) : [], updatedAt: d?.updated_at };
}

r.get('/contests/:id/ballot', wrap(async (req, res) => {
  const c = await loadParticipant(req);
  res.json(await myBallot(c, req.user.id));
}));

const picksSchema = z.object({ picks: z.array(z.object({ entryId: z.number().int(), rank: z.number().int().min(1) })) });

async function validatePicks(c, picks, { complete }) {
  if (picks.length > c.places) throw bad(`You can pick up to ${c.places} entries.`);
  if (complete && picks.length !== c.places) throw bad(`Please pick ${c.places} different entries before submitting.`);
  if (new Set(picks.map((p) => p.entryId)).size !== picks.length) throw bad('Each pick must be a different entry.');
  if (new Set(picks.map((p) => p.rank)).size !== picks.length) throw bad('Each place can only be used once.');
  if (picks.some((p) => p.rank > c.places)) throw bad('That place is not part of this contest.');
  if (complete && picks.some((p) => p.rank < 1)) throw bad('Invalid place.');
  if (picks.length) {
    const found = await db('entries').where({ contest_id: c.id }).whereIn('id', picks.map((p) => p.entryId)).count({ n: '*' }).first();
    if (Number(found.n) !== picks.length) throw bad('One of those entries is not in this contest.');
  }
}

async function assertOpen(c, userId) {
  if (c.status !== 'live') throw conflict('Voting is closed. Votes can no longer be saved or submitted.', 'closed');
  if (await db('voter_status').where({ contest_id: c.id, user_id: userId }).first()) throw conflict('You have already voted in this contest. Votes cannot be changed.', 'already_voted');
}

// Save for later: unfinished picks wait for the voter, but never count.
r.put('/contests/:id/ballot', wrap(async (req, res) => {
  const c = await loadParticipant(req);
  await assertOpen(c, req.user.id);
  const { picks } = picksSchema.parse(req.body);
  await validatePicks(c, picks, { complete: false });
  await db('ballot_drafts').insert({ contest_id: c.id, user_id: req.user.id, picks: JSON.stringify(picks), updated_at: nowIso() })
    .onConflict(['contest_id', 'user_id']).merge();
  res.json({ ok: true, savedAt: nowIso() });
}));

r.post('/contests/:id/vote', wrap(async (req, res) => {
  const c = await loadParticipant(req);
  await assertOpen(c, req.user.id);
  const { picks } = picksSchema.parse(req.body);
  await validatePicks(c, picks, { complete: true });
  try {
    await db.transaction(async (trx) => {
      // PK (contest, user) makes a second ballot impossible, even with simultaneous requests.
      await trx('voter_status').insert({
        contest_id: c.id, user_id: req.user.id, submitted_at: nowIso(),
        receipt: encryptReceipt(req.user.id, picks),
      });
      await trx('votes').insert(picks.map((p) => ({ contest_id: c.id, entry_id: p.entryId, rank: p.rank, points: pointsFor(p.rank, c.places) })));
      await trx('ballot_drafts').where({ contest_id: c.id, user_id: req.user.id }).del();
    });
  } catch (e) {
    if (/UNIQUE|unique|duplicate|PRIMARY/i.test(String(e.message))) throw conflict('You have already voted in this contest. Votes cannot be changed.', 'already_voted');
    throw e;
  }
  const ballot = await myBallot(c, req.user.id);
  await queueTemplated({
    contest: c, key: 'vote_confirmation', recipients: [req.user],
    vars: () => ({
      contest_name: c.name,
      picks: listBlock([...ballot.picks].sort((a, b) => a.rank - b.rank).map((p) => ({ label: ['1st', '2nd', '3rd'][p.rank - 1] || `${p.rank}th`, title: `${p.entry.label}: ${p.entry.title}`, sub: p.entry.description }))),
    }),
  });
  res.json({ ok: true, ballot });
}));

r.get('/contests/:id/results', wrap(async (req, res) => {
  const c = await loadVisible(req);
  if (c.status !== 'published') throw forbidden('Results have not been published yet.', 'not_published');
  const payload = await resultsPayload(c);
  const mine = await db('voter_status').where({ contest_id: c.id, user_id: req.user.id }).first();
  // Only the signed-in voter's own receipt is returned; it is decrypted with their own key.
  const myPicks = mine ? (decryptReceipt(req.user.id, mine.receipt) || []) : [];
  res.json({ ...payload, myVoted: !!mine, myPicks });
}));

export default r;
