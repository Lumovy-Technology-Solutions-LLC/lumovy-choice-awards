import bcrypt from 'bcryptjs';
import { db, nowIso } from './index.js';
import { config } from '../config.js';

/** Idempotent first-run setup: regions and the first HR admin. */
export async function bootstrap() {
  if (!(await db('regions').first())) {
    await db('regions').insert([
      { code: 'IN', name: 'India', timezone: 'Asia/Kolkata', enabled: true },
      { code: 'US', name: 'United States', timezone: 'America/New_York', enabled: false },
      { code: 'UK', name: 'United Kingdom', timezone: 'Europe/London', enabled: false },
    ]);
  }
  const admin = await db('users').where({ role: 'admin' }).first();
  if (!admin) {
    await db('users').insert({
      name: config.bootstrap.name, email: config.bootstrap.email.toLowerCase(), team: 'HR', region: 'IN', role: 'admin',
      active: true, password_hash: await bcrypt.hash(config.bootstrap.password, 11), created_at: nowIso(),
    });
    console.log(`Created first HR admin: ${config.bootstrap.email} (password from BOOTSTRAP_ADMIN_PASSWORD). Change it after first sign-in.`);
  }
}
