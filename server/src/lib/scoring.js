import { db } from '../db/index.js';

/**
 * Points: 1st=places, 2nd=places-1 ... (3-2-1 for the default 3 places).
 * Ties: more 1st-place picks, then more 2nd-place picks, else they share the place.
 */
export const pointsFor = (rank, places) => places - rank + 1;

export async function tally(contestId) {
  const entries = await db('entries').where({ contest_id: contestId }).orderBy('number');
  const rows = await db('votes').where({ contest_id: contestId })
    .select('entry_id', 'rank').count({ n: '*' }).groupBy('entry_id', 'rank');
  const places = (await db('contests').where({ id: contestId }).first('places'))?.places ?? 3;

  const by = new Map(entries.map((e) => [e.id, { entry: e, points: 0, firsts: 0, seconds: 0, thirds: 0, votes: 0 }]));
  for (const r of rows) {
    const t = by.get(r.entry_id);
    if (!t) continue;
    const n = Number(r.n);
    t.points += n * pointsFor(r.rank, places);
    t.votes += n;
    if (r.rank === 1) t.firsts += n;
    if (r.rank === 2) t.seconds += n;
    if (r.rank === 3) t.thirds += n;
  }
  const list = [...by.values()].sort((a, b) =>
    b.points - a.points || b.firsts - a.firsts || b.seconds - a.seconds || a.entry.number - b.entry.number);

  let place = 0;
  list.forEach((t, i) => {
    const prev = list[i - 1];
    const same = prev && prev.points === t.points && prev.firsts === t.firsts && prev.seconds === t.seconds;
    if (!same) place = i + 1;
    t.place = place;
    t.shared = false;
  });
  for (const t of list) t.shared = list.filter((o) => o.place === t.place).length > 1;
  return list;
}

export const voterCount = async (contestId) =>
  Number((await db('voter_status').where({ contest_id: contestId }).count({ n: '*' }).first()).n);
