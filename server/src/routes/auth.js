import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { issueSession, clearSession, publicUser, requireAuth } from '../lib/auth.js';
import { queue } from '../lib/mail.js';
import { wrap, bad, normEmail, sha256, randomCode, HttpError } from '../lib/util.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProd ? 30 : 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

const GENERIC_FAIL = 'That email or password is not right, or you are not on the eligible list. Check with HR if you think this is a mistake.';

// ---- one-time code ----
r.post('/otp/request', limiter, wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().min(3) }).parse(req.body);
  const e = normEmail(email);
  const user = await db('users').where({ email: e }).first();
  // Same answer whether or not the email is eligible, so the list cannot be probed.
  if (user && user.active) {
    const recent = await db('otp_codes').where({ email: e }).where('created_at', '>', new Date(Date.now() - 60_000).toISOString()).first();
    if (!recent) {
      const code = randomCode();
      await db('otp_codes').where({ email: e, used: false }).update({ used: true });
      await db('otp_codes').insert({ email: e, code_hash: sha256(`${e}:${code}:${config.secret}`), expires_at: new Date(Date.now() + config.otpTtlMinutes * 60_000).toISOString(), created_at: nowIso() });
      await queue([{
        kind: 'otp', to: user.email, toName: user.name, subject: `Your Lumovy sign-in code: ${code}`,
        text: `Your sign-in code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`,
        html: `<div style="font-family:Poppins,Arial,sans-serif;padding:24px"><p>Hi ${user.name.replace(/[<>&]/g, '')},</p><p>Your Lumovy Choice Awards sign-in code is</p><p style="font-size:32px;font-weight:700;letter-spacing:.3em;color:#2D31C4">${code}</p><p style="color:#6B6F99">It expires in ${config.otpTtlMinutes} minutes. If you did not ask for it, ignore this email.</p></div>`,
      }]);
    }
  }
  res.json({ ok: true, message: 'If that email is on the eligible list, we have sent a 6-digit code.', devMailbox: config.mail.transport === 'dev' && !config.isProd });
}));

r.post('/otp/verify', limiter, wrap(async (req, res) => {
  const { email, code } = z.object({ email: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(req.body);
  const e = normEmail(email);
  const otp = await db('otp_codes').where({ email: e, used: false }).orderBy('id', 'desc').first();
  const fail = new HttpError(401, 'That code is not right or has expired. Request a new one.');
  if (!otp || new Date(otp.expires_at) < new Date() || otp.attempts >= 5) throw fail;
  if (otp.code_hash !== sha256(`${e}:${code}:${config.secret}`)) {
    await db('otp_codes').where({ id: otp.id }).increment('attempts', 1);
    throw fail;
  }
  const user = await db('users').where({ email: e }).first();
  if (!user || !user.active) throw fail;
  await db('otp_codes').where({ id: otp.id }).update({ used: true });
  await db('users').where({ id: user.id }).update({ last_login_at: nowIso() });
  issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

// ---- password ----
r.post('/login', limiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string(), password: z.string().min(1) }).parse(req.body);
  const user = await db('users').where({ email: normEmail(email) }).first();
  const fail = new HttpError(401, GENERIC_FAIL);
  if (!user || !user.active || !user.password_hash) { await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'); throw fail; }
  if (user.locked_until && new Date(user.locked_until) > new Date())
    throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes, or sign in with an email code.');
  if (!(await bcrypt.compare(password, user.password_hash))) {
    const n = user.failed_logins + 1;
    await db('users').where({ id: user.id }).update(n >= 5
      ? { failed_logins: 0, locked_until: new Date(Date.now() + 10 * 60_000).toISOString() } : { failed_logins: n });
    throw fail;
  }
  await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: nowIso() });
  issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });

r.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null, mailMode: config.mail.transport, serverTime: nowIso() });
});

r.post('/password', requireAuth, limiter, wrap(async (req, res) => {
  const { current, password } = z.object({ current: z.string().optional(), password: z.string() }).parse(req.body);
  if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) throw bad('Use at least 10 characters, with letters and numbers.');
  if (req.user.password_hash && !(await bcrypt.compare(current || '', req.user.password_hash))) throw new HttpError(401, 'Your current password is not right.');
  await db('users').where({ id: req.user.id }).update({ password_hash: await bcrypt.hash(password, 11) });
  res.json({ ok: true });
}));

export default r;
