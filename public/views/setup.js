import { h } from '../dom.js';
import { parseKey, newLevel, resizeLayout, validateLevel, suggestColourCount, MAX_JARS, MAX_CAPACITY, MAX_COLOURS } from '/shared/level.js';

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export function renderSetup(ctx, key, existing) {
  const { type, number } = parseKey(key);
  // Each row remembers which existing jar it came from, so removing a middle jar keeps the right colours.
  // Default matches a standard level: 2 rows of 7, last 2 jars empty.
  let jars = existing
    ? existing.jars.map((j, i) => ({ capacity: j.capacity, from: i, empty: Boolean(j.empty) }))
    : Array.from({ length: 14 }, (_, i) => ({ capacity: 4, from: null, empty: i >= 12 }));
  let colourCount = existing?.colourCount ?? suggestColourCount(jars);
  const newJar = () => ({ capacity: jars.at(-1)?.capacity ?? 4, from: null, empty: false });

  // Any jar change re-derives the colour count (uniform levels only); typing a count overrides it.
  function changed() {
    colourCount = suggestColourCount(jars) ?? colourCount;
    draw();
  }
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
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_JARS, value: jars.length,
          onchange(e) {
            const n = clampInt(e.target.value, 1, MAX_JARS);
            jars = Array.from({ length: n }, (_, i) => jars[i] ?? newJar());
            changed();
          },
        }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick() { jars = jars.map((j) => ({ ...j, capacity: 4 })); changed(); } }, 'Standard (all 4)'),
        h('button', { type: 'button', disabled: jars.length >= MAX_JARS, onclick() { jars.push(newJar()); changed(); } }, '+ Add jar')),
      h('ol', { class: 'jar-list' }, jars.map((jar, i) => h('li', {},
        'Capacity ',
        h('input', {
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_CAPACITY, value: jar.capacity, 'aria-label': `Jar ${i + 1} capacity`,
          onchange(e) { jar.capacity = clampInt(e.target.value, 1, MAX_CAPACITY); changed(); },
        }),
        ' ',
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: jar.empty, onchange(e) { jar.empty = e.target.checked; changed(); } }),
          ' empty'),
        ' ',
        h('button', { type: 'button', disabled: jars.length === 1, 'aria-label': `Remove jar ${i + 1}`, onclick() { jars.splice(i, 1); changed(); } }, '×')))),
      err,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: save }, 'Save layout')));
  }

  async function save() {
    const level = existing ? resizeLayout(existing, jars, colourCount) : newLevel(type, number, jars, colourCount);
    const problem = validateLevel(level);
    if (problem) { err.textContent = problem; return; }
    // Through the save queue, so this replaces any older pending change for the
    // level instead of racing it. Offline, it stays queued and keeps retrying.
    ctx.saver.schedule(key, level);
    await ctx.saver.flush();
    ctx.go(`/level/${encodeURIComponent(key)}`);
  }

  draw();
  return root;
}
