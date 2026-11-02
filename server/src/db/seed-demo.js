// Demo data for trying the portal: employees, one published contest, one live contest, one upcoming.
// Run: npm run seed:demo   (safe to re-run; it only seeds an empty database)
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { bootstrap } from './bootstrap.js';
import { config } from '../config.js';
import { processUpload } from '../lib/files.js';
import { encryptReceipt, localToUtcIso } from '../lib/util.js';
import { pointsFor } from '../lib/scoring.js';

await migrate();
await bootstrap();
if ((await db('contests').first())) {
  console.log('Database already has contests; skipping demo seed.');
  await db.destroy();
  process.exit(0);
}

const assets = path.resolve(config.root, 'seed-assets');
const first = ['Asha', 'Rahul', 'Priya', 'Vikram', 'Neha', 'Arjun', 'Divya', 'Karthik', 'Meera', 'Sanjay', 'Ananya', 'Rohan', 'Isha', 'Aditya', 'Pooja', 'Nikhil', 'Sneha', 'Varun', 'Kavya', 'Manish', 'Lakshmi', 'Gaurav', 'Swati', 'Harsh'];
const last = ['Rao', 'Sharma', 'Iyer', 'Nair', 'Gupta', 'Reddy', 'Menon', 'Patel', 'Das', 'Singh'];
const teams = ['Engineering', 'Design', 'Sales', 'Finance', 'Operations', 'Support', 'People & Culture'];
const pw = await bcrypt.hash('Employee!1234', 10);
const now = nowIso();

const users = [];
for (let i = 0; i < 48; i++) {
  const name = `${first[i % first.length]} ${last[(i * 3 + Math.floor(i / first.length)) % last.length]}`;
  users.push({ name, email: `${name.toLowerCase().replace(/ /g, '.')}${i >= 24 ? i : ''}@lumovy.com`, team: teams[i % teams.length], region: 'IN', role: 'employee', active: true, password_hash: i === 0 ? pw : null, created_at: now });
}
users.push({ name: 'Tom Becker', email: 'tom.becker@lumovy.com', team: 'Sales', region: 'US', role: 'employee', active: true, password_hash: null, created_at: now });
await db.batchInsert('users', users, 25);
const voters = await db('users').where({ region: 'IN', role: 'employee' });

const photos = [
  ['Morning ritual', 'Espresso and a quiet start to the day.', 'A red cup of espresso on a wooden table'],
  ['Watching you', 'A curious tabby looks straight into the lens.', 'Close-up of a tabby cat with green eyes'],
  ['Lift-off eve', 'A rocket stands ready at dusk.', 'A rocket on a launch pad at dusk'],
  ['Deep field', 'Thousands of galaxies in one frame.', 'Galaxies scattered across a dark sky'],
  ['Weekend ride', 'A red motorbike resting in the garage.', 'A red motorcycle parked in a garage'],
  ['Old coins', 'A collection of ancient silver coins.', 'Rows of ancient coins'],
  ['Brick pattern', 'Rhythm in a paved pathway.', 'Grey brick pavers in a pattern'],
  ['Grass close-up', 'The tiny world of a lawn.', 'Close-up of grass in grey tones'],
  ['Moon surface', 'Craters and shadow in grey.', 'A grey lunar surface with craters'],
];
const people = ['Meera Menon', 'Kiran Rao', 'Sahil Arora', 'Nandini Pillai', 'Rajat Kapoor', 'Tara Bose', 'Imran Qureshi', 'Joyce Thomas', 'Yash Verma'];

async function makeContest(c, entryCount, offset = 0) {
  const [row] = await db('contests').insert({ ...c, entry_types: '["image"]', regions: '["IN"]', created_by: 1, created_at: now, updated_at: now }).returning('id');
  const id = row.id ?? row;
  let n = 1;
  for (let i = 0; i < entryCount; i++) {
    const [title, description, alt] = photos[(i + offset) % photos.length];
    const tmp = path.join(config.dataDir, 'tmp', `seed-${id}-${i}.jpg`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.copyFileSync(path.join(assets, `photo${2 + ((i + offset) % 9)}.jpg`), tmp);
    const info = await processUpload({ tmpPath: tmp, originalName: 'x.jpg', contestId: id, allowedTypes: ['image'] });
    fs.rmSync(tmp, { force: true });
    await db('entries').insert({ contest_id: id, number: n++, type: 'image', title, description, alt_text: alt, ...info, competitor_name: people[(i + offset) % people.length], created_at: now, updated_at: now });
  }
  await db('contests').where({ id }).update({ next_entry_no: n });
  return id;
}

async function castVotes(id, count, bias) {
  const entries = await db('entries').where({ contest_id: id });
  const places = 3;
  for (const u of voters.slice(0, count)) {
    const pool = [...entries].sort(() => Math.random() - 0.5 + (bias ? 0 : 0));
    const picks = (Math.random() < 0.55 ? [bias[0], bias[1], bias[2], ...pool].map((i) => (typeof i === 'number' ? entries[i % entries.length] : i)) : pool)
      .filter((e, i, a) => a.indexOf(e) === i).slice(0, 3).map((e, i) => ({ entryId: e.id, rank: i + 1 }));
    await db('voter_status').insert({ contest_id: id, user_id: u.id, submitted_at: new Date(Date.now() - Math.random() * 2 * 864e5).toISOString(), receipt: encryptReceipt(u.id, picks) });
    await db('votes').insert(picks.map((p) => ({ contest_id: id, entry_id: p.entryId, rank: p.rank, points: pointsFor(p.rank, places) })));
  }
}

const past = await makeContest({
  name: 'Poster Contest', theme: 'Our values, in one picture', description: 'Design a poster that shows a Lumovy value.', rules: 'One entry per person. Original work only.',
  status: 'published', timezone: 'Asia/Kolkata', started_at: new Date(Date.now() - 40 * 864e5).toISOString(), end_at: new Date(Date.now() - 33 * 864e5).toISOString(),
  closed_at: new Date(Date.now() - 33 * 864e5).toISOString(), published_at: new Date(Date.now() - 32 * 864e5).toISOString(),
}, 7, 2);
await castVotes(past, 38, [0, 2, 4]);

const live = await makeContest({
  name: 'Photography Contest', theme: 'A day at work, through your lens', description: 'Share a photo that captures a moment from your working day. The best three picks win the Employee Choice Award.',
  rules: 'Photos must be your own work. One entry per person. Entries are shown without names.', status: 'live', announced: true, timezone: 'Asia/Kolkata',
  started_at: new Date(Date.now() - 2 * 864e5).toISOString(), end_at: new Date(Date.now() + 3 * 864e5 + 5 * 36e5).toISOString(),
}, 9);
await castVotes(live, 21, [1, 4, 7]);

await db('contests').insert({
  name: 'Writing Contest', theme: 'A short story in 500 words', description: 'Write a short piece of fiction or reflection.', rules: 'Maximum 500 words.',
  entry_types: '["writing","document"]', regions: '["IN"]', status: 'draft', announced: true, timezone: 'Asia/Kolkata', created_by: 1, created_at: now, updated_at: now,
});

console.log(`Demo data ready.
  HR admin:  ${config.bootstrap.email} / ${config.bootstrap.password}
  Employee:  ${users[0].email} / Employee!1234   (others sign in with an email code; read it in Admin > Outbox or /api/dev/mailbox)`);
await db.destroy();
