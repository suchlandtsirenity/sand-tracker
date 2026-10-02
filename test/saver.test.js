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
