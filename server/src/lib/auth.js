import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from './util.js';

const COOKIE = 'lcw_session';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.secret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}
export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd });
}

export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, team: u.team, region: u.region,
  role: u.role, hasPassword: !!u.password_hash,
});

/** Loads req.user if a valid session cookie is present (does not reject). */
export async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const { sub } = jwt.verify(token, config.secret);
      const u = await db('users').where({ id: sub }).first();
      if (u && u.active) req.user = u;
    }
  } catch { /* invalid/expired token => anonymous */ }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', 'auth_required'));
  next();
}
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', 'auth_required'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'HR admin access is needed for this.', 'admin_required'));
  next();
}
