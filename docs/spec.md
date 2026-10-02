# Sand Tracker — Design Spec

_2026-10-02_

## Purpose

A personal web tool for an Apple Arcade sand-sorting game. In **blind levels**
each colour is hidden until the layer above it is poured off, and restarting a
level forgets everything revealed. Sand Tracker remembers what has been revealed,
per level, across restarts and devices.

**Success:** after restarting a blind level in the game, opening that level in
Sand Tracker shows every colour revealed in earlier attempts.

## Scope

**In:** recording revealed colours per level; per-level jar layouts with
per-jar capacity; normal and special level numbering; swappable palettes and a
config screen to add/edit them; server-side storage synced across devices.

**Out (for now):** solver/hints, validation warnings, undo history, screenshot
import.

## Data model

Colours are stored as **colour IDs** (integers, 1-based), never as hex values.
A palette maps IDs to display colours, so switching palettes reskins every saved
level without changing data.

```jsonc
// Palette
{ "id": "default", "name": "Default", "colours": ["#e53935", "#1e88e5", ...] }
// colour ID n  →  colours[n - 1]

// Level
{
  "type": "normal",          // "normal" | "special"
  "number": 212,
  "colourCount": 9,          // how many colours are in play; slots may use any palette ID 1–20
  "jars": [
    { "capacity": 4, "slots": [3, 3, null, 1] },   // bottom → top; null = unknown
    { "capacity": 4, "slots": [null, null, null, null] },
    { "capacity": 8, "slots": [ ... ] }            // tall jar
  ]
}
```

- Level key: `"<type>:<number>"`, e.g. `normal:212`, `special:14`. Normal and
  special numbering never collide.
- `slots.length === capacity` always. An empty jar is `capacity` × `null`
  (treated as "unknown/empty", the tracker doesn't distinguish).
- Max 14 jars per level (2 rows of 7 in the game). Capacity is any integer 1–12.
- Rules for validating a level (`validateLevel`) live in one pure module shared
  by client and server.

## Screens (phone-first, single page)

1. **Level picker:** normal/special toggle, a number input, "Open". Shows a
   list of recently edited levels for quick access.
2. **Level setup:** shown when opening a level that hasn't been saved yet (and
   reachable later via "Edit layout"). Lets you set the jar count (1–14) and
   capacity per jar, with presets: "Standard (all 4)" and "+ Add jar (capacity
   N)". Also sets the colour count. Changing the layout keeps existing slot data
   where it still fits.
3. **Tracker:** jars drawn at heights matching their capacity, laid out in up to
   2 rows of 7. Tap a slot to select it, then tap a colour in the palette bar to
   fill it; there's a "clear" swatch to reset it. Each colour shows a
   found-count badge. When every jar has the same capacity, it shows the expected
   total too (e.g. "3/4"); with mixed capacities it shows only the found count.
   Mixed-capacity levels aren't blind in the game, so they're supported for
   completeness but aren't the main use. Saves automatically about 500 ms after
   each change.
4. **Palette config:** list palettes; add, rename, or delete them; edit colours
   with `<input type="color">`, add colours, and remove the last colour (removing one from the middle would shift later colour IDs in saved levels); choose the active
   palette. The active palette is remembered per device (localStorage); the
   palettes themselves are stored on the server.

## Server

- A single Node.js file (≥ 22), with no web framework. It uses the built-in
  `node:sqlite` module, so there are no npm dependencies.
- It serves static files from `public/`.
- API (JSON):
  - `GET /api/levels`: list `{key, type, number, updatedAt}`, newest first
  - `GET /api/levels/:key`: a level, or 404
  - `PUT /api/levels/:key`: validate and upsert; 400 on an invalid body
  - `DELETE /api/levels/:key`
  - `GET /api/palettes`, `PUT /api/palettes` (the whole list is replaced; at least
    one palette must remain)
- SQLite tables: `levels(key TEXT PRIMARY KEY, json TEXT, updated_at INTEGER)`,
  `settings(key TEXT PRIMARY KEY, json TEXT)` (palettes are stored under
  `palettes`). On first run, a default palette is seeded.
- Config comes from env vars: `PORT` (default 8787), `DB_PATH` (default
  `./data/sand.db`).

## Deploy (Hetzner)

- The code goes in `/opt/sand-tracker` and runs under a `systemd` service as a
  dedicated user, bound to `127.0.0.1:8787`.
- nginx gets a server block for `sand.<domain>` that proxies to it, protected
  with `auth_basic` (htpasswd) and served over TLS via certbot.
- On the server, `DB_PATH=/var/lib/sand-tracker/sand.db` (systemd StateDirectory). Backup is a copy of that file.

## Error handling

- The client shows a small "saved / saving / offline – retrying" indicator. If a
  save fails, it keeps the pending state in memory and retries with backoff,
  so nothing is lost when the connection drops mid-level.
- The server rejects malformed levels with a 400 and a message, and never
  crashes on bad input.

## Testing

- `node --test`: unit tests for `validateLevel` and the layout-resize logic, plus
  API round-trip tests (PUT → GET, list, 404, 400) against a temporary database.
- Manual check on a phone: fill in a level, reload, and confirm the colours
  persist; switch palettes and confirm the colours reskin.

## Future (designed for, not built)

- Validation hints (a colour appearing more than its expected count), then a
  solver. Both would read the same level JSON.
