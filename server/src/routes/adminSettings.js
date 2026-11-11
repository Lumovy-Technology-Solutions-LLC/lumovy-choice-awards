import { Router } from 'express';
import { z } from 'zod';
import { db, dialect, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { getFlags, setFlag } from '../lib/settings.js';
import { backupNow, backupDir, backupsEnabled, listBackups } from '../lib/backup.js';
import { bad, wrap } from '../lib/util.js';

const r = Router();

async function payload() {
  const flags = await getFlags();
  const noPassword = await db('users').where({ active: true }).whereNull('password_hash').count({ n: '*' }).first();
  const failed = await db('outbox').where({ status: 'failed' }).where('created_at', '>', new Date(Date.now() - 24 * 3600_000).toISOString()).count({ n: '*' }).first();
  return {
    ...flags,
    transport: config.mail.transport,
    from: config.mail.from,
    usersWithoutPassword: Number(noPassword.n),
    failedEmails24h: Number(failed.n),
    database: dialect === 'pg' ? 'postgres' : 'sqlite',
    backups: backupsEnabled ? { dir: backupDir, count: listBackups().length, last: listBackups()[0]?.at ?? null, everyHours: config.backup.hours } : null,
  };
}

r.get('/settings', wrap(async (_req, res) => res.json(await payload())));

r.put('/settings', wrap(async (req, res) => {
  const b = z.object({ emailNotifications: z.boolean().optional(), emailSignIn: z.boolean().optional() }).parse(req.body);
  const before = await getFlags();
  const LABEL = { emailNotifications: 'Email notifications', emailSignIn: 'Email sign-in codes' };
  for (const flag of Object.keys(LABEL)) {
    if (b[flag] === undefined || b[flag] === before[flag]) continue;
    await setFlag(flag, b[flag], req.user);
    // Switching off also drops anything still waiting, so stale emails never go out later.
    if (!b[flag]) {
      const q = db('outbox').where({ status: 'queued' });
      if (flag === 'emailSignIn') q.where({ kind: 'otp' }); else q.whereNot({ kind: 'otp' });
      await q.update({ status: 'cancelled', error: `${LABEL[flag]} were switched off by HR`, sent_at: nowIso() });
    }
    await audit(req.user, `${LABEL[flag]} switched ${b[flag] ? 'on' : 'off'}`);
  }
  res.json(await payload());
}));

// SQLite only: take a consistent copy of the database now (also runs automatically).
r.post('/backup', wrap(async (req, res) => {
  if (!backupsEnabled) throw bad('Backups are only needed with the built-in database. PostgreSQL keeps its own backups.');
  await backupNow();
  await audit(req.user, 'Database backup taken');
  res.json(await payload());
}));

export default r;
