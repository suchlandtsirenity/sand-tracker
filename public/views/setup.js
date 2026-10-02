import { h } from '../dom.js';
import { parseKey, newLevel, resizeLayout, validateLevel, MAX_JARS, MAX_CAPACITY, MAX_COLOURS } from '/shared/level.js';

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export function renderSetup(ctx, key, existing) {
  const { type, number } = parseKey(key);
  // Each row remembers which existing jar it came from, so removing a middle jar keeps the right colours.
  let jars = existing
    ? existing.jars.map((j, i) => ({ capacity: j.capacity, from: i }))
    : Array.from({ length: 9 }, () => ({ capacity: 4, from: null }));
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
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_JARS, value: jars.length,
          onchange(e) {
            const n = clampInt(e.target.value, 1, MAX_JARS);
            jars = Array.from({ length: n }, (_, i) => jars[i] ?? { capacity: jars.at(-1)?.capacity ?? 4, from: null });
            draw();
          },
        }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick() { jars = jars.map((j) => ({ ...j, capacity: 4 })); draw(); } }, 'Standard (all 4)'),
        h('button', { type: 'button', disabled: jars.length >= MAX_JARS, onclick() { jars.push({ capacity: jars.at(-1)?.capacity ?? 4, from: null }); draw(); } }, '+ Add jar')),
      h('ol', { class: 'jar-list' }, jars.map((jar, i) => h('li', {},
        'Capacity ',
        h('input', {
          type: 'number', inputmode: 'numeric', min: 1, max: MAX_CAPACITY, value: jar.capacity, 'aria-label': `Jar ${i + 1} capacity`,
          onchange(e) { jar.capacity = clampInt(e.target.value, 1, MAX_CAPACITY); draw(); },
        }),
        ' ',
        h('button', { type: 'button', disabled: jars.length === 1, 'aria-label': `Remove jar ${i + 1}`, onclick() { jars.splice(i, 1); draw(); } }, '×')))),
      err,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: save }, 'Save layout')));
  }

  async function save() {
    const caps = jars.map((j) => j.capacity);
    const level = existing
      ? resizeLayout(existing, caps, colourCount, jars.map((j) => j.from))
      : newLevel(type, number, caps, colourCount);
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
