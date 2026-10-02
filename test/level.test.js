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

test('resizeLayout follows source indices when a middle jar is removed', () => {
  // remove jar 2 (index 1): new jar 2 must carry old jar 3's slots
  const out = resizeLayout(sample(), [4, 4], 3, [0, 2]);
  assert.deepEqual(out.jars[0].slots, [1, 2, 3, null]);
  assert.deepEqual(out.jars[1].slots, [null, null, null, null]); // old jar 3 was empty
  const out2 = resizeLayout(sample(), [4, 4], 3, [1, null]);
  assert.deepEqual(out2.jars[0].slots, [3, 3, null, null]);       // old jar 2 moved up
  assert.deepEqual(out2.jars[1].slots, [null, null, null, null]); // brand-new jar
});
