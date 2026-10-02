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
