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
