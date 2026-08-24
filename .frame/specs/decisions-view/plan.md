# Plan — decisions-view

## Approach

**Main.** `overviewManager.js` is renamed `projectInsights.js` (git mv) —
with Overview gone it serves two unrelated-to-overview reads: decisions and
per-file git history for the structure map. Its overview loaders
(`loadOverview`, `loadStructure`, `loadTasks`, `loadStats`) and the
`LOAD_OVERVIEW` handler are removed. `loadDecisions` grows a body: the
regex scan becomes a walk that slices the text between one `### [date]`
heading and the next heading of the same or higher level, and the top-10
cap goes. New channel `LOAD_DECISIONS`; `LOAD_OVERVIEW`/`OVERVIEW_DATA`
deleted from the shared contract (nothing else references them).

**Renderer.** New `decisionsView.js` renders into the center container the
way `overviewPanel` did — a header (title, project, count, search input)
and a list of `<button>` rows (date + title + chevron). Clicking a row
toggles an expanded body rendered with `marked` (same sanitising wrapper
the spec views use). Search filters on date + title + body, case
insensitive, and reports how many rows matched.

`multiTerminalUI`'s `isOverviewVisible` / `showOverview` / `hideOverview` /
`toggleOverview` become the `Decisions` equivalents (same surface-parking
and nav-refresh discipline, since this render bypasses `_onStateChange`);
`structureMap.init()` moves here from `overviewPanel.init()`, and
`showStructureMap()` opens the overlay. The dead `onOverviewToggle` hook on
the tab bar goes.

Sidebar nav swaps the Overview entry for **Decisions** (`◈`) and adds
**Structure** (`◎`); the palette swaps "Go to Overview" for "Go to
Decisions" and "Open Structure Map".

Overview's CSS block in panels.css and `overviewPanel.js` are deleted;
`decisions-view.css` is added and imported from main.css.

## Footprint

- src/shared/ipcChannels.js
- src/main/overviewManager.js → src/main/projectInsights.js
- src/main/index.js
- src/renderer/decisionsView.js (new)
- src/renderer/overviewPanel.js (deleted)
- src/renderer/multiTerminalUI.js
- src/renderer/projectListUI.js
- src/renderer/paletteSources.js
- src/renderer/terminalTabBar.js
- src/renderer/styles/main.css
- src/renderer/styles/components/decisions-view.css (new)
- src/renderer/styles/components/panels.css
