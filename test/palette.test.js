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
