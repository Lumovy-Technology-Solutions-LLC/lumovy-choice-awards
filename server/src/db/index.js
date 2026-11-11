import fs from 'node:fs';
import path from 'node:path';
import knex from 'knex';
import { config } from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const isPg = /^postgres(ql)?:\/\//.test(config.databaseUrl);
export const sqliteFile = isPg ? null : (process.env.SQLITE_FILE || path.join(config.dataDir, 'choice.db'));

export const db = knex(
  isPg
    ? { client: 'pg', connection: config.databaseUrl, pool: { min: 2, max: 20 } }
    : {
        client: 'better-sqlite3',
        connection: { filename: sqliteFile },
        useNullAsDefault: true,
        pool: {
          min: 1,
          max: 1,
          afterCreate(conn, done) {
            conn.pragma(`journal_mode = ${config.sqliteJournal}`);
            if (config.sqliteJournal === 'delete') conn.pragma('synchronous = FULL'); // flush every commit to the (network) disk
            conn.pragma('foreign_keys = ON');
            conn.pragma('busy_timeout = 5000');
            done(null, conn);
          },
        },
      },
);
export const dialect = isPg ? 'pg' : 'sqlite';

export const nowIso = () => new Date().toISOString();
export const parseJson = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
