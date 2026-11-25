import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.APP_SECRET || process.env.APP_SECRET.startsWith('change-me'))) {
  throw new Error('APP_SECRET must be set to a long random value in production');
}

export const config = {
  root,
  isProd,
  port: Number(process.env.PORT || 4000),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  secret: process.env.APP_SECRET || 'dev-only-secret-not-for-production',
  databaseUrl: process.env.DATABASE_URL || '',
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './data/uploads'),
  dataDir: path.resolve(root, process.env.DATA_DIR || './data'),
  // SQLite only. "wal" is fastest and fine on a normal disk. On Azure App Service /home is network storage, where SQLite
  // recommends "delete" (set SQLITE_JOURNAL=delete). Backups are consistent copies taken while the app runs.
  sqliteJournal: process.env.SQLITE_JOURNAL === 'delete' ? 'delete' : 'wal',
  backup: { keep: Number(process.env.BACKUP_KEEP ?? 40), hours: Number(process.env.BACKUP_HOURS || 6) },
  mail: {
    transport: process.env.MAIL_TRANSPORT || 'dev',
    from: process.env.MAIL_FROM || 'Lumovy Employee Choice Awards <choice-awards@lumovy.com>',
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    secure: process.env.SMTP_SECURE === 'true',
    // MAIL_TRANSPORT=graph: send through Microsoft Graph as one Microsoft 365 mailbox (no mailbox password; an Entra app
    // that is only allowed to send as that mailbox). GRAPH_SENDER is that mailbox; it must match the address in MAIL_FROM.
    graph: {
      tenantId: process.env.GRAPH_TENANT_ID || '',
      clientId: process.env.GRAPH_CLIENT_ID || '',
      clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
      sender: process.env.GRAPH_SENDER || '',
    },
    // Providers cap how fast one sender may send (Azure Communication Services: a few a minute on the free Azure address,
    // about 30 a minute and 100 an hour on a verified own domain). The queue sends in small batches within these caps and
    // carries on after each reset until everyone has been emailed. 0 = no cap of our own (the provider's limit still applies).
    maxPerMinute: Number(process.env.MAIL_MAX_PER_MINUTE ?? 20),
    maxPerHour: Number(process.env.MAIL_MAX_PER_HOUR ?? 0),
    replyTo: process.env.MAIL_REPLY_TO || '',
  },
  bootstrap: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'hr@lumovy.com',
    name: process.env.BOOTSTRAP_ADMIN_NAME || 'HR Admin',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe!123',
  },
  otpTtlMinutes: 10,
  sessionHours: 12,
  maxUploadMb: 100,
};
