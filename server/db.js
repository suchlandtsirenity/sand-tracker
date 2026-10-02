import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseKey } from '../shared/level.js';
import { DEFAULT_PALETTES } from '../shared/palette.js';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);

  const q = {
    list: db.prepare('SELECT key, updated_at FROM levels ORDER BY updated_at DESC, rowid DESC'),
    get: db.prepare('SELECT json FROM levels WHERE key = ?'),
    put: db.prepare(`INSERT INTO levels (key, json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),
    del: db.prepare('DELETE FROM levels WHERE key = ?'),
    getSetting: db.prepare('SELECT json FROM settings WHERE key = ?'),
    putSetting: db.prepare(`INSERT INTO settings (key, json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET json = excluded.json`),
  };

  if (!q.getSetting.get('palettes')) q.putSetting.run('palettes', JSON.stringify(DEFAULT_PALETTES));

  return {
    listLevels: () => q.list.all().map((r) => ({ key: r.key, ...parseKey(r.key), updatedAt: r.updated_at })),
    getLevel(key) {
      const row = q.get.get(key);
      return row ? JSON.parse(row.json) : null;
    },
    putLevel(key, level) {
      const now = Date.now();
      q.put.run(key, JSON.stringify(level), now);
      return now;
    },
    deleteLevel: (key) => q.del.run(key).changes > 0,
    getPalettes: () => JSON.parse(q.getSetting.get('palettes').json),
    putPalettes: (list) => { q.putSetting.run('palettes', JSON.stringify(list)); },
    close: () => db.close(),
  };
}
