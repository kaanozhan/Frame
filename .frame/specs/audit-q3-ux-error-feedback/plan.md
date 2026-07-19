# Plan — UX & error-feedback hardening

## Architecture

### Resolved plan-time decisions

- **Enter in confirm modals — respect the focused button** (asked, business).
  Enter activates whichever modal button has focus; initial focus is placed on
  **Cancel** so a blind Enter is safe. Chosen over "Enter always cancels"
  because it is standard platform behavior while still making the destructive
  path require an explicit choice.
- **Naming reconciliation — document the split, no rename** (asked, business).
  Keep "lane" in code/module/DOM-id vocabulary per the recorded 2026-06-11
  decision (PROJECT_NOTES.md "Naming: Mainframe & Frames"); UI vocabulary stays
  "Frame"/"Home". The rule is written down as an explicit convention (header
  comment in `laneBoard.js`, the module most affected) instead of drifting.
  A PROJECT_NOTES.md decision entry is appended at meta-reconciliation time —
  not by the spec worker, which never touches meta files.
- **Parked buttons — remove the DOM, keep the palette commands** (asked,
  business). Delete `#parked-project-actions` from `index.html`.
  `project.initializeFrame` already calls `state.initializeAsFrameProject()`
  directly and stays as-is. `ai.startSession` currently proxies a click on the
  hidden **disabled** `#btn-start-ai` (effectively a no-op); its handler body
  (`src/renderer/index.js:255`) is extracted into a named function that the
  command calls directly.
- **Module layout — `notify.js` + `htmlUtils.js` in `src/renderer/`** (asked,
  technical). Two focused CommonJS modules matching the flat one-concern-per-
  file renderer layout. `src/shared/` keeps holding only cross-process
  constants; the DOM-adjacent helpers stay renderer-side.
- **Boot failure — renderer-only timeout state** (asked, technical). Main
  always replies to `LOAD_WORKSPACE` with `WORKSPACE_DATA`
  (`src/main/workspace.js:203`) and has no error variant, so the renderer's
  failsafe timeout is the trigger. No new IPC channels — respects the
  keep-channels-intact constraint.
- **Toast baseline = the tasksPanel variant** (silent, per the consolidate-
  don't-fork constraint): body-mounted, icon + message, single toast at a time
  (a new toast replaces the existing one), 4000 ms for errors / 2000 ms
  otherwise (`src/renderer/tasksPanel.js:412` behavior).
- **One shared toast CSS block** (silent, required by the shared component):
  a single `.app-toast` component in `panels.css` replaces the triplicated
  `.tasks-toast` / `.plugins-toast` / `.github-toast` blocks. Visual style is
  carried over, not redesigned.
- **All 20 `escapeHtml` copies are consolidated** (silent): the audit listed
  15, but the evidence pass found 20 definitions — including `sampleBanner.js`,
  `terminalGrid.js`, `laneBoard.js`, `terminalTabBar.js`, and
  `agentDispatch.js:541`. The success criterion is "exactly one helper", so
  all of them migrate.
- **Terminal-create call-sites get try/catch *and* a falsy-check** (silent).
  `terminalManager.createTerminal` returns `null` at the per-project cap but
  **rejects** on backend failure (`src/renderer/terminalManager.js:291-302`),
  so today a backend failure is an unhandled promise rejection. Both routes
  surface via `notify.error(...)` with distinct messages (cap reached vs.
  create failed).

### Shared notification module — `src/renderer/notify.js` (New)

CommonJS (`module.exports = { error, success, info }`), same
`require('electron')`-era pattern as every other renderer module. Behavior is
lifted from `tasksPanel.showToast`:

- Mounts a single `.app-toast` element on `document.body`; a new call removes
  any existing toast first.
- Message is inserted via `textContent` (never `innerHTML` interpolation) —
  this fixes the unescaped tasksPanel toast message
  (`src/renderer/tasksPanel.js:398`) by construction.
- Icon per type (reuses the existing `getToastIcon` shape), `visible` class
  animation, 4000 ms error / 2000 ms otherwise, 300 ms fade-out.

The four existing implementations (`tasksPanel.js:386`, `githubPanel.js:411`,
`pluginsPanel.js:426`, `agentDispatch.js:600`) are deleted and their ~29 call
sites re-pointed at `notify.*`.

### Shared escape helper — `src/renderer/htmlUtils.js` (New)

`module.exports = { escapeHtml }`, string-replace implementation
(`& < > " '`) so it has no DOM dependency and behaves identically for every
current call pattern. All 20 local definitions are deleted; each consumer adds
one `require`.

### Error-surfacing standard

Every user-triggered awaited create/write in the audited files routes failure
to `notify.error(...)` — never a bare `console.error` or an empty branch:

- The four terminal-create sites (`laneBoard._createLane`,
  `terminalTabBar._createLane`, `multiTerminalUI._detailRailCallbacks.onNewLane`,
  `multiTerminalUI._newLaneInCell`) wrap the call and handle both the `null`
  (cap) and rejection (backend) routes.
- The `TASK_UPDATED` handler (`src/renderer/tasksPanel.js:89-93`) gets a
  `success:false` branch: `notify.error(...)` naming the failed action
  (create/update/delete). The success path is unchanged (data arrives
  separately via `TASKS_DATA`).

### Confirm-modal focus discipline

Both `taskConfirmModal.js` and `taskRunModal.js`:

- `open()` sets initial focus on the **Cancel** button.
- The Enter keydown handler activates `document.activeElement` when it is one
  of the modal's buttons; when focus is anywhere else in the modal (or lost),
  Enter falls back to **cancel** — the safe default. The existing
  branch-name-input exemption in `taskRunModal` is preserved.
- Esc behavior is untouched.

### Boot-failure state — `appLoader.js`

When the 10 s failsafe fires with `firstDataArrived === false`, instead of
silently hiding (`src/renderer/appLoader.js:33-35`), the loader swaps its
content to a failure state: "Couldn't load your workspace" + a **Retry**
button that re-sends `IPC.LOAD_WORKSPACE` (same channel `projectListUI.js:93`
uses) and re-arms the failsafe. The existing `WORKSPACE_DATA` listener already
hides the loader on success, so retry needs no new wiring. Styles live in the
existing `app-loader.css`.

## Files

- **New** — `src/renderer/notify.js`: shared toast module (`error/success/info`).
- **New** — `src/renderer/htmlUtils.js`: shared `escapeHtml`.
- **Modified** — `src/renderer/tasksPanel.js`: drop local `showToast`/`getToastIcon`/`escapeHtml`; wire `TASK_UPDATED` failure branch to `notify.error`.
- **Modified** — `src/renderer/githubPanel.js`: drop local `showToast`/`escapeHtml`; require shared modules.
- **Modified** — `src/renderer/pluginsPanel.js`: drop local `showToast`/`escapeHtml`; require shared modules.
- **Modified** — `src/renderer/agentDispatch.js`: drop `_showToast`/`_escapeHtml`; require shared modules.
- **Modified** — `src/renderer/laneBoard.js`: create-failure toast in `_createLane`; drop `_escapeHtml`; naming-convention header comment.
- **Modified** — `src/renderer/terminalTabBar.js`: create-failure toast in `_createLane`; drop `_escapeHtml`.
- **Modified** — `src/renderer/multiTerminalUI.js`: create-failure toasts in `onNewLane` callback and `_newLaneInCell`.
- **Modified** — `src/renderer/taskConfirmModal.js`: Cancel-first focus + focused-button Enter.
- **Modified** — `src/renderer/taskRunModal.js`: Cancel-first focus + focused-button Enter.
- **Modified** — `src/renderer/appLoader.js`: failsafe failure state + Retry.
- **Modified** — `src/renderer/index.js`: remove parked-button wiring; extract start-AI handler into a named function; `ai.startSession` calls it directly.
- **Modified** — `index.html`: delete the `#parked-project-actions` block.
- **Modified** — `src/renderer/styles/components/panels.css`: one `.app-toast` block replaces `.tasks-toast`/`.plugins-toast`/`.github-toast`.
- **Modified** — `src/renderer/styles/components/app-loader.css`: failure-state styles.
- **Modified** — `escapeHtml` consumers swapping local copies for `require('./htmlUtils')`: `src/renderer/overviewPanel.js`, `src/renderer/terminalGrid.js`, `src/renderer/laneDetailRail.js`, `src/renderer/taskRunModal.js`, `src/renderer/cheatSheet.js`, `src/renderer/commandPalette.js`, `src/renderer/taskSection.js`, `src/renderer/welcomeOverlay.js`, `src/renderer/specSection.js`, `src/renderer/structureMap.js`, `src/renderer/specsDashboard.js`, `src/renderer/specPanel.js`, `src/renderer/sampleBanner.js`, `src/renderer/laneRail.js`.

## Footprint

- src/renderer/notify.js
- src/renderer/htmlUtils.js
- src/renderer/tasksPanel.js
- src/renderer/githubPanel.js
- src/renderer/pluginsPanel.js
- src/renderer/agentDispatch.js
- src/renderer/laneBoard.js
- src/renderer/terminalTabBar.js
- src/renderer/multiTerminalUI.js
- src/renderer/taskConfirmModal.js
- src/renderer/taskRunModal.js
- src/renderer/appLoader.js
- src/renderer/index.js
- index.html
- src/renderer/styles/components/panels.css
- src/renderer/styles/components/app-loader.css
- src/renderer/overviewPanel.js
- src/renderer/terminalGrid.js
- src/renderer/laneDetailRail.js
- src/renderer/cheatSheet.js
- src/renderer/commandPalette.js
- src/renderer/taskSection.js
- src/renderer/welcomeOverlay.js
- src/renderer/specSection.js
- src/renderer/structureMap.js
- src/renderer/specsDashboard.js
- src/renderer/specPanel.js
- src/renderer/sampleBanner.js
- src/renderer/laneRail.js

## Dependencies

None.

## Sequencing

1. **Create `src/renderer/htmlUtils.js`** with the shared `escapeHtml`;
   migrate all 20 defining files to `require` it and delete every local copy.
   Pure mechanical consolidation, no behavior change.
2. **Create `src/renderer/notify.js`** (tasksPanel-baseline behavior,
   `textContent` message) and the unified `.app-toast` CSS in `panels.css`;
   migrate `tasksPanel`, `githubPanel`, `pluginsPanel`, and `agentDispatch`
   call sites to `notify.*`; delete the four local implementations and the
   three per-panel toast CSS blocks.
3. **Wire the four terminal-create sites** (`laneBoard.js`,
   `terminalTabBar.js`, `multiTerminalUI.js` ×2) with try/catch + falsy-check
   routed to `notify.error` — distinct messages for the per-project cap
   (`null`) and backend failure (rejection).
4. **Wire the `TASK_UPDATED` failure path** in `tasksPanel.js`:
   `success:false` → `notify.error` naming the failed action; success branch
   unchanged.
5. **Fix confirm-modal Enter/focus** in `taskConfirmModal.js` and
   `taskRunModal.js`: initial focus on Cancel, Enter activates the focused
   modal button, safe-cancel fallback, branch-name-input exemption preserved.
6. **Add the boot-failure state** in `appLoader.js` + `app-loader.css`:
   failsafe with no data swaps the splash to "couldn't load workspace" with a
   Retry that re-sends `LOAD_WORKSPACE` and re-arms the failsafe.
7. **Remove `#parked-project-actions`** from `index.html`; in
   `src/renderer/index.js` extract the start-AI click handler into a named
   function called by `ai.startSession`; add the naming-convention header
   comment to `laneBoard.js`.
8. **Verification sweep**: grep the audited files for remaining
   `console.error`-only failure handling on user-triggered create/write
   actions and for any leftover `escapeHtml`/`showToast` definitions; fix
   stragglers.
