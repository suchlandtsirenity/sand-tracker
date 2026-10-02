import { h } from '../dom.js';
import { setSlot, nextSelection, colourCounts, expectedPerColour } from '/shared/level.js';
import { colourFor, colourName, shortName } from '/shared/palette.js';

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
      await ctx.saver.flush();    // let any in-flight save land first…
      ctx.saver.discard(key);     // …then drop queued changes so they can't resurrect it
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

    const jars = level.jars.map((jar, j) => (jar.empty
      // Starts empty: nothing to discover, so nothing to tap.
      ? h('div', { class: 'jar empty', style: { height: `${jar.capacity * SLOT_PX}px` }, 'aria-label': `Jar ${j + 1}: empty` })
      : h('div', { class: 'jar', style: { height: `${jar.capacity * SLOT_PX}px` } },
      jar.slots.map((s, k) => h('button', {
        class: `slot${s === null ? ' unknown' : ''}${isSel(j, k) ? ' selected' : ''}`,
        style: s === null ? {} : { background: colourFor(palette, s) },
        'aria-label': `Jar ${j + 1}, layer ${k + 1}: ${s === null ? 'unknown' : colourName(palette, s) || `colour ${s}`}`,
        onclick() { sel = isSel(j, k) ? null : { jar: j, slot: k }; draw(); },
      }, s === null ? '?' : shortName(palette, s))))));

    // Match the game: up to 7 per row, split evenly across 2 rows when more.
    const perRow = jars.length > 7 ? Math.ceil(jars.length / 2) : jars.length;
    const rows = [jars.slice(0, perRow), jars.slice(perRow)].filter((r) => r.length)
      .map((r) => h('div', { class: 'jar-row', style: { gridTemplateColumns: `repeat(${perRow}, 1fr)` } }, r));

    const swatches = Array.from({ length: level.colourCount }, (_, i) => i + 1).map((id) => h('div', { class: 'swatch-wrap' },
      h('button', {
        class: 'swatch', style: { background: colourFor(palette, id) }, disabled: !sel,
        'aria-label': colourName(palette, id) || `Colour ${id}`, onclick: () => fill(id),
      }, shortName(palette, id), h('span', { class: 'badge' }, expected ? `${counts[id]}/${expected}` : String(counts[id]))),
      h('small', {}, colourName(palette, id))));

    root.replaceChildren(
      h('div', { class: 'bar' },
        h('a', { href: '#/' }, '← Levels'),
        h('h1', {}, `${level.type} ${level.number}`),
        h('select', { 'aria-label': 'Palette', onchange(e) { ctx.setActivePalette(e.target.value); draw(); } },
          ctx.state.palettes.map((p) => h('option', { value: p.id, selected: p.id === palette.id }, p.name)))),
      h('div', { class: 'jars' }, rows),
      h('div', { class: 'palette-bar' }, swatches,
        h('div', { class: 'swatch-wrap' },
          h('button', { class: 'swatch', disabled: !sel, 'aria-label': 'Clear layer', onclick: () => fill(null) }, '✕'),
          h('small', {}, 'clear'))),
      h('p', { class: 'muted' }, sel ? 'Pick a colour for the selected layer.' : 'Tap a layer, then a colour.'),
      h('div', { class: 'row' },
        h('a', { href: `#/level/${encodeURIComponent(key)}/setup` }, 'Edit layout'),
        h('button', { type: 'button', class: 'danger', onclick: remove }, 'Delete level')));
  }

  draw();
  return root;
}
