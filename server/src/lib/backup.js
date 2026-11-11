import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { sqliteFile } from '../db/index.js';

// Consistent copies of the SQLite database, taken while the app is running (SQLite's online backup).
// Stored next to the database (/home/data/backups on Azure). Not used with PostgreSQL, which has its own backups.
export const backupsEnabled = !!sqliteFile && config.backup.keep > 0;
export const backupDir = sqliteFile ? path.join(path.dirname(sqliteFile), 'backups') : null;

export function listBackups() {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => /^choice-.*\.db$/.test(f)).sort().reverse()
    .map((file) => { const s = fs.statSync(path.join(backupDir, file)); return { file, size: s.size, at: s.mtime.toISOString() }; });
}

let running = null;
export function backupNow() {
  if (!backupsEnabled) return Promise.resolve(null);
  if (running) return running;
  running = (async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const dest = path.join(backupDir, `choice-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    const src = new Database(sqliteFile, { readonly: true, fileMustExist: true });
    try { await src.backup(dest); } finally { src.close(); }
    for (const old of listBackups().slice(config.backup.keep)) fs.rmSync(path.join(backupDir, old.file), { force: true });
    return dest;
  })().finally(() => { running = null; });
  return running;
}

/** Automatic backups: shortly after start, then every BACKUP_HOURS. Also taken when a contest starts or closes. */
export function startBackups() {
  if (!backupsEnabled) return;
  const run = () => backupNow().catch((e) => console.error('backup failed:', e.message));
  setTimeout(run, 60_000).unref();
  setInterval(run, config.backup.hours * 3600_000).unref();
}
