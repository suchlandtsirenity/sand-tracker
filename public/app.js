import { api } from './api.js';
import { createSaver } from './saver.js';
import { h } from './dom.js';
import { parseKey } from '/shared/level.js';
import { DEFAULT_PALETTES } from '/shared/palette.js';
import { renderPicker } from './views/picker.js';
import { renderSetup } from './views/setup.js';
import { renderTracker } from './views/tracker.js';
import { renderPalettes } from './views/palettes.js';

const view = document.getElementById('view');
const statusEl = document.getElementById('status');
const STATUS_TEXT = { pending: '…', saving: 'saving…', saved: 'saved', offline: 'offline – retrying' };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const state = { palettes: DEFAULT_PALETTES, activePaletteId: lsGet('activePalette'), lastType: 'normal' };

const saver = createSaver({
  save: (key, level) => api.putLevel(key, level),
  onStatus: (s) => { statusEl.textContent = STATUS_TEXT[s]; statusEl.dataset.state = s; },
});

const ctx = {
  api,
  saver,
  state,
  activePalette: () => state.palettes.find((p) => p.id === state.activePaletteId) ?? state.palettes[0],
  setActivePalette(id) { state.activePaletteId = id; lsSet('activePalette', id); },
  go(path) {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  },
};

async function route() {
  await saver.flush();
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  let el;
  try {
    if (parts[0] === 'level' && parts[1]) {
      const key = decodeURIComponent(parts[1]);
      if (!parseKey(key)) return ctx.go('/');
      const level = saver.peek(key) ?? await api.getLevel(key);
      el = parts[2] === 'setup' || !level ? renderSetup(ctx, key, level) : renderTracker(ctx, key, level);
    } else if (parts[0] === 'palettes') {
      // Fresh copy: saving replaces the whole list, so never edit stale or fallback palettes.
      state.palettes = await api.getPalettes();
      el = renderPalettes(ctx);
    } else {
      el = renderPicker(ctx, await api.listLevels());
    }
  } catch (err) {
    el = h('section', {}, h('p', { class: 'error' }, `Couldn't load: ${err.message}`), h('a', { href: '#/' }, '← Levels'));
  }
  view.replaceChildren(el);
  scrollTo(0, 0);
}

try { state.palettes = await api.getPalettes(); } catch { /* keep defaults offline */ }
addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saver.flush();
});
route();
