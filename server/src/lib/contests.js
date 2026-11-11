import { db, nowIso, parseJson } from '../db/index.js';
import { backupNow } from './backup.js';
import { audit } from './audit.js';
import { tally, voterCount } from './scoring.js';
import { entryLabel, formatDeadline, utcIsoToLocal, notFound } from './util.js';

export const STATUS_LABEL = {
  draft: 'Coming soon', live: 'Voting open', closed: 'Voting closed', published: 'Winners announced',
};

export function hydrate(c) {
  if (!c) return c;
  return { ...c, entry_types: parseJson(c.entry_types, ['image']), regions: parseJson(c.regions, ['IN']), announced: !!c.announced, is_global: !!c.is_global };
}

export async function getContest(id, { fresh = true } = {}) {
  const row = await db('contests').where({ id: Number(id) }).first();
  if (!row) throw notFound('Contest not found');
  let c = hydrate(row);
  if (fresh && c.status === 'live' && c.end_at && new Date(c.end_at).getTime() <= Date.now()) {
    await closeContest(c.id);
    c = hydrate(await db('contests').where({ id: c.id }).first());
  }
  return c;
}

/** Hard close: the moment the end time passes, voting stops and unsent drafts are discarded. */
export async function closeContest(id) {
  const n = await db('contests').where({ id, status: 'live' }).update({ status: 'closed', closed_at: nowIso(), updated_at: nowIso() });
  if (!n) return false;
  await db('ballot_drafts').where({ contest_id: id }).del();
  await audit(null, 'Voting closed automatically', id);
  backupNow().catch(() => {}); // safe copy of the final votes (SQLite only)
  return true;
}

export async function closeDueContests() {
  const due = await db('contests').where({ status: 'live' }).where('end_at', '<=', nowIso()).select('id');
  for (const d of due) await closeContest(d.id);
  return due.length;
}

// Region cache: names for labels and which regions are switched on (a global contest covers those).
let regionCache = { names: {}, enabled: new Set() };
export async function refreshRegions() {
  const rows = await db('regions');
  regionCache = { names: Object.fromEntries(rows.map((r) => [r.code, r.name])), enabled: new Set(rows.filter((r) => r.enabled).map((r) => r.code)) };
}
/** Regions whose employees take part (vote + get emails). Everyone can still SEE the contest. */
export const participantRegions = (c) => (c.is_global ? [...regionCache.enabled] : c.regions);
export const participates = (region, c) => participantRegions(c).includes(region);
export const scopeOf = (c) => (c.is_global ? 'global' : c.regions.length > 1 ? 'selected' : 'regional');
export const regionLabel = (c) => (c.is_global ? 'All regions' : c.regions.map((r) => regionCache.names[r] || r).join(', '));

export const isEligible = (user, c) => !!user && user.active && participates(user.region, c);

export async function regionRecipients(c) {
  const users = await db('users').where({ active: true }).whereIn('region', participantRegions(c)).select('id', 'name', 'email', 'region');
  return users;
}

export function contestShape(c, extra = {}) {
  return {
    id: c.id, name: c.name, theme: c.theme, description: c.description, rules: c.rules,
    bannerUrl: c.banner_file ? `/api/files/banners/${c.id}` : null,
    entryTypes: c.entry_types, regions: c.regions, isGlobal: c.is_global, scope: scopeOf(c), regionLabel: regionLabel(c), places: c.places,
    status: c.status, statusLabel: STATUS_LABEL[c.status], announced: c.announced,
    timezone: c.timezone, endAt: c.end_at, endLocal: utcIsoToLocal(c.end_at, c.timezone),
    deadlineLabel: formatDeadline(c.end_at, c.timezone),
    startedAt: c.started_at, closedAt: c.closed_at, publishedAt: c.published_at,
    copiedFrom: c.copied_from, createdAt: c.created_at,
    ...extra,
  };
}

export function entryShape(e, { reveal = false, admin = false } = {}) {
  const base = {
    id: e.id, number: e.number, label: entryLabel(e.number), type: e.type,
    title: e.title, description: e.description, altText: e.alt_text || '',
    url: e.file_key ? `/api/files/entries/${e.id}` : null,
    thumbUrl: e.thumb_key ? `/api/files/entries/${e.id}?thumb=1` : null,
    pageCount: e.page_count || null,
    fileName: e.file_key ? `${entryLabel(e.number)}${e.ext || ''}` : null,
    body: e.type === 'writing' ? e.body || '' : undefined,
  };
  if (e.type === 'writing') base.excerpt = (e.body || '').replace(/\s+/g, ' ').slice(0, 220);
  if (reveal || admin) base.competitorName = e.competitor_name;
  if (admin) { base.size = e.size; base.complete = isComplete(e); }
  return base;
}

export const isComplete = (e) =>
  !!e.title?.trim() && !!e.description?.trim() && (e.type === 'writing' ? !!e.body?.trim() : !!e.file_key);

export async function resultsPayload(c) {
  const list = await tally(c.id);
  const rows = list.map((t) => ({
    ...entryShape(t.entry, { reveal: true }),
    points: t.points, firsts: t.firsts, seconds: t.seconds, thirds: t.thirds, place: t.place, shared: t.shared,
  }));
  return {
    contest: contestShape(c),
    totalVoters: await voterCount(c.id),
    winners: rows.filter((r) => r.place <= 3 && r.points > 0),
    others: rows.filter((r) => !(r.place <= 3 && r.points > 0)),
  };
}

export const placeLabel = (p) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[p] || `${p}th`);
