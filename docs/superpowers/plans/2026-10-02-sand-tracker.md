# Sand Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first web page, backed by a tiny Node server on the user's Hetzner box, that remembers revealed colours per sand-sort level across game restarts.

**Architecture:** One dependency-free Node server (`node:http` + `node:sqlite`) serves static files and a small JSON API. Pure data rules live in `shared/` and are imported by both the server and the browser (as native ES modules — no bundler). The browser client is plain DOM with hash routing and a debounced, retrying save queue.

**Tech Stack:** Node ≥ 22.5 (`node:sqlite`, `node:test`), vanilla JS ES modules, CSS, nginx + systemd for deploy.

**Spec:** `docs/spec.md`

## Global Constraints

- No npm dependencies. Only Node built-ins.
- Node ≥ 22.5; always run with `--experimental-sqlite` (required on 22.12, harmless later).
- `package.json` has `"type": "module"`; all JS is ESM.
- Colours are stored as colour IDs (1-based ints), never hex. Slot = colour ID or `null`. Slots are ordered bottom → top.
- Level key: `"<type>:<number>"`, type ∈ {`normal`, `special`}.
- Limits: jars 1–14, capacity 1–12, colourCount 1–14, level number 1–999999, palette colours 1–20, palette name 1–40 chars.
- Server env: `PORT` (default 8787), `HOST` (default 127.0.0.1), `DB_PATH` (default `./data/sand.db`).
- Autosave about 500 ms after a change; on failure, retry with backoff starting at 1 s and doubling up to 30 s.
- Active palette is per device (localStorage); palettes themselves are stored on the server.
- Browser client imports shared modules by absolute path: `/shared/level.js`, `/shared/palette.js`.

## Review Focus

1. **Bad level numbers** (0, negative, decimals, letters, huge): the picker refuses with a message and the server returns 400. This is pinned by the `parseKey rejects bad keys` test (Task 1) and the `400 on bad key` API test (Task 4).
2. **A palette with fewer colours than the level's colourCount:** swatches fall back to grey and still show the ID number, without crashing. Pinned by the `colourFor` fallback test (Task 2). Also, removing a colour from the *middle* of a palette would silently shift every later ID in saved levels, so the palette editor only allows removing the **last** colour (Task 9).
3. **Shrinking the layout or colour count on a level that's already filled in:** keeps what fits, drops colours that are now out of range, and never produces an invalid level. Pinned by the `resizeLayout` tests (Task 1).
4. **Going offline mid-level, then switching levels:** both levels' changes are kept and saved once back online. A change made while a save is in flight isn't lost. Pinned by the saver tests (Task 5).
5. **Hostile or broken requests** (oversized body, malformed JSON, path traversal in static URLs, body/key mismatch): the server returns 413/400/404/400 and keeps running. Pinned by the API tests (Task 4).

---

## File map

| File | Responsibility |
|---|---|
| `package.json`, `.gitignore` | ESM flag, scripts, ignore `data/` |
| `shared/level.js` | Level shape: keys, create, validate, resize, counts, slot edits, next selection |
| `shared/palette.js` | Palette validation, `colourFor`, default palette |
| `server/db.js` | SQLite storage (levels, palettes) |
| `server/app.js` | HTTP server: static files + JSON API |
| `server.js` | Entrypoint: env config, open db, listen |
| `public/index.html`, `public/style.css` | Page shell and styles |
| `public/dom.js` | `h()` element helper |
| `public/api.js` | fetch wrappers |
| `public/saver.js` | Debounced, retrying save queue |
| `public/app.js` | Boot, state, router |
| `public/views/picker.js` | Level picker + recent list |
| `public/views/setup.js` | Jar layout / colour count editor |
| `public/views/tracker.js` | Jar grid + palette bar |
| `public/views/palettes.js` | Palette config |
| `deploy/sand-tracker.service`, `deploy/nginx.conf.example`, `README.md` | Deploy |
| `test/*.test.js` | `node:test` suites |

---

### Task 1: Project scaffold + level model

**Files:**
- Create: `package.json`, `.gitignore`, `shared/level.js`
- Test: `test/level.test.js`

**Interfaces:**
- Produces (all exported from `shared/level.js`):
  - constants `TYPES`, `MAX_JARS=14`, `MAX_CAPACITY=12`, `MAX_COLOURS=14`, `MAX_LEVEL_NUMBER=999999`
  - `levelKey(type: string, number: number): string`
  - `parseKey(key: string): {type, number} | null`
  - `newLevel(type, number, capacities: number[], colourCount: number): Level`
  - `validateLevel(level: unknown): string | null` (returns an error message, or `null` if valid)
  - `resizeLayout(level: Level, capacities: number[], colourCount: number): Level`
  - `colourCounts(level: Level): number[]` (index = colour ID; index 0 unused)
  - `expectedPerColour(level: Level): number | null`
  - `setSlot(level, jarIndex, slotIndex, value: number|null): Level` (returns a new object)
  - `nextSelection(level, sel: {jar, slot}): {jar, slot} | null`

- [ ] **Step 1: Scaffold**

`package.json`:
```json
{
  "name": "sand-tracker",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.5" },
  "scripts": {
    "start": "node --experimental-sqlite server.js",
    "test": "node --experimental-sqlite --test"
  }
}
```

`.gitignore`:
```
data/
node_modules/
```

- [ ] **Step 2: Write the failing tests** in `test/level.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelKey, parseKey, newLevel, validateLevel, resizeLayout,
  colourCounts, expectedPerColour, setSlot, nextSelection,
} from '../shared/level.js';

const sample = () => ({
  type: 'normal', number: 212, colourCount: 3,
  jars: [
    { capacity: 4, slots: [1, 2, 3, null] },
    { capacity: 4, slots: [3, 3, null, null] },
    { capacity: 4, slots: [null, null, null, null] },
  ],
});

test('levelKey and parseKey round trip', () => {
  assert.equal(levelKey('special', 14), 'special:14');
  assert.deepEqual(parseKey('normal:212'), { type: 'normal', number: 212 });
  assert.deepEqual(parseKey('special:999999'), { type: 'special', number: 999999 });
});

test('parseKey rejects bad keys', () => {
  for (const k of ['normal:0', 'normal:-1', 'normal:1.5', 'normal:abc', 'weird:3',
    'normal:', 'normal:0012', 'special:1234567', '', 'normal:1:2']) {
    assert.equal(parseKey(k), null, k);
  }
});

test('newLevel builds empty jars matching capacities and is valid', () => {
  const lvl = newLevel('special', 3, [4, 8, 3], 5);
  assert.deepEqual(lvl.jars.map((j) => j.slots.length), [4, 8, 3]);
  assert.ok(lvl.jars.every((j) => j.slots.every((s) => s === null)));
  assert.equal(validateLevel(lvl), null);
});

test('validateLevel accepts the sample', () => {
  assert.equal(validateLevel(sample()), null);
});

test('validateLevel rejects malformed levels', () => {
  const cases = {
    'not object': () => null,
    'bad type': (l) => { l.type = 'bonus'; return l; },
    'number 0': (l) => { l.number = 0; return l; },
    'number float': (l) => { l.number = 1.5; return l; },
    'colourCount 0': (l) => { l.colourCount = 0; return l; },
    'colourCount 15': (l) => { l.colourCount = 15; return l; },
    'no jars': (l) => { l.jars = []; return l; },
    '15 jars': (l) => { l.jars = Array(15).fill({ capacity: 1, slots: [null] }); return l; },
    'capacity 13': (l) => { l.jars[0] = { capacity: 13, slots: Array(13).fill(null) }; return l; },
    'slots length mismatch': (l) => { l.jars[0].slots.pop(); return l; },
    'slot above colourCount': (l) => { l.jars[0].slots[3] = 4; return l; },
    'slot zero': (l) => { l.jars[0].slots[3] = 0; return l; },
    'slot string': (l) => { l.jars[0].slots[3] = '1'; return l; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    assert.equal(typeof validateLevel(mutate(sample())), 'string', name);
  }
});

test('resizeLayout keeps slots that fit and drops out-of-range colours', () => {
  const out = resizeLayout(sample(), [2, 6], 2);
  assert.equal(out.colourCount, 2);
  assert.deepEqual(out.jars, [
    { capacity: 2, slots: [1, 2] },
    { capacity: 6, slots: [null, null, null, null, null, null] }, // 3s dropped
  ]);
  assert.equal(validateLevel(out), null);
});

test('resizeLayout adds empty jars when growing', () => {
  const out = resizeLayout(sample(), [4, 4, 4, 4], 3);
  assert.deepEqual(out.jars[3], { capacity: 4, slots: [null, null, null, null] });
  assert.deepEqual(out.jars[0].slots, [1, 2, 3, null]);
});

test('resizeLayout output is always valid', () => {
  for (const caps of [[1], [12, 12], [3, 4, 8, 3, 3], Array(14).fill(4)]) {
    for (const cc of [1, 3, 14]) {
      assert.equal(validateLevel(resizeLayout(sample(), caps, cc)), null, `${caps} ${cc}`);
    }
  }
});

test('colourCounts counts each colour ID', () => {
  assert.deepEqual(colourCounts(sample()), [0, 1, 1, 3]);
});

test('expectedPerColour is the shared capacity, or null when mixed', () => {
  assert.equal(expectedPerColour(sample()), 4);
  assert.equal(expectedPerColour(newLevel('special', 1, [3, 3, 8], 3)), null);
});

test('setSlot returns a new level and leaves the original untouched', () => {
  const before = sample();
  const after = setSlot(before, 2, 3, 1);
  assert.equal(after.jars[2].slots[3], 1);
  assert.equal(before.jars[2].slots[3], null);
  assert.equal(after.jars[0], before.jars[0]); // untouched jars are shared
});

test('nextSelection moves down one layer and stops at the bottom', () => {
  assert.deepEqual(nextSelection(sample(), { jar: 1, slot: 3 }), { jar: 1, slot: 2 });
  assert.equal(nextSelection(sample(), { jar: 1, slot: 0 }), null);
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module .../shared/level.js`

- [ ] **Step 4: Implement** `shared/level.js`

```js
// Level data rules, shared by server and browser. Pure functions only.
// Slots are ordered bottom → top; each is a colour ID (1-based) or null (unknown/empty).

export const TYPES = ['normal', 'special'];
export const MAX_JARS = 14;
export const MAX_CAPACITY = 12;
export const MAX_COLOURS = 14;
export const MAX_LEVEL_NUMBER = 999999;

const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function levelKey(type, number) {
  return `${type}:${number}`;
}

export function parseKey(key) {
  const m = /^(normal|special):([1-9]\d{0,5})$/.exec(key);
  return m ? { type: m[1], number: Number(m[2]) } : null;
}

export function newLevel(type, number, capacities, colourCount) {
  return {
    type, number, colourCount,
    jars: capacities.map((capacity) => ({ capacity, slots: Array(capacity).fill(null) })),
  };
}

export function validateLevel(level) {
  if (!level || typeof level !== 'object') return 'level must be an object';
  if (!TYPES.includes(level.type)) return 'type must be normal or special';
  if (!isInt(level.number, 1, MAX_LEVEL_NUMBER)) return `number must be 1–${MAX_LEVEL_NUMBER}`;
  if (!isInt(level.colourCount, 1, MAX_COLOURS)) return `colourCount must be 1–${MAX_COLOURS}`;
  if (!Array.isArray(level.jars) || !isInt(level.jars.length, 1, MAX_JARS)) return `need 1–${MAX_JARS} jars`;
  for (const [i, jar] of level.jars.entries()) {
    if (!jar || !isInt(jar.capacity, 1, MAX_CAPACITY)) return `jar ${i + 1}: capacity must be 1–${MAX_CAPACITY}`;
    if (!Array.isArray(jar.slots) || jar.slots.length !== jar.capacity) return `jar ${i + 1}: slots must match capacity`;
    for (const s of jar.slots) {
      if (s !== null && !isInt(s, 1, level.colourCount)) return `jar ${i + 1}: slot must be empty or 1–${level.colourCount}`;
    }
  }
  return null;
}

// Re-shape a level, keeping the bottom slots of each jar that still fit.
export function resizeLayout(level, capacities, colourCount) {
  return {
    ...level,
    colourCount,
    jars: capacities.map((capacity, i) => {
      const old = level.jars[i]?.slots ?? [];
      const slots = Array.from({ length: capacity }, (_, s) => {
        const v = old[s] ?? null;
        return v !== null && v <= colourCount ? v : null;
      });
      return { capacity, slots };
    }),
  };
}

export function colourCounts(level) {
  const counts = Array(level.colourCount + 1).fill(0);
  for (const jar of level.jars) for (const s of jar.slots) if (s !== null) counts[s]++;
  return counts;
}

// Units per colour when every jar has the same capacity; unknown otherwise.
export function expectedPerColour(level) {
  const caps = new Set(level.jars.map((j) => j.capacity));
  return caps.size === 1 ? [...caps][0] : null;
}

export function setSlot(level, jarIndex, slotIndex, value) {
  return {
    ...level,
    jars: level.jars.map((jar, i) => (i !== jarIndex ? jar : {
      ...jar,
      slots: jar.slots.map((s, k) => (k === slotIndex ? value : s)),
    })),
  };
}

// After filling a slot, select the next layer down: in blind levels that's
// the next one revealed. At the bottom, clear the selection.
export function nextSelection(level, sel) {
  return sel.slot > 0 ? { jar: sel.jar, slot: sel.slot - 1 } : null;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm test`
Expected: all `level.test.js` tests PASS

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore shared/level.js test/level.test.js
git commit -m "feat: level data model with validation and resize"
```

---

### Task 2: Palette module

**Files:**
- Create: `shared/palette.js`
- Test: `test/palette.test.js`

**Interfaces:**
- Produces (from `shared/palette.js`):
  - `FALLBACK_COLOUR = '#9e9e9e'`
  - `DEFAULT_PALETTES: Palette[]`, where `Palette = {id: string, name: string, colours: string[]}`
  - `colourFor(palette: Palette|undefined, id: number): string`
  - `validatePalettes(list: unknown): string | null`

- [ ] **Step 1: Write the failing tests** in `test/palette.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourFor, validatePalettes, DEFAULT_PALETTES, FALLBACK_COLOUR } from '../shared/palette.js';

const pal = { id: 'a', name: 'A', colours: ['#ff0000', '#00ff00'] };

test('colourFor maps 1-based IDs to colours', () => {
  assert.equal(colourFor(pal, 1), '#ff0000');
  assert.equal(colourFor(pal, 2), '#00ff00');
});

test('colourFor falls back when the palette is short or missing', () => {
  assert.equal(colourFor(pal, 3), FALLBACK_COLOUR);
  assert.equal(colourFor(undefined, 1), FALLBACK_COLOUR);
});

test('DEFAULT_PALETTES is valid and has 14 colours', () => {
  assert.equal(validatePalettes(DEFAULT_PALETTES), null);
  assert.equal(DEFAULT_PALETTES[0].colours.length, 14);
});

test('validatePalettes rejects bad input', () => {
  const bad = {
    'not array': {},
    'empty': [],
    'missing id': [{ name: 'x', colours: ['#000000'] }],
    'duplicate id': [pal, pal],
    'blank name': [{ ...pal, name: '  ' }],
    'long name': [{ ...pal, name: 'x'.repeat(41) }],
    'no colours': [{ ...pal, colours: [] }],
    '21 colours': [{ ...pal, colours: Array(21).fill('#000000') }],
    'bad hex': [{ ...pal, colours: ['red'] }],
    'short hex': [{ ...pal, colours: ['#fff'] }],
  };
  for (const [name, value] of Object.entries(bad)) {
    assert.equal(typeof validatePalettes(value), 'string', name);
  }
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module .../shared/palette.js`

- [ ] **Step 3: Implement** `shared/palette.js`

```js
// Palettes map colour IDs (1-based) to display colours. Shared by server and browser.

export const FALLBACK_COLOUR = '#9e9e9e';
const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_PALETTES = [{
  id: 'default',
  name: 'Default',
  colours: [
    '#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1',
    '#d81b60', '#6d4c41', '#3949ab', '#7cb342', '#f4511e', '#546e7a', '#c0ca33',
  ],
}];

export function colourFor(palette, id) {
  return palette?.colours?.[id - 1] ?? FALLBACK_COLOUR;
}

export function validatePalettes(list) {
  if (!Array.isArray(list) || list.length < 1) return 'need at least one palette';
  const ids = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') return 'palette must be an object';
    if (typeof p.id !== 'string' || !p.id || p.id.length > 40) return 'palette id must be 1–40 characters';
    if (ids.has(p.id)) return `duplicate palette id ${p.id}`;
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40) return 'palette name must be 1–40 characters';
    if (!Array.isArray(p.colours) || p.colours.length < 1 || p.colours.length > 20) return 'a palette needs 1–20 colours';
    if (!p.colours.every((c) => typeof c === 'string' && HEX.test(c))) return 'colours must look like #rrggbb';
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/palette.js test/palette.test.js
git commit -m "feat: palette validation and colour lookup"
```

---

### Task 3: SQLite storage

**Files:**
- Create: `server/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: `parseKey` (Task 1), `DEFAULT_PALETTES` (Task 2)
- Produces: `openDb(path: string): Db`, where `path` may be `':memory:'`
  - `db.listLevels(): {key, type, number, updatedAt}[]` (newest first)
  - `db.getLevel(key): Level | null`
  - `db.putLevel(key, level): number` (returns `updatedAt` in ms)
  - `db.deleteLevel(key): boolean`
  - `db.getPalettes(): Palette[]`
  - `db.putPalettes(list): void`
  - `db.close(): void`

- [ ] **Step 1: Write the failing tests** in `test/db.test.js`

```js
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module .../server/db.js`

- [ ] **Step 3: Implement** `server/db.js`

```js
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS (an `ExperimentalWarning` about SQLite on stderr is fine)

- [ ] **Step 5: Commit**

```bash
git add server/db.js test/db.test.js
git commit -m "feat: sqlite storage for levels and palettes"
```

---

### Task 4: HTTP server and API

**Files:**
- Create: `server/app.js`, `server.js`, `public/index.html` (placeholder so static serving can be tested; replaced in Task 6)
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 3), `parseKey`, `validateLevel` (Task 1), `validatePalettes` (Task 2)
- Produces: `createApp({db, rootDir}): http.Server`. Routes:
  - `GET /api/levels` → 200 `[{key,type,number,updatedAt}]`
  - `GET /api/levels/:key` → 200 Level | 404
  - `PUT /api/levels/:key` (Level body) → 200 `{updatedAt}` | 400
  - `DELETE /api/levels/:key` → 204 | 404
  - `GET /api/palettes` → 200 Palette[]
  - `PUT /api/palettes` (Palette[] body) → 200 `{ok:true}` | 400
  - Errors use the shape `{error: string}`. Static: `/` → `public/index.html`, `/shared/*` → `shared/*`, everything else → `public/*`.

- [ ] **Step 1: Placeholder page** `public/index.html`

```html
<!doctype html>
<title>Sand Tracker</title>
```

- [ ] **Step 2: Write the failing tests** in `test/api.test.js`

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { newLevel } from '../shared/level.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let server, base, port;

before(async () => {
  server = createApp({ db: openDb(':memory:'), rootDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const put = (path, body) => fetch(base + path, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// Sends the path byte-for-byte (fetch would normalise "..").
const rawGet = (path) => new Promise((resolve, reject) => {
  request({ host: '127.0.0.1', port, path }, (res) => { res.resume(); resolve(res.statusCode); })
    .on('error', reject).end();
});

test('PUT then GET a level round trips', async () => {
  const lvl = newLevel('normal', 212, [4, 4], 2);
  lvl.jars[0].slots[3] = 2;
  const res = await put('/api/levels/normal%3A212', lvl);
  assert.equal(res.status, 200);
  assert.equal(typeof (await res.json()).updatedAt, 'number');
  const got = await fetch(`${base}/api/levels/normal%3A212`);
  assert.deepEqual(await got.json(), lvl);
});

test('unknown fields are stripped before storage', async () => {
  const lvl = { ...newLevel('normal', 5, [4], 1), junk: 1 };
  lvl.jars[0].extra = true;
  await put('/api/levels/normal:5', lvl);
  const got = await (await fetch(`${base}/api/levels/normal:5`)).json();
  assert.deepEqual(got, newLevel('normal', 5, [4], 1));
});

test('list returns saved levels', async () => {
  await put('/api/levels/special:3', newLevel('special', 3, [8], 1));
  const list = await (await fetch(`${base}/api/levels`)).json();
  assert.ok(list.some((r) => r.key === 'special:3' && r.type === 'special' && r.number === 3));
});

test('404 for a missing level, then DELETE semantics', async () => {
  assert.equal((await fetch(`${base}/api/levels/normal:999`)).status, 404);
  await put('/api/levels/normal:998', newLevel('normal', 998, [4], 1));
  assert.equal((await fetch(`${base}/api/levels/normal:998`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/levels/normal:998`, { method: 'DELETE' })).status, 404);
});

test('400 on bad key, invalid level, mismatched key, bad JSON', async () => {
  assert.equal((await fetch(`${base}/api/levels/normal:0`)).status, 400);
  assert.equal((await fetch(`${base}/api/levels/%E0%A4%A`)).status, 400);
  const bad = newLevel('normal', 1, [4], 1);
  bad.jars[0].slots[0] = 7;
  const r1 = await put('/api/levels/normal:1', bad);
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).error, /slot/);
  assert.equal((await put('/api/levels/normal:2', newLevel('normal', 1, [4], 1))).status, 400);
  assert.equal((await put('/api/levels/normal:1', '{nope')).status, 400);
});

test('413 on an oversized body, and the server keeps working', async () => {
  const res = await put('/api/levels/normal:1', 'x'.repeat(100_000)).catch(() => null);
  if (res) assert.equal(res.status, 413);
  assert.equal((await fetch(`${base}/api/levels`)).status, 200);
});

test('palettes GET and PUT with validation', async () => {
  const initial = await (await fetch(`${base}/api/palettes`)).json();
  assert.equal(initial[0].id, 'default');
  const next = [{ id: 'p1', name: 'Pastel', colours: ['#ffcccc'], junk: 1 }];
  assert.equal((await put('/api/palettes', next)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/palettes`)).json(),
    [{ id: 'p1', name: 'Pastel', colours: ['#ffcccc'] }]);
  assert.equal((await put('/api/palettes', [])).status, 400);
});

test('405 for a wrong method, 404 for an unknown API path', async () => {
  assert.equal((await fetch(`${base}/api/levels`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});

test('static files are served, traversal is refused', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const shared = await fetch(`${base}/shared/level.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);
  assert.equal(await rawGet('/..%2fpackage.json'), 404);
  assert.equal(await rawGet('/shared/..%2fserver%2fdb.js'), 404);
  assert.equal(await rawGet('/server/db.js'), 404);
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module .../server/app.js`

- [ ] **Step 4: Implement** `server/app.js`

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { parseKey, validateLevel } from '../shared/level.js';
import { validatePalettes } from '../shared/palette.js';

const MAX_BODY = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({ db, rootDir }) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname, db);
      else await serveStatic(res, rootDir, pathname);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) send(res, status, { error: err instanceof HttpError ? err.message : 'internal error' });
      if (status === 413) req.destroy();
    }
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

const cleanLevel = ({ type, number, colourCount, jars }) =>
  ({ type, number, colourCount, jars: jars.map(({ capacity, slots }) => ({ capacity, slots })) });
const cleanPalettes = (list) => list.map(({ id, name, colours }) => ({ id, name, colours }));

async function handleApi(req, res, pathname, db) {
  const [, , resource, rawKey, extra] = pathname.split('/');
  if (extra !== undefined) throw new HttpError(404, 'not found');

  if (resource === 'levels' && rawKey === undefined) {
    if (req.method === 'GET') return send(res, 200, db.listLevels());
    throw new HttpError(405, 'method not allowed');
  }

  if (resource === 'levels') {
    let key;
    try { key = decodeURIComponent(rawKey); } catch { throw new HttpError(400, 'bad level key'); }
    const parsed = parseKey(key);
    if (!parsed) throw new HttpError(400, 'bad level key');

    if (req.method === 'GET') {
      const level = db.getLevel(key);
      if (!level) throw new HttpError(404, 'level not found');
      return send(res, 200, level);
    }
    if (req.method === 'PUT') {
      const level = await readJson(req);
      const problem = validateLevel(level);
      if (problem) throw new HttpError(400, problem);
      if (level.type !== parsed.type || level.number !== parsed.number) throw new HttpError(400, 'level does not match key');
      return send(res, 200, { updatedAt: db.putLevel(key, cleanLevel(level)) });
    }
    if (req.method === 'DELETE') {
      if (!db.deleteLevel(key)) throw new HttpError(404, 'level not found');
      res.writeHead(204);
      return res.end();
    }
    throw new HttpError(405, 'method not allowed');
  }

  if (resource === 'palettes' && rawKey === undefined) {
    if (req.method === 'GET') return send(res, 200, db.getPalettes());
    if (req.method === 'PUT') {
      const list = await readJson(req);
      const problem = validatePalettes(list);
      if (problem) throw new HttpError(400, problem);
      db.putPalettes(cleanPalettes(list));
      return send(res, 200, { ok: true });
    }
    throw new HttpError(405, 'method not allowed');
  }

  throw new HttpError(404, 'not found');
}

async function serveStatic(res, rootDir, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'bad path'); }
  if (rel === '/') rel = '/index.html';
  const isShared = rel.startsWith('/shared/');
  const allowedDir = join(rootDir, isShared ? '' : 'public') + sep;
  const file = resolve(allowedDir, '.' + rel);
  const mustStartWith = isShared ? join(rootDir, 'shared') + sep : allowedDir;
  if (!file.startsWith(mustStartWith)) throw new HttpError(404, 'not found');
  let data;
  try { data = await readFile(file); } catch { throw new HttpError(404, 'not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}
```

- [ ] **Step 5: Implement** `server.js`

```js
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
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npm test`
Expected: all suites PASS

- [ ] **Step 7: Smoke-test the entrypoint**

Run: `PORT=8799 timeout 3 npm start & sleep 1; curl -s localhost:8799/api/palettes | head -c 80; wait`
Expected: JSON starting with `[{"id":"default"`

- [ ] **Step 8: Commit**

```bash
git add server/app.js server.js public/index.html test/api.test.js
git commit -m "feat: http server with level and palette API"
```

---

### Task 5: Client save queue

**Files:**
- Create: `public/saver.js`
- Test: `test/saver.test.js`

**Interfaces:**
- Produces: `createSaver({save, delay=500, initialBackoff=1000, maxBackoff=30000, onStatus}): Saver`
  - `save(key, level): Promise<unknown>` (rejects on failure)
  - `onStatus(status)`, where status ∈ `'pending' | 'saving' | 'saved' | 'offline'`
  - `saver.schedule(key, level)`: stores a clone of `level` and (re)starts the debounce
  - `saver.flush(): Promise<void>`: saves pending changes now
  - `saver.peek(key): Level | undefined`: the newest unsaved value for a key

- [ ] **Step 1: Write the failing tests** in `test/saver.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from '../public/saver.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('debounces rapid changes into one save of the latest value', async () => {
  const saves = [];
  const s = createSaver({ save: async (k, v) => { saves.push([k, v]); }, delay: 20 });
  s.schedule('normal:1', { n: 1 });
  s.schedule('normal:1', { n: 2 });
  await wait(80);
  assert.deepEqual(saves, [['normal:1', { n: 2 }]]);
});

test('stores a snapshot, not a live reference', async () => {
  const saves = [];
  const s = createSaver({ save: async (k, v) => { saves.push(v); }, delay: 10 });
  const lvl = { n: 1 };
  s.schedule('normal:1', lvl);
  lvl.n = 99;
  await wait(50);
  assert.deepEqual(saves, [{ n: 1 }]);
});

test('retries with backoff until the save succeeds', async () => {
  let failures = 2;
  const saves = [];
  const statuses = [];
  const s = createSaver({
    save: async (k, v) => { if (failures-- > 0) throw new Error('offline'); saves.push(v); },
    delay: 10, initialBackoff: 10, onStatus: (st) => statuses.push(st),
  });
  s.schedule('normal:1', { n: 1 });
  await wait(200);
  assert.deepEqual(saves, [{ n: 1 }]);
  assert.ok(statuses.includes('offline'));
  assert.equal(statuses.at(-1), 'saved');
});

test('keeps changes to several levels while offline, saves all when back', async () => {
  let online = false;
  const saved = new Set();
  const s = createSaver({
    save: async (k) => { if (!online) throw new Error('offline'); saved.add(k); },
    delay: 10, initialBackoff: 10, maxBackoff: 20,
  });
  s.schedule('normal:1', { a: 1 });
  s.schedule('special:2', { b: 2 });
  await wait(50);
  assert.equal(saved.size, 0);
  assert.deepEqual(s.peek('normal:1'), { a: 1 });
  online = true;
  await wait(100);
  assert.deepEqual([...saved].sort(), ['normal:1', 'special:2']);
  assert.equal(s.peek('normal:1'), undefined);
});

test('a change made during an in-flight save is saved afterwards', async () => {
  const saves = [];
  let release;
  const s = createSaver({
    save: (k, v) => { saves.push(v); return v.n === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); },
    delay: 10,
  });
  s.schedule('normal:1', { n: 1 });
  await wait(30);            // first save now in flight
  s.schedule('normal:1', { n: 2 });
  release();
  await wait(60);
  assert.deepEqual(saves, [{ n: 1 }, { n: 2 }]);
});

test('flush saves immediately without waiting for the debounce', async () => {
  const saves = [];
  const s = createSaver({ save: async (k, v) => { saves.push(v); }, delay: 10_000 });
  s.schedule('normal:1', { n: 1 });
  await s.flush();
  assert.deepEqual(saves, [{ n: 1 }]);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module .../public/saver.js`

- [ ] **Step 3: Implement** `public/saver.js`

```js
// Debounced, retrying save queue. Holds the newest unsaved value per level key
// until the server accepts it, so nothing is lost while offline.

export function createSaver({ save, delay = 500, initialBackoff = 1000, maxBackoff = 30000, onStatus = () => {} }) {
  const pending = new Map(); // key -> snapshot
  let timer = null;
  let inFlight = null;
  let backoff = initialBackoff;

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  async function run() {
    timer = null;
    if (inFlight || pending.size === 0) return inFlight;
    onStatus('saving');
    inFlight = (async () => {
      let failed = false;
      for (const [key, value] of [...pending]) {
        try {
          await save(key, value);
          if (pending.get(key) === value) pending.delete(key); // unchanged since we sent it
        } catch {
          failed = true;
        }
      }
      inFlight = null;
      if (failed) {
        onStatus('offline');
        arm(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      } else if (pending.size) {
        arm(delay); // changes arrived while saving
      } else {
        backoff = initialBackoff;
        onStatus('saved');
      }
    })();
    return inFlight;
  }

  return {
    schedule(key, level) {
      pending.set(key, structuredClone(level));
      onStatus('pending');
      if (!inFlight) arm(delay);
    },
    flush() {
      clearTimeout(timer);
      return run();
    },
    peek: (key) => pending.get(key),
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/saver.js test/saver.test.js
git commit -m "feat: debounced retrying save queue"
```

---

### Task 6: Client shell, router, level picker

**Files:**
- Create: `public/style.css`, `public/dom.js`, `public/api.js`, `public/app.js`, `public/views/picker.js`
- Modify: `public/index.html` (replace the placeholder entirely)

**Interfaces:**
- Consumes: `createSaver` (Task 5), `levelKey`, `parseKey`, `MAX_LEVEL_NUMBER` (Task 1), `DEFAULT_PALETTES` (Task 2)
- Produces:
  - `h(tag, props, ...children): HTMLElement` from `public/dom.js`. Props: `on*` become listeners; `class`; `style` (an object); `true` sets a boolean attribute; `false`/`null` are skipped.
  - `api` from `public/api.js`: `listLevels()`, `getLevel(key)` (resolves `null` on 404), `putLevel(key, level)`, `deleteLevel(key)`, `getPalettes()`, `putPalettes(list)`
  - `ctx`, passed to every view: `{ api, saver, state: {palettes, activePaletteId, lastType}, activePalette(): Palette, setActivePalette(id), go(path) }`. `go('/level/normal%3A1')` navigates, re-rendering even if the hash is unchanged.
  - Each view: `renderX(ctx, ...): HTMLElement`
  - Routes: `#/` picker, `#/level/<key>` tracker (or setup if the level doesn't exist), `#/level/<key>/setup`, `#/palettes`
  - Tasks 7–9 create `views/setup.js`, `views/tracker.js`, and `views/palettes.js`. Until then, `app.js` imports them, so create each as a stub now:

```js
// public/views/setup.js — replaced in Task 7
export const renderSetup = () => document.createTextNode('setup: todo');
```
```js
// public/views/tracker.js — replaced in Task 8
export const renderTracker = () => document.createTextNode('tracker: todo');
```
```js
// public/views/palettes.js — replaced in Task 9
export const renderPalettes = () => document.createTextNode('palettes: todo');
```

- [ ] **Step 1: Write** `public/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Sand">
  <title>Sand Tracker</title>
  <link rel="stylesheet" href="/style.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="status" aria-live="polite"></div>
  <main id="view"></main>
</body>
</html>
```

- [ ] **Step 2: Write** `public/style.css`

```css
:root {
  --bg: #faf7f2; --fg: #222; --muted: #777; --card: #fff; --line: #ddd;
  --accent: #c77d2e; --danger: #c62828;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #17150f; --fg: #eee; --muted: #999; --card: #24211a; --line: #3a362c; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.4 system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); }
main { max-width: 720px; margin: 0 auto; padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
#status { position: fixed; top: env(safe-area-inset-top); right: 8px; font-size: 12px; color: var(--muted); padding: 4px 8px; }
#status[data-state="offline"] { color: var(--danger); }
h1 { font-size: 1.3rem; margin: 0; text-transform: capitalize; }
h2 { font-size: 1rem; color: var(--muted); }
a { color: var(--accent); }
button, input, select { font: inherit; color: inherit; }
button { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; min-height: 44px; }
button.primary { background: var(--accent); color: #fff; border-color: transparent; }
button.danger { color: var(--danger); }
button:disabled { opacity: .4; }
input[type=number], input[type=text], select { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; min-height: 44px; }
input[type=number] { width: 6em; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.error { color: var(--danger); min-height: 1.4em; }
.muted { color: var(--muted); }

.picker { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
.segs { display: flex; gap: 8px; }
.seg { flex: 1; position: relative; text-align: center; border: 1px solid var(--line); border-radius: 8px; padding: 10px; text-transform: capitalize; }
.seg:has(input:checked) { background: var(--accent); color: #fff; border-color: transparent; }
.seg input { position: absolute; opacity: 0; inset: 0; margin: 0; }
.recent { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.recent a { display: block; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; text-decoration: none; text-transform: capitalize; }

.jar-list { padding-left: 1.5em; }
.jar-list li { margin: 6px 0; }

.jars { display: flex; flex-direction: column; gap: 16px; margin: 8px 0 16px; }
.jar-row { display: grid; gap: 6px; align-items: end; }
.jar { display: flex; flex-direction: column-reverse; border: 2px solid var(--line); border-top: none; border-radius: 0 0 10px 10px; overflow: hidden; background: var(--card); }
.slot { flex: 1; min-height: 0; border: none; border-radius: 0; padding: 0; font-size: 11px; color: rgba(255,255,255,.85); text-shadow: 0 0 2px #000; border-top: 1px solid rgba(0,0,0,.08); }
.slot.unknown { background: transparent; color: var(--muted); text-shadow: none; }
.slot.selected { outline: 3px solid var(--accent); outline-offset: -3px; }
.palette-bar { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 0; background: var(--bg); }
.swatch { width: 44px; height: 44px; padding: 0; position: relative; border-radius: 50%; }
.badge { position: absolute; bottom: -6px; right: -6px; font-size: 10px; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 0 4px; }

.palette { border: 1px solid var(--line); border-radius: 10px; margin: 12px 0; }
.colours { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.colour-edit { display: inline-flex; align-items: center; gap: 2px; }
.colour-edit input[type=color] { width: 40px; height: 40px; border: none; background: none; padding: 0; }
```

- [ ] **Step 3: Write** `public/dom.js`

```js
// Tiny element builder: h('button', { class: 'x', onclick }, 'Label')
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}
```

- [ ] **Step 4: Write** `public/api.js`

```js
async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? true : res.json();
}

const levelPath = (key) => `/api/levels/${encodeURIComponent(key)}`;

export const api = {
  listLevels: () => req('GET', '/api/levels'),
  getLevel: (key) => req('GET', levelPath(key)),
  putLevel: (key, level) => req('PUT', levelPath(key), level),
  deleteLevel: (key) => req('DELETE', levelPath(key)),
  getPalettes: () => req('GET', '/api/palettes'),
  putPalettes: (list) => req('PUT', '/api/palettes', list),
};
```

- [ ] **Step 5: Write** `public/app.js`

```js
import { api } from './api.js';
import { createSaver } from './saver.js';
import { h } from './dom.js';
import { parseKey } from '/shared/level.js';
import { DEFAULT_PALETTES } from '/shared/palette.js';
import { renderPicker } from './views/picker.js';
import { renderSetup } from './views/setup.js';
import { renderTracker } from './views/tracker.js';
import { renderPalettes } from './views/palettes.js';

const view = document.getElementById('view');
const statusEl = document.getElementById('status');
const STATUS_TEXT = { pending: '…', saving: 'saving…', saved: 'saved', offline: 'offline – retrying' };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const state = { palettes: DEFAULT_PALETTES, activePaletteId: lsGet('activePalette'), lastType: 'normal' };

const saver = createSaver({
  save: (key, level) => api.putLevel(key, level),
  onStatus: (s) => { statusEl.textContent = STATUS_TEXT[s]; statusEl.dataset.state = s; },
});

const ctx = {
  api,
  saver,
  state,
  activePalette: () => state.palettes.find((p) => p.id === state.activePaletteId) ?? state.palettes[0],
  setActivePalette(id) { state.activePaletteId = id; lsSet('activePalette', id); },
  go(path) {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  },
};

async function route() {
  await saver.flush();
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  let el;
  try {
    if (parts[0] === 'level' && parts[1]) {
      const key = decodeURIComponent(parts[1]);
      if (!parseKey(key)) return ctx.go('/');
      const level = saver.peek(key) ?? await api.getLevel(key);
      el = parts[2] === 'setup' || !level ? renderSetup(ctx, key, level) : renderTracker(ctx, key, level);
    } else if (parts[0] === 'palettes') {
      el = renderPalettes(ctx);
    } else {
      el = renderPicker(ctx, await api.listLevels());
    }
  } catch (err) {
    el = h('section', {}, h('p', { class: 'error' }, `Couldn't load: ${err.message}`), h('a', { href: '#/' }, '← Levels'));
  }
  view.replaceChildren(el);
  scrollTo(0, 0);
}

try { state.palettes = await api.getPalettes(); } catch { /* keep defaults offline */ }
addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saver.flush();
});
route();
```

- [ ] **Step 6: Write** `public/views/picker.js`

```js
import { h } from '../dom.js';
import { levelKey, MAX_LEVEL_NUMBER } from '/shared/level.js';

export function renderPicker(ctx, recent) {
  const num = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: MAX_LEVEL_NUMBER, placeholder: 'Level number', 'aria-label': 'Level number' });
  const err = h('p', { class: 'error' });
  const seg = (t) => h('label', { class: 'seg' },
    h('input', { type: 'radio', name: 'type', value: t, checked: ctx.state.lastType === t, onchange: () => { ctx.state.lastType = t; } }),
    t);

  const form = h('form', {
    class: 'picker',
    onsubmit(e) {
      e.preventDefault();
      const n = Number(num.value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LEVEL_NUMBER) {
        err.textContent = `Enter a whole number from 1 to ${MAX_LEVEL_NUMBER}.`;
        return;
      }
      ctx.go(`/level/${encodeURIComponent(levelKey(ctx.state.lastType, n))}`);
    },
  }, h('div', { class: 'segs' }, seg('normal'), seg('special')), num, h('button', { type: 'submit', class: 'primary' }, 'Open'), err);

  return h('section', {},
    h('div', { class: 'bar' }, h('h1', {}, 'Sand Tracker'), h('a', { href: '#/palettes' }, 'Palettes')),
    form,
    h('h2', {}, 'Recent'),
    recent.length
      ? h('ul', { class: 'recent' }, recent.slice(0, 20).map((r) =>
        h('li', {}, h('a', { href: `#/level/${encodeURIComponent(r.key)}` }, `${r.type} ${r.number}`))))
      : h('p', { class: 'muted' }, 'No levels yet.'));
}
```

- [ ] **Step 7: Create the three view stubs** listed under Interfaces above.

- [ ] **Step 8: Run tests, then check by hand**

Run: `npm test` (expected: still PASS), then `npm start` and open `http://localhost:8787`.
Expected: the page shows "Sand Tracker", a normal/special toggle, a number box, and "No levels yet." Entering `0` shows the error message. Entering `212` changes the URL to `#/level/normal%3A212` and shows `setup: todo`. "Palettes" shows `palettes: todo`. The browser console has no errors.

- [ ] **Step 9: Commit**

```bash
git add public/
git commit -m "feat: client shell, router and level picker"
```

---

### Task 7: Level setup view

**Files:**
- Modify: `public/views/setup.js` (replace the stub)

**Interfaces:**
- Consumes: `ctx` (Task 6); `parseKey`, `newLevel`, `resizeLayout`, `validateLevel`, `MAX_JARS`, `MAX_CAPACITY`, `MAX_COLOURS` (Task 1)
- Produces: `renderSetup(ctx, key: string, existing: Level|null): HTMLElement`. On save, it PUTs the level directly (not through the saver, so validation errors show up right away) and navigates to `#/level/<key>`.

- [ ] **Step 1: Implement** `public/views/setup.js`

```js
import { h } from '../dom.js';
import { parseKey, newLevel, resizeLayout, validateLevel, MAX_JARS, MAX_CAPACITY, MAX_COLOURS } from '/shared/level.js';

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export function renderSetup(ctx, key, existing) {
  const { type, number } = parseKey(key);
  let caps = existing ? existing.jars.map((j) => j.capacity) : Array(9).fill(4);
  let colourCount = existing?.colourCount ?? 7;
  const root = h('section', {});
  const err = h('p', { class: 'error' });
  const trackerHref = `#/level/${encodeURIComponent(key)}`;

  function draw() {
    root.replaceChildren(
      h('div', { class: 'bar' }, h('a', { href: existing ? trackerHref : '#/' }, '← Back'), h('h1', {}, `${type} ${number}`), h('span')),
      h('p', { class: 'muted' }, existing ? 'Edit layout. Colours already entered are kept where they still fit.' : 'New level: set up the jars.'),
      h('div', { class: 'row' },
        h('label', {}, 'Colours ', h('input', {
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_COLOURS, value: colourCount,
          onchange(e) { colourCount = clampInt(e.target.value, 1, MAX_COLOURS); draw(); },
        })),
        h('label', {}, 'Jars ', h('input', {
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_JARS, value: caps.length,
          onchange(e) {
            const n = clampInt(e.target.value, 1, MAX_JARS);
            caps = Array.from({ length: n }, (_, i) => caps[i] ?? caps.at(-1) ?? 4);
            draw();
          },
        }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick() { caps = caps.map(() => 4); draw(); } }, 'Standard (all 4)'),
        h('button', { type: 'button', disabled: caps.length >= MAX_JARS, onclick() { caps.push(caps.at(-1) ?? 4); draw(); } }, '+ Add jar')),
      h('ol', { class: 'jar-list' }, caps.map((c, i) => h('li', {},
        'Capacity ',
        h('input', {
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_CAPACITY, value: c, 'aria-label': `Jar ${i + 1} capacity`,
          onchange(e) { caps[i] = clampInt(e.target.value, 1, MAX_CAPACITY); draw(); },
        }),
        ' ',
        h('button', { type: 'button', disabled: caps.length === 1, 'aria-label': `Remove jar ${i + 1}`, onclick() { caps.splice(i, 1); draw(); } }, '×')))),
      err,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: save }, 'Save layout')));
  }

  async function save() {
    const level = existing ? resizeLayout(existing, caps, colourCount) : newLevel(type, number, caps, colourCount);
    const problem = validateLevel(level);
    if (problem) { err.textContent = problem; return; }
    try {
      await ctx.api.putLevel(key, level);
      ctx.go(`/level/${encodeURIComponent(key)}`);
    } catch (e) {
      err.textContent = `Couldn't save: ${e.message}`;
    }
  }

  draw();
  return root;
}
```

- [ ] **Step 2: Check by hand**

Run: `npm start`, then open `http://localhost:8787/#/level/normal%3A212`.
Expected: the setup form shows 7 colours and 9 jars of capacity 4. Setting Jars to 14 gives 14 rows. Changing one capacity to 8 and pressing "Standard (all 4)" resets all of them to 4. "Save layout" navigates to `tracker: todo` (the stub). `curl -s localhost:8787/api/levels/normal:212` returns the saved level.

- [ ] **Step 3: Commit**

```bash
git add public/views/setup.js
git commit -m "feat: level layout setup view"
```

---

### Task 8: Tracker view

**Files:**
- Modify: `public/views/tracker.js` (replace the stub)

**Interfaces:**
- Consumes: `ctx` (Task 6); `setSlot`, `nextSelection`, `colourCounts`, `expectedPerColour` (Task 1); `colourFor` (Task 2)
- Produces: `renderTracker(ctx, key: string, level: Level): HTMLElement`. Every change goes through `ctx.saver.schedule(key, level)`.

- [ ] **Step 1: Implement** `public/views/tracker.js`

```js
import { h } from '../dom.js';
import { setSlot, nextSelection, colourCounts, expectedPerColour } from '/shared/level.js';
import { colourFor } from '/shared/palette.js';

const SLOT_PX = 34;

export function renderTracker(ctx, key, initial) {
  let level = initial;
  let sel = null; // { jar, slot }
  const root = h('section', { class: 'tracker' });
  const isSel = (j, k) => sel?.jar === j && sel?.slot === k;

  function fill(value) {
    if (!sel) return;
    level = setSlot(level, sel.jar, sel.slot, value);
    if (value !== null) sel = nextSelection(level, sel);
    ctx.saver.schedule(key, level);
    draw();
  }

  async function remove() {
    if (!confirm(`Delete ${level.type} ${level.number}?`)) return;
    try {
      await ctx.saver.flush();
      await ctx.api.deleteLevel(key);
      ctx.go('/');
    } catch (e) {
      alert(`Couldn't delete: ${e.message}`);
    }
  }

  function draw() {
    const palette = ctx.activePalette();
    const counts = colourCounts(level);
    const expected = expectedPerColour(level);

    const jars = level.jars.map((jar, j) => h('div', { class: 'jar', style: { height: `${jar.capacity * SLOT_PX}px` } },
      jar.slots.map((s, k) => h('button', {
        class: `slot${s === null ? ' unknown' : ''}${isSel(j, k) ? ' selected' : ''}`,
        style: s === null ? {} : { background: colourFor(palette, s) },
        'aria-label': `Jar ${j + 1}, layer ${k + 1}: ${s === null ? 'unknown' : `colour ${s}`}`,
        onclick() { sel = isSel(j, k) ? null : { jar: j, slot: k }; draw(); },
      }, s === null ? '?' : String(s)))));

    // Match the game: up to 7 per row, split evenly across 2 rows when more.
    const perRow = jars.length > 7 ? Math.ceil(jars.length / 2) : jars.length;
    const rows = [jars.slice(0, perRow), jars.slice(perRow)].filter((r) => r.length)
      .map((r) => h('div', { class: 'jar-row', style: { gridTemplateColumns: `repeat(${perRow}, 1fr)` } }, r));

    const swatches = Array.from({ length: level.colourCount }, (_, i) => i + 1).map((id) => h('button', {
      class: 'swatch', style: { background: colourFor(palette, id) }, disabled: !sel,
      'aria-label': `Colour ${id}`, onclick: () => fill(id),
    }, h('span', { class: 'badge' }, expected ? `${counts[id]}/${expected}` : String(counts[id]))));

    root.replaceChildren(
      h('div', { class: 'bar' },
        h('a', { href: '#/' }, '← Levels'),
        h('h1', {}, `${level.type} ${level.number}`),
        h('select', { 'aria-label': 'Palette', onchange(e) { ctx.setActivePalette(e.target.value); draw(); } },
          ctx.state.palettes.map((p) => h('option', { value: p.id, selected: p.id === palette.id }, p.name)))),
      h('div', { class: 'jars' }, rows),
      h('div', { class: 'palette-bar' }, swatches,
        h('button', { class: 'swatch', disabled: !sel, 'aria-label': 'Clear layer', onclick: () => fill(null) }, '✕')),
      h('p', { class: 'muted' }, sel ? 'Pick a colour for the selected layer.' : 'Tap a layer, then a colour.'),
      h('div', { class: 'row' },
        h('a', { href: `#/level/${encodeURIComponent(key)}/setup` }, 'Edit layout'),
        h('button', { type: 'button', class: 'danger', onclick: remove }, 'Delete level')));
  }

  draw();
  return root;
}
```

- [ ] **Step 2: Check by hand**

Run: `npm start`, then open the level saved in Task 7.
Expected:
- Jars draw in 2 rows (5 + 4 for 9 jars), all showing `?`.
- Tap the top slot of jar 1, then colour 3: the slot fills, the selection moves one slot down, the badge reads `1/4`, and the status shows `saving…` then `saved`.
- Reloading the page shows the slot still filled.
- Switching the palette dropdown recolours the slots.
- With the server stopped, tapping a colour shows `offline – retrying`. After restarting the server, the status reaches `saved`, and a reload shows the change.
- "Edit layout", changing jar 1's capacity to 8, then Save shows a taller jar 1 with the filled slot kept.

- [ ] **Step 3: Commit**

```bash
git add public/views/tracker.js
git commit -m "feat: tracker view with palette bar and autosave"
```

---

### Task 9: Palette config view

**Files:**
- Modify: `public/views/palettes.js` (replace the stub)

**Interfaces:**
- Consumes: `ctx` (Task 6); `validatePalettes` (Task 2)
- Produces: `renderPalettes(ctx): HTMLElement`. It edits a draft copy; "Save palettes" PUTs the list and replaces `ctx.state.palettes`. Only the **last** colour of a palette can be removed (see Review Focus #2).

- [ ] **Step 1: Implement** `public/views/palettes.js`

```js
import { h } from '../dom.js';
import { validatePalettes } from '/shared/palette.js';

export function renderPalettes(ctx) {
  let list = structuredClone(ctx.state.palettes);
  let activeId = ctx.activePalette().id;
  const root = h('section', {});
  const msg = h('p', { class: 'muted' });

  function draw() {
    root.replaceChildren(
      h('div', { class: 'bar' }, h('a', { href: '#/' }, '← Levels'), h('h1', {}, 'Palettes'), h('span')),
      h('p', { class: 'muted' }, 'Colour numbers stay the same across palettes. Colour 3 is always "the third colour".'),
      list.map((p, pi) => h('fieldset', { class: 'palette' },
        h('div', { class: 'row' },
          h('input', { type: 'radio', name: 'active', checked: p.id === activeId, 'aria-label': `Use ${p.name}`, onchange() { activeId = p.id; } }),
          h('input', { type: 'text', value: p.name, maxlength: 40, 'aria-label': 'Palette name', oninput(e) { p.name = e.target.value; } }),
          h('button', { type: 'button', class: 'danger', disabled: list.length === 1, onclick() { list.splice(pi, 1); draw(); } }, 'Delete')),
        h('div', { class: 'colours' },
          p.colours.map((c, ci) => h('span', { class: 'colour-edit' },
            h('small', {}, String(ci + 1)),
            h('input', { type: 'color', value: c, 'aria-label': `Colour ${ci + 1}`, oninput(e) { p.colours[ci] = e.target.value; } }))),
          h('button', { type: 'button', disabled: p.colours.length === 1, 'aria-label': 'Remove last colour', onclick() { p.colours.pop(); draw(); } }, '−'),
          h('button', { type: 'button', disabled: p.colours.length >= 20, 'aria-label': 'Add colour', onclick() { p.colours.push('#888888'); draw(); } }, '+')))),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick() {
            const base = list.find((p) => p.id === activeId) ?? list[0];
            list.push({ id: `p-${Date.now().toString(36)}`, name: `${base.name} copy`, colours: [...base.colours] });
            draw();
          },
        }, '+ New palette'),
        h('button', { type: 'button', class: 'primary', onclick: save }, 'Save palettes')),
      msg);
  }

  async function save() {
    const problem = validatePalettes(list);
    if (problem) { msg.textContent = problem; return; }
    try {
      await ctx.api.putPalettes(list);
      ctx.state.palettes = structuredClone(list);
      ctx.setActivePalette(list.some((p) => p.id === activeId) ? activeId : list[0].id);
      msg.textContent = 'Saved.';
    } catch (e) {
      msg.textContent = `Couldn't save: ${e.message}`;
    }
  }

  draw();
  return root;
}
```

- [ ] **Step 2: Check by hand**

Run: `npm start`, then open `#/palettes`.
Expected:
- Press "+ New palette", rename it "Pastel", change colour 1, select its radio, and press "Save palettes". It shows "Saved.". Opening a level shows the new colour 1, and the dropdown lists both palettes.
- Reloading `#/palettes` keeps everything.
- Deleting is disabled when only one palette is left.
- `−` removes only the last colour.
- A level using more colours than the palette has shows grey swatches with their numbers.

- [ ] **Step 3: Commit**

```bash
git add public/views/palettes.js
git commit -m "feat: palette config view"
```

---

### Task 10: Deploy files and Hetzner rollout

**Files:**
- Create: `deploy/sand-tracker.service`, `deploy/nginx.conf.example`, `README.md`

**Interfaces:**
- Consumes: `server.js` env vars (Task 4)

- [ ] **Step 1: Write** `deploy/sand-tracker.service`

```ini
[Unit]
Description=Sand Tracker
After=network.target

[Service]
Type=simple
User=sandtracker
WorkingDirectory=/opt/sand-tracker
Environment=PORT=8787 HOST=127.0.0.1 DB_PATH=/var/lib/sand-tracker/sand.db
ExecStart=/usr/bin/env node --experimental-sqlite server.js
Restart=on-failure
StateDirectory=sand-tracker
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Write** `deploy/nginx.conf.example`

```nginx
# /etc/nginx/sites-available/sand-tracker. Replace sand.example.com.
# Then: certbot --nginx -d sand.example.com
server {
    listen 80;
    listen [::]:80;
    server_name sand.example.com;

    location / {
        auth_basic "Sand Tracker";
        auth_basic_user_file /etc/nginx/sand-tracker.htpasswd;
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 3: Write** `README.md`

````markdown
# Sand Tracker

Remembers revealed colours in blind sand-sort levels, per level, across restarts.
See `docs/spec.md`.

## Run locally

    npm test
    npm start            # http://localhost:8787

Needs Node ≥ 22.5. No npm dependencies.

## Deploy (Debian/Ubuntu + nginx)

    sudo useradd --system --no-create-home sandtracker
    sudo rsync -a --exclude data --exclude .git ./ /opt/sand-tracker/
    sudo cp deploy/sand-tracker.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now sand-tracker
    curl -s localhost:8787/api/palettes          # sanity check

    sudo htpasswd -c /etc/nginx/sand-tracker.htpasswd <user>   # apache2-utils
    sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/sand-tracker
    # edit server_name, then:
    sudo ln -s /etc/nginx/sites-available/sand-tracker /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d sand.<your-domain>

Data lives in `/var/lib/sand-tracker/sand.db`. Back it up by copying that file.

## Update

    sudo rsync -a --exclude data --exclude .git ./ /opt/sand-tracker/
    sudo systemctl restart sand-tracker
````

- [ ] **Step 4: Commit**

```bash
git add deploy/ README.md
git commit -m "docs: deploy files and README"
```

- [ ] **Step 5: Roll out to Hetzner (interactive, with the user)**

Ask the user for SSH access and the subdomain. On the box:
1. `node --version` must be ≥ 22.5. If it's older, install Node 22 LTS via NodeSource *after confirming with the user*.
2. Check for an existing `sand.` server block or port 8787 (`ss -ltnp | grep 8787`). Don't overwrite anything without asking.
3. Follow the README deploy steps.
4. Check: `curl -su <user>:<pass> https://sand.<domain>/api/palettes` returns JSON, and opening it on the phone prompts for login and then shows the picker.
5. User acceptance: fill in a blind level, restart it in the game, reopen it in Sand Tracker, and confirm the colours are there.
