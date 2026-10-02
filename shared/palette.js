// Palettes map colour IDs (1-based) to display colours. Shared by server and browser.

export const FALLBACK_COLOUR = '#9e9e9e';
const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_PALETTES = [{
  id: 'default',
  name: 'Default',
  colours: [
    '#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1',
    '#d81b60', '#6d4c41', '#3949ab', '#7cb342', '#f4511e', '#546e7a', '#c0ca33',
  ],
}];

export function colourFor(palette, id) {
  return palette?.colours?.[id - 1] ?? FALLBACK_COLOUR;
}

// Optional per-palette names; names[i] goes with colours[i].
export function colourName(palette, id) {
  return palette?.names?.[id - 1]?.trim() ?? '';
}

// Slot label: first three letters of the name ("Pur"), or the ID if unnamed.
export function shortName(palette, id) {
  const name = colourName(palette, id);
  return name ? name[0].toUpperCase() + name.slice(1, 3) : String(id);
}

export function validatePalettes(list) {
  if (!Array.isArray(list) || list.length < 1) return 'need at least one palette';
  const ids = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') return 'palette must be an object';
    if (typeof p.id !== 'string' || !p.id || p.id.length > 40) return 'palette id must be 1–40 characters';
    if (ids.has(p.id)) return `duplicate palette id ${p.id}`;
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40) return 'palette name must be 1–40 characters';
    if (!Array.isArray(p.colours) || p.colours.length < 1 || p.colours.length > 20) return 'a palette needs 1–20 colours';
    if (!p.colours.every((c) => typeof c === 'string' && HEX.test(c))) return 'colours must look like #rrggbb';
    if (p.names !== undefined) {
      if (!Array.isArray(p.names) || p.names.length > p.colours.length) return 'names must be a list no longer than colours';
      if (!p.names.every((n) => typeof n === 'string' && n.length <= 20)) return 'colour names must be up to 20 characters';
    }
  }
  return null;
}
