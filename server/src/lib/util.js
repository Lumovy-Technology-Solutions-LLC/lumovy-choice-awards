import crypto from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const forbidden = (msg = 'You do not have access to this.', code) => new HttpError(403, msg, code);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg, code) => new HttpError(409, msg, code);

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export const pad2 = (n) => String(n).padStart(2, '0');
export const entryLabel = (n) => `Entry ${pad2(n)}`;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// ----- vote receipts: encrypted so only the voter (via their own session) can read their picks -----
function receiptKey(userId) {
  return crypto.createHmac('sha256', config.secret).update(`receipt:${userId}`).digest();
}
export function encryptReceipt(userId, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', receiptKey(userId), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decryptReceipt(userId, blob) {
  if (!blob) return null;
  try {
    const b = Buffer.from(blob, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', receiptKey(userId), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

// ----- time zones (store UTC, interpret HR input in the contest's zone) -----
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
/** '2026-11-20T18:00' in tz -> ISO UTC string */
export function localToUtcIso(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) throw bad('Please enter a valid date and time.');
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz);
  return new Date(t).toISOString();
}
/** ISO UTC -> '2026-11-20T18:00' wall clock in tz */
export function utcIsoToLocal(iso, tz) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const d = new Date(t + tzOffsetMs(t, tz));
  return d.toISOString().slice(0, 16);
}
export function formatDeadline(iso, tz) {
  if (!iso) return '';
  const s = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
  const abbr = tz === 'Asia/Kolkata' ? 'IST' : tz;
  return `${s} ${abbr}`;
}
