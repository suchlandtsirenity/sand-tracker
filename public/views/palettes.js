import { h } from '../dom.js';
import { validatePalettes } from '/shared/palette.js';

// names[i] goes with colours[i]; pad with '' so the list never has holes.
function setName(p, i, name) {
  p.names ??= [];
  while (p.names.length < i) p.names.push('');
  p.names[i] = name;
}

export function renderPalettes(ctx) {
  let list = structuredClone(ctx.state.palettes);
  let activeId = ctx.activePalette().id;
  const root = h('section', {});
  const msg = h('p', { class: 'muted' });

  function draw() {
    root.replaceChildren(
      h('div', { class: 'bar' }, h('a', { href: '#/' }, '← Levels'), h('h1', {}, 'Palettes'), h('span')),
      h('p', { class: 'muted' }, 'Colour numbers stay the same across palettes. Colour 3 is always "the third colour".'),
      ...list.map((p, pi) => h('fieldset', { class: 'palette' },
        h('div', { class: 'row' },
          h('input', { type: 'radio', name: 'active', checked: p.id === activeId, 'aria-label': `Use ${p.name}`, onchange() { activeId = p.id; } }),
          h('input', { type: 'text', value: p.name, maxlength: 40, 'aria-label': 'Palette name', oninput(e) { p.name = e.target.value; } }),
          h('button', { type: 'button', class: 'danger', disabled: list.length === 1, onclick() { list.splice(pi, 1); draw(); } }, 'Delete')),
        h('div', { class: 'colours' },
          p.colours.map((c, ci) => h('span', { class: 'colour-edit' },
            h('small', {}, String(ci + 1)),
            h('input', { type: 'color', value: c, 'aria-label': `Colour ${ci + 1}`, oninput(e) { p.colours[ci] = e.target.value; } }),
            h('input', {
              type: 'text', value: p.names?.[ci] ?? '', maxlength: 20, placeholder: 'name', 'aria-label': `Colour ${ci + 1} name`,
              oninput(e) { setName(p, ci, e.target.value); },
            }))),
          h('button', {
            type: 'button', disabled: p.colours.length === 1, 'aria-label': 'Remove last colour',
            onclick() { p.colours.pop(); if (p.names) p.names.length = Math.min(p.names.length, p.colours.length); draw(); },
          }, '−'),
          h('button', { type: 'button', disabled: p.colours.length >= 20, 'aria-label': 'Add colour', onclick() { p.colours.push('#888888'); draw(); } }, '+')))),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick() {
            const base = list.find((p) => p.id === activeId) ?? list[0];
            list.push({ id: `p-${Date.now().toString(36)}`, name: `${base.name} copy`, colours: [...base.colours], ...(base.names && { names: [...base.names] }) });
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
