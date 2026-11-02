// Adds more demo contests (several open, closed/published and coming soon) to an existing demo database.
// Run: npm --prefix server run seed:more   (safe to re-run; skips if already added)
import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { bootstrap } from './bootstrap.js';
import { config } from '../config.js';
import { processUpload } from '../lib/files.js';
import { encryptReceipt } from '../lib/util.js';
import { pointsFor } from '../lib/scoring.js';

await migrate();
await bootstrap();
if (await db('contests').where({ name: 'Festive Rangoli Contest' }).first()) {
  console.log('Extra demo contests already exist; nothing to do.');
  await db.destroy();
  process.exit(0);
}

const assets = path.resolve(config.root, 'seed-assets');
const now = nowIso();
const day = 864e5;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();
const people = ['Meera Menon', 'Kiran Rao', 'Sahil Arora', 'Nandini Pillai', 'Rajat Kapoor', 'Tara Bose', 'Imran Qureshi', 'Joyce Thomas', 'Yash Verma'];
const works = [
  ['Morning ritual', 'Espresso and a quiet start to the day.'], ['Watching you', 'A curious tabby looks straight into the lens.'],
  ['Lift-off eve', 'A rocket stands ready at dusk.'], ['Deep field', 'Thousands of galaxies in one frame.'],
  ['Weekend ride', 'A red motorbike resting in the garage.'], ['Old coins', 'A collection of ancient silver coins.'],
  ['Brick pattern', 'Rhythm in a paved pathway.'], ['Grass close-up', 'The tiny world of a lawn.'], ['Moon surface', 'Craters and shadow in grey.'],
];
const voters = await db('users').where({ region: 'IN', role: 'employee' });

async function make(c, entryCount, offset = 0) {
  const [row] = await db('contests').insert({
    entry_types: '["image"]', regions: '["IN"]', places: 3, timezone: 'Asia/Kolkata', created_by: 1, created_at: now, updated_at: now, ...c,
  }).returning('id');
  const id = row.id ?? row;
  let n = 1;
  for (let i = 0; i < entryCount; i++) {
    const k = (i + offset) % works.length;
    const tmp = path.join(config.dataDir, 'tmp', `seedx-${id}-${i}.jpg`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.copyFileSync(path.join(assets, `photo${2 + k}.jpg`), tmp);
    const info = await processUpload({ tmpPath: tmp, originalName: 'x.jpg', contestId: id, allowedTypes: ['image'] });
    fs.rmSync(tmp, { force: true });
    await db('entries').insert({ contest_id: id, number: n++, type: 'image', title: works[k][0], description: works[k][1], alt_text: works[k][1], ...info, competitor_name: people[k], created_at: now, updated_at: now });
  }
  await db('contests').where({ id }).update({ next_entry_no: n });
  return id;
}

async function vote(id, count, skip = 0) {
  const entries = await db('entries').where({ contest_id: id });
  for (const u of voters.slice(skip, skip + count)) {
    const picks = [...entries].sort(() => Math.random() - 0.5).slice(0, 3).map((e, i) => ({ entryId: e.id, rank: i + 1 }));
    await db('voter_status').insert({ contest_id: id, user_id: u.id, submitted_at: new Date(Date.now() - Math.random() * 3 * day).toISOString(), receipt: encryptReceipt(u.id, picks) });
    await db('votes').insert(picks.map((p) => ({ contest_id: id, entry_id: p.entryId, rank: p.rank, points: pointsFor(p.rank, 3) })));
  }
}

const live = (name, theme, description, endsInDays, startedDaysAgo) => ({
  name, theme, description, rules: 'Original work only. One entry per person. Entries are shown without names.', status: 'live', announced: true,
  started_at: iso(-startedDaysAgo), end_at: iso(endsInDays),
});
const done = (name, theme, endedDaysAgo, published) => ({
  name, theme, description: theme, rules: 'Original work only.', status: published ? 'published' : 'closed', announced: true,
  started_at: iso(-endedDaysAgo - 8), end_at: iso(-endedDaysAgo), closed_at: iso(-endedDaysAgo), published_at: published ? iso(-endedDaysAgo + 1) : null,
});
const soon = (name, theme, description, types = '["image"]') => ({ name, theme, description, rules: 'Details will follow when voting opens.', status: 'draft', announced: true, entry_types: types });

// Open for voting
const live1 = await make(live('Festive Rangoli Contest', 'Colours of Diwali', 'Share your best rangoli or festive decoration.', 1.3, 4), 8, 1);
const live2 = await make(live('Team Moments Photo Contest', 'Us at our best', 'A photo that shows what our team is like.', 6, 1), 9, 3);
const live3 = await make(live('Poster Design Contest', 'Say it with a poster', 'Design a poster for our next company event.', 9.5, 0.4), 6, 0);
await vote(live1, 30); await vote(live2, 12, 8); await vote(live3, 4, 20);

// Voting closed, waiting for HR to publish
const closed1 = await make(done('Desk Setup Contest', 'Show us your workspace', 2, false), 7, 4);
await vote(closed1, 36);

// Published
const pub = [
  await make(done('Monsoon Memories Photography', 'Rain, roads and chai', 38, true), 8, 2),
  await make(done('Logo Redesign Contest', 'A fresh look for the Lumovy club', 66, true), 6, 5),
  await make(done('Festive Poster Contest', 'Posters for the festival season', 97, true), 9, 0),
];
for (const [i, id] of pub.entries()) await vote(id, 34 - i * 4);

// Coming soon
await db('contests').insert([
  { ...soon('Holiday Card Design', 'Greetings from Lumovy', 'Design the card we send to customers this season.'), created_by: 1, created_at: now, updated_at: now },
  { ...soon('Tech Haiku Challenge', 'Five, seven, five', 'Write a haiku about life in tech.', '["writing"]'), created_by: 1, created_at: now, updated_at: now },
  { ...soon('Office Pets Photo Contest', 'Our furry colleagues', 'Photos of the pets who keep us company.'), created_by: 1, created_at: now, updated_at: now },
]);

console.log('Added: 3 open, 1 closed (to publish), 3 published, 3 coming soon.');
await db.destroy();
