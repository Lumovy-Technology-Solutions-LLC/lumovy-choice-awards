import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import { getFlags } from './settings.js';

// ---------- default templates (HR can edit wording per contest) ----------
export const TEMPLATE_META = {
  contest_started: {
    label: 'Contest started',
    sentTo: 'Everyone in the contest’s region(s)',
    when: 'When HR clicks Start contest',
    tokens: ['name', 'contest_name', 'theme', 'deadline', 'vote_link'],
    subject: 'Voting is open: {{contest_name}}',
    body: `Hi {{name}},

Voting is now open for {{contest_name}}.

Theme: {{theme}}

Pick your top 3 entries. It takes about 2 minutes, on your laptop or phone. Voting closes on {{deadline}}.

{{vote_link}}

Entries are shown without the names of the people who made them, so please vote for the work.`,
  },
  vote_confirmation: {
    label: 'Your vote is in',
    sentTo: 'The employee who just voted',
    when: 'Right after they submit',
    tokens: ['name', 'contest_name', 'picks'],
    subject: 'Your vote is in: {{contest_name}}',
    body: `Hi {{name}},

Thanks, your vote for {{contest_name}} is in. Here are your picks:

{{picks}}

Votes cannot be changed once submitted.`,
  },
  results_declared: {
    label: 'Results declared',
    sentTo: 'Everyone in the contest’s region(s)',
    when: 'When HR publishes the results',
    tokens: ['name', 'contest_name', 'winners', 'results_link'],
    subject: 'Results are in: {{contest_name}}',
    body: `Hi {{name}},

The results for {{contest_name}} are out. Congratulations to our winners!

{{winners}}

{{results_link}}`,
  },
  reminder: {
    label: 'Reminder to vote (optional)',
    sentTo: 'People in the region who have not voted yet',
    when: 'When HR chooses to send it',
    tokens: ['name', 'contest_name', 'deadline', 'vote_link'],
    subject: 'Reminder: vote in {{contest_name}} before {{deadline}}',
    body: `Hi {{name}},

A quick reminder: you have not voted in {{contest_name}} yet. Voting closes on {{deadline}}.

{{vote_link}}`,
  },
  deadline_extended: {
    label: 'Deadline extended (optional)',
    sentTo: 'Everyone in the contest’s region(s)',
    when: 'When HR extends the end time',
    tokens: ['name', 'contest_name', 'deadline', 'vote_link'],
    subject: 'More time to vote: {{contest_name}}',
    body: `Hi {{name}},

Good news: voting for {{contest_name}} has been extended. It now closes on {{deadline}}.

{{vote_link}}`,
  },
};
export const TEMPLATE_KEYS = Object.keys(TEMPLATE_META);

export async function getTemplate(contestId, key, trx = db) {
  const row =
    (contestId && (await trx('email_templates').where({ contest_id: contestId, key }).first())) ||
    (await trx('email_templates').whereNull('contest_id').where({ key }).first());
  if (row) return { subject: row.subject, body: row.body, custom: row.contest_id != null };
  const m = TEMPLATE_META[key];
  return { subject: m.subject, body: m.body, custom: false };
}

// ---------- rendering ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const html = (h) => ({ __html: h });
const button = (label, url) =>
  `<a href="${esc(url)}" style="display:inline-block;background:#FF7A2F;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 26px;border-radius:999px;font-size:15px">${esc(label)}</a>`;

function fill(str, vars, asHtml) {
  return String(str).replace(/{{\s*(\w+)\s*}}/g, (_, k) => {
    const v = vars[k];
    if (v == null) return '';
    if (typeof v === 'object' && v.__html != null) return asHtml ? v.__html : (v.text ?? '');
    return asHtml ? esc(v) : String(v);
  });
}

export function renderEmail(tpl, vars) {
  const subject = fill(tpl.subject, vars, false).replace(/\s+/g, ' ').trim();
  const paras = tpl.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const inner = paras.map((p) => {
    const only = /^{{\s*(\w+)\s*}}$/.exec(p);
    if (only && vars[only[1]]?.__html != null) return `<div style="margin:0 0 18px">${vars[only[1]].__html}</div>`;
    return `<p style="margin:0 0 16px;line-height:1.6">${fill(p, vars, true).replace(/\n/g, '<br>')}</p>`;
  }).join('');
  const text = paras.map((p) => fill(p, vars, false)).join('\n\n');
  return { subject, html: layout(inner, subject), text };
}

function layout(inner, preheader) {
  return `<!doctype html><html><body style="margin:0;background:#EEF1FA;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#141743">
<span style="display:none">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(150deg,#2D31C4,#161A7A);padding:22px 28px;color:#fff"><span style="font-size:22px;font-weight:700;letter-spacing:-.01em">Lumovy</span> <span style="opacity:.8;font-size:14px">Choice Awards</span></td></tr>
<tr><td style="padding:28px;font-size:15px">${inner}</td></tr>
<tr><td style="padding:16px 28px;background:#F6F7FD;color:#6B6F99;font-size:12px">Lumovy Technology Solutions · Employee Choice Awards. This is an automated message.</td></tr>
</table></td></tr></table></body></html>`;
}

export const voteButton = (contestId) => ({ __html: button('Vote now', `${config.appUrl}/contests/${contestId}`), text: `${config.appUrl}/contests/${contestId}` });
export const resultsButton = (contestId) => ({ __html: button('See the full results', `${config.appUrl}/contests/${contestId}/results`), text: `${config.appUrl}/contests/${contestId}/results` });
export const listBlock = (items) => ({
  __html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((i) =>
    `<tr><td style="padding:10px 14px;background:#F6F7FD;border-radius:12px;border-bottom:6px solid #fff"><b>${esc(i.label)}</b>: ${esc(i.title)}<br><span style="color:#6B6F99;font-size:13px">${esc(i.sub || '')}</span></td></tr>`).join('')}</table>`,
  text: items.map((i) => `${i.label}: ${i.title}${i.sub ? ` (${i.sub})` : ''}`).join('\n'),
});

// ---------- queue ----------
export async function queue(rows, trx = db) {
  // HR can switch email off in Settings: sign-in codes and notifications are separate switches. Skipped emails are not stored.
  const flags = await getFlags(trx);
  rows = rows.filter((r) => (r.kind === 'otp' ? flags.emailSignIn : flags.emailNotifications));
  if (!rows.length) return 0;
  const created_at = nowIso();
  await trx.batchInsert('outbox', rows.map((r) => ({
    contest_id: r.contestId ?? null, kind: r.kind, to_email: r.to, to_name: r.toName ?? '',
    subject: r.subject, html: r.html, text: r.text ?? '', status: 'queued', attempts: 0, created_at,
  })), 50);
  return rows.length;
}

/** Render a template once per recipient and queue it. */
export async function queueTemplated({ contest, key, recipients, vars = () => ({}), trx = db }) {
  const tpl = await getTemplate(contest?.id, key, trx);
  const rows = recipients.map((u) => {
    const r = renderEmail(tpl, { name: u.name, ...vars(u) });
    return { contestId: contest?.id, kind: key, to: u.email, toName: u.name, ...r };
  });
  return queue(rows, trx);
}

// ---------- delivery ----------
let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host, port: config.mail.port, secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      pool: true, maxConnections: 2, maxMessages: 100,
    });
  }
  return transporter;
}

/** Tests only: replace the SMTP connection. */
export const setTransporterForTests = (t) => { transporter = t; };
export const resetPauseForTests = () => { pausedUntil = 0; pauseMs = 0; notBefore.clear(); };

const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// ---- pacing ----
// The provider answers "450 4.5.127 Excessive message rate" when a sender goes too fast. We never get that far:
// bulk mail is sent a few at a time inside a per-minute (and optional per-hour) cap. If the provider still pushes back,
// the rate-limited emails go back in the queue untouched (no failed attempt) and sending pauses, then resumes by itself.
const PAUSE_START_MS = 2 * 60_000;
const PAUSE_MAX_MS = 15 * 60_000;
let pausedUntil = 0; let pauseMs = 0;
const notBefore = new Map(); // outbox id -> earliest time to try again

export const isRateLimit = (e) => {
  const code = Number(e?.responseCode);
  return [421, 450, 451, 452].includes(code) || /rate|throttl|too many|excessive|quota|limit/i.test(`${e?.response || ''} ${e?.message || ''}`);
};
const isPermanent = (e) => { const c = Number(e?.responseCode); return c >= 500 && c < 600 && !isRateLimit(e); };

const BULK_FIRST = "case kind when 'otp' then 0 when 'vote_confirmation' then 1 else 2 end";
async function sentSince(ms) {
  const row = await db('outbox').where({ status: 'sent' }).where('sent_at', '>', new Date(Date.now() - ms).toISOString()).count({ n: '*' }).first();
  return Number(row.n);
}
/** How many bulk emails may go out right now. */
async function bulkBudget() {
  if (Date.now() < pausedUntil) return 0;
  let n = Infinity;
  const { maxPerMinute, maxPerHour } = config.mail;
  if (maxPerMinute > 0) n = Math.min(n, maxPerMinute - (await sentSince(60_000)));
  if (maxPerHour > 0) n = Math.min(n, maxPerHour - (await sentSince(3_600_000)));
  return Math.max(0, n);
}

export async function processOutbox(limit = 25) {
  // Safe with several app instances: rows are claimed atomically, and only the claimed rows are sent.
  const now = nowIso();
  await db('outbox').where({ status: 'sending' }).where('claimed_at', '<', new Date(Date.now() - 5 * 60_000).toISOString()).update({ status: 'queued', claimed_by: null }); // crashed worker
  const t = Date.now();
  // Sign-in codes first, then vote confirmations, then bulk mail, so a company-wide send never delays someone trying to log in.
  const queued = (await db('outbox').where({ status: 'queued' }).orderByRaw(`${BULK_FIRST}, id`).limit(limit * 4).select('id', 'kind'))
    .filter((r) => !(notBefore.get(r.id) > t));
  const urgent = queued.filter((r) => r.kind === 'otp');
  const bulk = queued.filter((r) => r.kind !== 'otp').slice(0, Math.min(limit, await bulkBudget()));
  const ids = [...urgent, ...bulk].map((r) => r.id);
  if (!ids.length) return 0;
  await db('outbox').whereIn('id', ids).where({ status: 'queued' }).update({ status: 'sending', claimed_by: WORKER_ID, claimed_at: now });
  const batch = (await db('outbox').whereIn('id', ids).where({ status: 'sending', claimed_by: WORKER_ID })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (!batch.length) return 0;
  const release = (rows, extra = {}) => db('outbox').whereIn('id', rows.map((r) => r.id)).update({ status: 'queued', claimed_by: null, ...extra });
  let done = 0;
  for (let i = 0; i < batch.length; i++) {
    const m = batch[i];
    try {
      if (config.mail.transport === 'smtp') {
        await getTransporter().sendMail({
          from: config.mail.from, to: m.to_name ? `"${m.to_name.replace(/"/g, '')}" <${m.to_email}>` : m.to_email,
          subject: m.subject, html: m.html, text: m.text,
          ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
          // Marks this as a system message so mail servers and out-of-office replies treat it as such.
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
        });
        await db('outbox').where({ id: m.id }).update({ status: 'sent', sent_at: nowIso(), attempts: m.attempts + 1, error: null });
        pauseMs = 0;
      } else {
        await db('outbox').where({ id: m.id }).update({ status: 'captured', sent_at: nowIso(), attempts: m.attempts + 1 });
      }
      done++;
    } catch (e) {
      const msg = String(e.message).slice(0, 500);
      if (isRateLimit(e)) {
        // Too fast: nothing is lost. Put this and the rest of the batch back, wait, and carry on later.
        pauseMs = Math.min(PAUSE_MAX_MS, pauseMs ? pauseMs * 2 : PAUSE_START_MS);
        pausedUntil = Date.now() + pauseMs;
        const rest = batch.slice(i);
        rest.forEach((r) => notBefore.set(r.id, r.kind === 'otp' ? Date.now() + 15_000 : 0));
        await release(rest);
        await db('outbox').where({ id: m.id }).update({ error: `Waiting: ${msg}` });
        console.warn(`Mail provider says we are sending too fast. Pausing bulk mail for ${Math.round(pauseMs / 60000)} min; ${rest.length} emails stay queued.`);
        return 0;
      }
      const attempts = isPermanent(e) ? 3 : m.attempts + 1; // a permanent refusal (bad address) will not improve with retries
      if (attempts < 3) notBefore.set(m.id, Date.now() + 60_000);
      await db('outbox').where({ id: m.id }).update({ status: attempts >= 3 ? 'failed' : 'queued', claimed_by: null, attempts, error: msg });
      done++;
    }
  }
  return done;
}

export function startMailWorker() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { while ((await processOutbox()) > 0); } catch (e) { console.error('mail worker', e); } finally { running = false; }
  }, 2000).unref();
}
