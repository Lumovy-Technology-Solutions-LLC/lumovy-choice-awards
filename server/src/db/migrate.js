import { db } from './index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function migrate() {
  await db.migrate.latest({ directory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations') });
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  await migrate();
  console.log('Migrations complete');
  await db.destroy();
}
