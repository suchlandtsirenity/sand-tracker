// Level data rules, shared by server and browser. Pure functions only.
// Slots are ordered bottom → top; each is a colour ID (1-based) or null (unknown/empty).

export const TYPES = ['normal', 'special'];
export const MAX_JARS = 14;
export const MAX_CAPACITY = 12;
export const MAX_COLOURS = 14;
export const MAX_LEVEL_NUMBER = 999999;

const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function levelKey(type, number) {
  return `${type}:${number}`;
}

export function parseKey(key) {
  const m = /^(normal|special):([1-9]\d{0,5})$/.exec(key);
  return m ? { type: m[1], number: Number(m[2]) } : null;
}

export function newLevel(type, number, capacities, colourCount) {
  return {
    type, number, colourCount,
    jars: capacities.map((capacity) => ({ capacity, slots: Array(capacity).fill(null) })),
  };
}

export function validateLevel(level) {
  if (!level || typeof level !== 'object') return 'level must be an object';
  if (!TYPES.includes(level.type)) return 'type must be normal or special';
  if (!isInt(level.number, 1, MAX_LEVEL_NUMBER)) return `number must be 1–${MAX_LEVEL_NUMBER}`;
  if (!isInt(level.colourCount, 1, MAX_COLOURS)) return `colourCount must be 1–${MAX_COLOURS}`;
  if (!Array.isArray(level.jars) || !isInt(level.jars.length, 1, MAX_JARS)) return `need 1–${MAX_JARS} jars`;
  for (const [i, jar] of level.jars.entries()) {
    if (!jar || !isInt(jar.capacity, 1, MAX_CAPACITY)) return `jar ${i + 1}: capacity must be 1–${MAX_CAPACITY}`;
    if (!Array.isArray(jar.slots) || jar.slots.length !== jar.capacity) return `jar ${i + 1}: slots must match capacity`;
    for (const s of jar.slots) {
      if (s !== null && !isInt(s, 1, level.colourCount)) return `jar ${i + 1}: slot must be empty or 1–${level.colourCount}`;
    }
  }
  return null;
}

// Re-shape a level, keeping the bottom slots of each jar that still fit.
export function resizeLayout(level, capacities, colourCount) {
  return {
    ...level,
    colourCount,
    jars: capacities.map((capacity, i) => {
      const old = level.jars[i]?.slots ?? [];
      const slots = Array.from({ length: capacity }, (_, s) => {
        const v = old[s] ?? null;
        return v !== null && v <= colourCount ? v : null;
      });
      return { capacity, slots };
    }),
  };
}

export function colourCounts(level) {
  const counts = Array(level.colourCount + 1).fill(0);
  for (const jar of level.jars) for (const s of jar.slots) if (s !== null) counts[s]++;
  return counts;
}

// Units per colour when every jar has the same capacity; unknown otherwise.
export function expectedPerColour(level) {
  const caps = new Set(level.jars.map((j) => j.capacity));
  return caps.size === 1 ? [...caps][0] : null;
}

export function setSlot(level, jarIndex, slotIndex, value) {
  return {
    ...level,
    jars: level.jars.map((jar, i) => (i !== jarIndex ? jar : {
      ...jar,
      slots: jar.slots.map((s, k) => (k === slotIndex ? value : s)),
    })),
  };
}

// After filling a slot, select the next layer down: in blind levels that's
// the next one revealed. At the bottom, clear the selection.
export function nextSelection(level, sel) {
  return sel.slot > 0 ? { jar: sel.jar, slot: sel.slot - 1 } : null;
}
