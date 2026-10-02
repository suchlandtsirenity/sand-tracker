import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { newLevel } from '../shared/level.js';
import { DEFAULT_PALETTES } from '../shared/palette.js';

test('seeds default palettes on first open', () => {
  const db = openDb(':memory:');
  assert.deepEqual(db.getPalettes(), DEFAULT_PALETTES);
});

test('putLevel / getLevel round trip; listLevels newest first', () => {
  const db = openDb(':memory:');
  assert.equal(db.getLevel('normal:1'), null);
  db.putLevel('normal:1', newLevel('normal', 1, [4], 1));
  db.putLevel('special:2', newLevel('special', 2, [8], 1));
  assert.deepEqual(db.getLevel('special:2'), newLevel('special', 2, [8], 1));
  assert.deepEqual(db.listLevels().map((r) => [r.key, r.type, r.number]),
    [['special:2', 'special', 2], ['normal:1', 'normal', 1]]);
  assert.equal(typeof db.listLevels()[0].updatedAt, 'number');
});

test('deleteLevel reports whether something was removed', () => {
  const db = openDb(':memory:');
  db.putLevel('normal:1', newLevel('normal', 1, [4], 1));
  assert.equal(db.deleteLevel('normal:1'), true);
  assert.equal(db.deleteLevel('normal:1'), false);
});

test('putPalettes replaces the list', () => {
  const db = openDb(':memory:');
  const list = [{ id: 'x', name: 'X', colours: ['#123456'] }];
  db.putPalettes(list);
  assert.deepEqual(db.getPalettes(), list);
});

test('data persists across reopen of a file database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sand-'));
  try {
    const path = join(dir, 'nested', 'sand.db');
    const a = openDb(path);
    a.putLevel('normal:7', newLevel('normal', 7, [4], 1));
    a.close();
    const b = openDb(path);
    assert.deepEqual(b.getLevel('normal:7'), newLevel('normal', 7, [4], 1));
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
