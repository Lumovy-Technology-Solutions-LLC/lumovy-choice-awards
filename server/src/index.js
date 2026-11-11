import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db, nowIso } from './db/index.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { loadUser, requireAdmin } from './lib/auth.js';
import { closeDueContests, refreshRegions } from './lib/contests.js';
import { startMailWorker } from './lib/mail.js';
import { startBackups } from './lib/backup.js';
import authRoutes from './routes/auth.js';
import portalRoutes from './routes/portal.js';
import fileRoutes from './routes/files.js';
import adminContests from './routes/adminContests.js';
import adminUsers from './routes/adminUsers.js';
import adminReports from './routes/adminReports.js';
import adminSettings from './routes/adminSettings.js';

await migrate();
await bootstrap();
await refreshRegions();
setInterval(() => refreshRegions().catch(() => {}), 30_000).unref();

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/api/health', async (_req, res) => {
  await db.raw('select 1');
  res.json({ ok: true, time: nowIso() });
});
app.use('/api/auth', authRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', requireAdmin, adminContests, adminUsers, adminReports, adminSettings);

// Dev only: read the "emails" captured instead of sent, so sign-in codes can be tested without SMTP.
if (config.mail.transport === 'dev' && !config.isProd) {
  app.get('/api/dev/mailbox', async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    const rows = await db('outbox').modify((q) => email && q.where({ to_email: email })).orderBy('id', 'desc').limit(10).select('id', 'kind', 'to_email', 'subject', 'text', 'created_at');
    res.json({ items: rows });
  });
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app when present (production)
const dist = path.resolve(config.root, '../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message || 'Please check the form.', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `That file is too large (limit ${config.maxUploadMb} MB).` });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// Voting opens when HR clicks Start, and closes on its own at the end time.
setInterval(() => closeDueContests().catch((e) => console.error('close job', e)), 5000).unref();
startMailWorker();
startBackups();

app.listen(config.port, () => console.log(`Lumovy Choice Awards API on http://localhost:${config.port} (db: ${db.client.config.client}, mail: ${config.mail.transport})`));
