import { db, nowIso } from '../db/index.js';

/** Every admin action is logged with who did it and when. */
export async function audit(user, action, contestId = null, detail = {}, trx = db) {
  await trx('audit_log').insert({
    actor_id: user?.id ?? null,
    actor_name: user?.name ?? 'System',
    contest_id: contestId,
    action,
    detail: JSON.stringify(detail),
    at: nowIso(),
  });
}
