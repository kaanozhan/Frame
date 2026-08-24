# Outcome — decisions-view

Shipped 2026-08-24. Live-verified across ten steps + 311 tests pass, no
page errors.

## What shipped

- **Overview is gone**: no sidebar item, no palette entry, no center mode.
  `overviewPanel.js` deleted along with 376 lines of overview CSS; the
  tab bar's dead `onOverviewToggle` / `setOverviewActive` pair removed.
- **Decisions is a center view** (`decisionsView.js`): all 53 entries of
  this project's PROJECT_NOTES.md, newest first, as date + title rows.
  Clicking one expands its full body rendered as markdown; clicking again
  collapses it. Only the clicked row repaints, so expanding does not scroll
  the reader away from where they were. Search filters date + title + body
  and the count reads `5 / 53` while filtered. Prose is capped at 900px for
  line length; the header carries Refresh.
- **Structure map got its own sidebar item** (user's choice): opens the
  existing overlay, and `structureMap.init()` moved from `overviewPanel`
  to `multiTerminalUI`, which is where the map's lifetime now belongs.
- **Main**: `overviewManager.js` → `projectInsights.js` (git mv, history
  preserved) holding what outlived the dashboard — decisions + per-file git
  history for the map. `loadOverview` / `loadStructure` / `loadTasks` /
  `loadStats` and their helpers deleted (~200 lines).
- **`loadDecisions` rewritten**: was a title+date regex capped at 10; now a
  heading walk that takes each entry's body up to the next `#`/`##`/`###`
  and returns every one. Deeper headings (`####`) stay inside the body.

## IPC delta (deliberate, three lines)

- `LOAD_DECISIONS` added.
- `LOAD_OVERVIEW` removed — its only caller was the deleted screen.
- `OVERVIEW_DATA` removed — already unreferenced before this spec.
- Everything else untouched: 139 channels before, 139 after.

STRUCTURE.json's channel list was pruned by hand: `update-structure.js`
merges channels and never removes them, so it still carried the two dead
overview entries (141 vs the real 139).

## Verified live

nav shows Decisions + Structure · opens with 53 rows, nav item highlights ·
row expands to rendered markdown (1145 chars, real `<p>`/`<ul>`) · collapses ·
search "palette" → `5 / 53` · nonsense search → "No match" · Structure item
opens the map (120 nodes), Esc closes it · palette has "Go to Decisions" and
"Open Structure Map" · leaving for Terminals disposes the view. No pageerrors.
