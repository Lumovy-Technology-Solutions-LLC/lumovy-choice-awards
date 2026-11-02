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
  mail: {
    transport: process.env.MAIL_TRANSPORT || 'dev',
    from: process.env.MAIL_FROM || 'Lumovy Choice Awards <choice-awards@lumovy.com>',
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    secure: process.env.SMTP_SECURE === 'true',
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
