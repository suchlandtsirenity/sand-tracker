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
    novalidate: true, // show our own message; iOS native validation bubbles are unreliable
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
