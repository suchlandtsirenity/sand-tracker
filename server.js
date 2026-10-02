import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './server/db.js';
import { createApp } from './server/app.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const db = openDb(process.env.DB_PATH ?? join(rootDir, 'data', 'sand.db'));

createApp({ db, rootDir }).listen(port, host, () => {
  console.log(`sand-tracker listening on http://${host}:${port}`);
});
