import { db, nowIso } from '../db/index.js';

// HR-controlled switches. Both default to on. Stored in the database so they survive restarts and apply to every app instance.
const KEYS = { emailNotifications: 'email_notifications', emailSignIn: 'email_signin' };

let cache = null;
let cachedAt = 0;

/** Pass `trx` when calling from inside a transaction (SQLite uses a single connection). */
export async function getFlags(trx = db) {
  if (cache && Date.now() - cachedAt < 3000) return cache;
  const rows = await trx('app_settings').select('key', 'value');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = Object.fromEntries(Object.entries(KEYS).map(([flag, key]) => [flag, stored[key] !== 'off']));
  cachedAt = Date.now();
  return cache;
}

export async function setFlag(flag, on, user) {
  const key = KEYS[flag];
  if (!key) throw new Error(`Unknown setting ${flag}`);
  await db('app_settings').insert({ key, value: on ? 'on' : 'off', updated_at: nowIso(), updated_by: user?.email ?? null })
    .onConflict('key').merge();
  cache = null;
}
