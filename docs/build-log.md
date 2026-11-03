# Build log

How Sand Tracker went from [spec](spec.md) to deployed, kept as the build
went. The [implementation plan](superpowers/plans/2026-10-02-sand-tracker.md)
split the work into 10 tasks; each was built by an AI agent from a written
brief, tested, and committed before the next started. This is the ledger that
tracked it, tidied for reading.

## Before building: interface checks

Each task's plan lists what it consumes from earlier tasks and what it
produces. These were checked against each other before any code was written,
so no task would be built against an interface that didn't exist.

| From → to | Interface | |
|---|---|---|
| T1 → T3 | `parseKey(key) → {type, number} \| null` | match |
| T2 → T3 | `DEFAULT_PALETTES` | match |
| T1/T2/T3 → T4 | `openDb` API, `validateLevel`, `validatePalettes` | match |
| T5 → T6 | `createSaver({save, onStatus})`, `flush`, `peek` | match; T6's app.js uses `peek` |
| T6 → T7/8/9 | view context `{api, saver, state, activePalette, setActivePalette, go}` | match; T8 uses `saver.schedule`/`flush` |
| T1 → T7/T8 | `resizeLayout`, `newLevel`, `setSlot`, `nextSelection`, `colourCounts`, `expectedPerColour` | match |

## Tasks

| Task | Commits | Result |
|---|---|---|
| 1. Level data model, validation, resize | `ab619b6` | tests pass |
| 2. Palette validation, colour lookup | `d460db4` | tests pass |
| 3. SQLite storage | `3e0190b` | tests pass |
| 4. HTTP server and API | `0592a5b` | tests pass |
| 5. Debounced, retrying save queue | `b3f94f9` | tests pass |
| 6. Client shell, router, level picker | `f9f1a23` | tests pass; checked in headless Chrome (picker text, error message, routing) |
| 7. Level layout setup view | `67a5b39` | tests pass |
| 8. Tracker view, palette bar, autosave | `bedce65` | tests pass; checked headless: fill and advance, badge, reload persistence, offline → retry → saved, resize keeps data |
| 9. Palette config view | `71c09c4` | tests pass |
| 10. Deploy files and README | `7ce507e` | done; rolled out to the server afterwards |

## Rulings

Judgment calls made where the plan was silent or wrong. Each one names what it
would cost if the call turned out wrong.

- **Task 1:** `.superpowers/` (the agents' scratch workspace) is gitignored.
  *Cost if wrong:* none.
- **Task 6:** the picker form uses `novalidate`, because the browser's own
  min/max check blocked the app's message and iOS validation bubbles are
  unreliable. *Cost if wrong:* none, since the app validates itself.
- **Task 6:** the level number input is full width; 6em was cramped on a phone.
  *Cost if wrong:* cosmetic.
- **Task 9:** the plan passed an array straight to `replaceChildren`, which
  rendered as `[object HTMLFieldSetElement]`. Spread it instead. Found by the
  headless check; the plan had no DOM unit-test harness. *Cost if wrong:* none.
- **Task 10:** the deploy `rsync` also excludes `.superpowers`, so the scratch
  workspace never ships. *Cost if wrong:* none.
- **Task 10:** the service runs on a private Node 22 in
  `/opt/sand-tracker/node`, because the server's system Node 18 is shared with
  other apps. *Cost if wrong:* one folder to delete.

## Final review

A fresh reviewer agent, with no context from the build, reviewed the whole
diff: **0 critical, 5 important, 6 minor.**

All five important findings were fixed (`a384b35`):

1. **Removing a jar shifted the colours of the jars after it.** Fixed with a
   test that failed before the fix and passes after
   (`resizeLayout follows source indices…`); suite 38/38; checked headless.
2. **Palette swatches had no ID label.** UI only; checked headless that labels
   1–9 show.
3. **The setup screen's save could race a stale entry in the save queue.**
   Setup now goes through the queue (`schedule` + `flush`); covered by the
   save-queue tests.
4. **A deleted level came back**, because a pending save re-created it. Fixed
   with a failing-then-passing test (`discard drops a pending change…`); suite
   38/38; checked headless that the level returns 404 after delete.
5. **The palette editor could save stale defaults.** The route now refetches
   palettes; checked headless.

The six minor findings were written down and deliberately deferred:

- `route()` waits for `flush`, so it can hang behind a stuck request.
- Overlapping `route()` calls aren't guarded.
- Permanent 4xx save errors are retried forever, shown as "offline".
- No `keepalive` on the save request when the page is hidden.
- The 413 (body too large) test is lenient.
- The `#status` label overlaps the palette select.
