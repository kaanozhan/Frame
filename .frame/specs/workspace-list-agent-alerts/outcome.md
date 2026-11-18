## T01 — Attention logic: the waiting queue of a project's agents

Added `src/renderer/workspaces/attention.js` (pure) with `waitingQueue`, `workspaceWait`, `othersWaiting`, `nextWaiting` and `waitLabel`, exported `bucketOf` from `workspaces/rollup.js` for it, and covered all five in `test/workspaceAttention.test.js`. Not in the plan's wording: a wait with no known start sorts last of its kind and labels as the kind alone, under a minute reads `<1m`, an hour or more reads in hours, and the agent name falls back to the terminal's name.
Followup: `test/structureRead.test.js:107` is flaky on the server host (same-tick rewrite), unrelated to this spec.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T02 — The open list: a Workspaces header and inline rows replace the trigger and dropdown

Replaced the trigger and floating menu in `workspaceSection.js` with a "Workspaces" header carrying `+` and an inline `.ws-list`; removed `triggerHtml`, `openDropdown`, `closeDropdown`, the outside-click and Escape handlers and `menuOpen`, and updated `workspaces.css` and the comment in `index.html`. Deviations: the selected row is filled with an accent label instead of a check mark (the trailing slot is T03's), the "Local" / "Remote" labels are gone as in the plan's Shape, the header keeps the `ws-switch` class because `tour/tourSteps.js` targets it, and a focused row keeps focus across redraws. Not seen running: no DOM harness, no display on this host.
Followup: the tour's Workspaces step still says "New workspace at the top of this list" (`src/renderer/tour/tourSteps.js`, outside this spec's footprint).

_Captured: 2026-11-18 · 3 file change(s)_

---
## T03 — Wait label on rows: which agent waits, on what, for how long

Added the trailing wait label (`approval · 2m`, agent name in the tooltip, before ⋯) to workspace rows and the main row in `workspaceSection.js` from `attention.workspaceWait` and `waitLabel`, and a 30-second redraw that runs only while a label is on screen. Styled it in `workspaces.css` with `--error` and, for input, `--warning-ink` instead of plain `--warning`, because that is the theme's text-safe warning colour. Not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
