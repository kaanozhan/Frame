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
## T04 — Fold per view: open in Projects, folded elsewhere, each view remembers

Added `workspaces/listPrefs.js` with `test/workspaceListPrefs.test.js`, `workspaceSection.setView(view)` called from `revealSidebarTab` in `index.js`, and a fold button in the header that saves each view's state to localStorage `frame-ws-list-open`; folded, the header shows the selected workspace's dot and branch and "N waiting" in the most urgent colour. Beyond the task text: `listPrefs.parse` does the tolerant read, and the list is shown while an inline rename is open even in a folded view. Not seen running.

_Captured: 2026-11-18 · 5 file change(s)_

---
## T05 — Eight-row cap: the list scrolls inside itself

Capped `.ws-list` at eight rows with its own scroll in `workspaces.css` (one `--ws-row-height` variable drives the cap and the rows' height) and, in `workspaceSection.js`, kept the scroll position across redraws and added `revealRow`, which brings the selected row into view when the selection changes or the list unfolds. `revealRow` sets the list's own `scrollTop` rather than calling `scrollIntoView`, so the sidebar around it never moves. Rows with a second line are taller, so such a list scrolls a little before eight; not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T06 — Server foot rows: no Add server row, one Connect row while no server is saved

Removed the "Add server…" row from the list in `workspaceSection.js` and replaced the three-line no-server offer with one "Connect a server…" row that opens the Servers dialog on its add field; the explanation line became that row's tooltip. Server sub-headers, their Connect / Set up action and their empty states are untouched. Dropped `.ws-add-server` and its last companion `.ws-new-key` from `workspaces.css`; not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T07 — Archive dialog: one Archived N row instead of an archive that unfolds in place

Replaced the unfolding Archived section in `workspaceSection.js` with one "Archived N" row that opens a dialog (records in the order main returns them, a filter over branch, name and host, a self-scrolling list, Restore per row via `restoreWorkspace`), and styled both in `workspaces.css`. Deviations: the dialog's markup is built in JS on first use because the plan limits `index.html` to its comment, a successful restore closes the dialog, and `restoreWorkspace` now returns whether it succeeded. Not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T08 — Palette picker and the two workspace commands

Added `pick({ placeholder, items })` to `commandPalette.js`, `selectById`, `goToNextWaiting` and `switchItems` to `workspaceSection.js`, and registered `workspace.switch` and `workspace.nextWaiting` in `index.js` without shortcuts. Deviations: the picker reimplements the registry's subsequence match locally (it is not exported and `commandRegistry.js` is outside the plan), and `switchItems()` is a fifth entry point that keeps the urgency ordering beside the attention queue. Not seen running.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T09 — Status bar slot face: named scope, filled while an agent waits

Added `workspaces/otherProjects.js` (`group`, `slotFace`) with `test/otherProjectsAgents.test.js`, made `statusBar.updateAgents` use it, and rendered the slot as "Other projects · N agents[ · M waiting]": an outlined chip that fills with `--error` for approval or `--warning-ink` for input in `status-bar.css`. `group` already accepts a names map for T10 and gives each project an `agentCount`; the old count and pill rules were removed. Not seen running, so the chip's look per theme is unchecked.

_Captured: 2026-11-18 · 4 file change(s)_

---
## T10 — Popover by workspace, and landing on the agent's workspace

Grouped the status bar popover in `statusBar.js` by project, workspace, then agents (ids at once, names from `WORKSPACES_LIST` on open, cached while open), exported `rememberWorkspace` from `state.js`, added `workspaceSection.whenLoaded(projectPath)` (resolves on load, or after 2 seconds), and made `_focus` remember the agent's workspace, switch project, await the load, select the workspace and then `enterLane`. `_focus` also gives up when the user changes project while it waits, and a project that starts running agents while the popover is open shows ids until it is reopened. Not seen running: the cross-project landing is the least exercised path of this spec.

_Captured: 2026-11-18 · 4 file change(s)_

---
