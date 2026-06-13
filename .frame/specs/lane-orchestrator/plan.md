# Plan — Lane Orchestrator — home screen for terminals as lanes

## Architecture

### View model: three modes replace two

`terminalManager.viewMode` currently holds `'tabs' | 'grid'` and
`multiTerminalUI._onStateChange` branches on it. This becomes
`'board' | 'detail' | 'grid'`, default **`'board'`**:

- **`board`** — the Lane Orchestrator home screen, rendered by a new
  `laneBoard.js` component into `multiTerminalUI`'s existing
  `contentContainer` (same full-content-swap pattern `showOverview()` already
  uses in `multiTerminalUI.js`).
- **`detail`** — exactly today's `_renderTabView`: one mounted terminal via
  `manager.mountTerminal()`. Renamed internally to `_renderDetailView`; the
  mount/remount logic, scroll button and `_mountedTerminalId` optimization
  are kept as-is.
- **`grid`** — unchanged (`terminalGrid.js` untouched). Entered from the
  board; leaving grid returns to `board`, not to a tab view.

Navigation API on `MultiTerminalUI`:
`enterLane(terminalId)` (sets active + viewMode `detail`),
`goHome()` (viewMode `board`), `showGrid()` / `exitGrid()`.

Auto-create is retired: the `autoCreateInitialTerminal` block in
`multiTerminalUI._setup()` goes away (the flag and its `createTerminal` call
are deleted; `terminal.js#startTerminal()` is already a no-op). On launch the
board renders, showing the empty state if there are no lanes.

Session restore (`terminalManager.restoreProjectSession`) persists
`viewMode` in localStorage — restore maps legacy `'tabs'` to `'detail'` when
an active terminal exists, else `'board'`.

The board is **project-scoped**, same as every terminal surface today
(`getTerminalStates()` filters by `currentProjectPath`). Switching projects
re-renders the board with that project's lanes.

### Lane status engine (`laneStatus.js`)

A renderer-side singleton, no main-process or IPC changes. Data shape:

```js
// Map<terminalId, { status: 'processing'|'waiting'|'idle',
//                   lastActivityAt: number, quietTimer: Timeout }>
```

Mechanics:

1. Subscribes to `IPC.TERMINAL_OUTPUT_ID` with its own
   `ipcRenderer.on` listener (parallel to `terminalManager._setupIPC`'s —
   no coupling needed; both already receive every chunk).
2. **Output chunk arrives** → status `processing`, `lastActivityAt = now`,
   restart a per-terminal quiet timer (~1.5–2 s). Chunks during `processing`
   only reset the timer — zero parsing cost while output is flowing.
3. **Quiet timer fires** → classify once by reading the last ~15 lines of the
   xterm buffer (`manager.getTerminal(id).terminal.buffer.active`,
   `translateToString()`):
   - waiting patterns → `waiting`: Claude Code input box (`╭─` frame with
     `│ >` line), permission/confirm prompts (`❯`-style selector lines,
     `(y/n)`, `Do you want`, `Esc to cancel`). Pattern list lives in one
     exported table so other AI tools can extend it later.
   - otherwise → `idle` (shell at prompt; "completed" reads as idle +
     last-activity time, per spec).
4. Emits `onChange(terminalId, statusEntry)` callbacks, **throttled to max
   ~2 updates/sec per terminal**, consumed by the board and the lane
   switcher. Terminal close (`TERMINAL_DESTROYED` / `closeTerminal`) clears
   the entry and timer.

`laneStatus` needs the manager to read buffers: `laneStatus.init(manager)`
called from `multiTerminalUI._setup()`.

### Lane board (`laneBoard.js`)

Follows the `specsDashboard.js` component idiom (module-level state, `init`/
`render`, card grid), but renders into the `contentContainer` it's given
rather than a fixed overlay — the board is a view mode, not an overlay.

Card content (metadata only, no xterm mount): lane name, project folder name,
status badge (`processing` pulsing dot / `waiting` warning color / `idle`
muted), relative last-activity time ("2m ago", ticked by a 30 s interval
while board is visible), AI-tool indicator when the lane was started via
`terminalCreateAndStart`/start-AI flow (best-effort: a `launchedTool` field
set on the terminal state by those flows). Card actions: click → enter lane;
rename (pencil icon → inline input, reuses `manager.renameTerminal`);
close (×, confirm not needed — same semantics as today's tab close).
Final card is **"+ New Lane"**: click opens the existing shell-select menu
(reused from the tab bar's shell menu), creates the terminal, then
`enterLane(newId)`. Empty state: icon + one-liner + "Create your first lane"
CTA per `task-prod-empty-states` style.

Board subscribes to `manager.onStateChange` (already fired on create/close/
rename) plus `laneStatus.onChange` for badge/time updates.

### Top bar rework (`terminalTabBar.js` repurposed)

The file keeps its name and class (spec: internal naming stays); the tabs
strip is replaced by a mode-aware left section:

- **board mode:** static "Lanes" label + lane count.
- **detail mode:** home button (⌂, runs `goHome()`) + **lane switcher
  dropdown**: current lane name + status dot + chevron; opens a menu listing
  every lane with status badges (menu plumbing copied from the existing
  `_createMoreMenu`/`_showMoreMenu` pattern in the same file). Click → 
  `enterLane(id)`.
- **grid mode:** home button + "Grid" label + existing `grid-layout-select`.

The right-side action cluster (usage bars, + new terminal & shell menu,
update bell, tasks toggle, more menu) is kept verbatim — it just stops being
"tab bar furniture" and becomes the persistent top bar. The
`btn-view-toggle` becomes a board/grid affordance: in board mode it shows
"Grid"; in detail it's hidden (grid is entered from the board). Tab-specific
code (`update()`'s tab rendering, `_startRename` on tabs, tab context menu)
is removed; rename moves to the board card and the switcher menu's context
menu.

### Shortcuts & commands (`index.js` registry)

- `terminal.next` / `terminal.prev` (`Ctrl+Tab` / `Ctrl+Shift+Tab`) and
  `terminal.switch.N` (`Cmd+1-9`) keep their bindings but route through
  `enterLane()` — so from the board or grid they jump straight into that
  lane's detail.
- New `lane.home` — "Back to Lanes" — `CmdOrCtrl+Escape`. Requires one
  addition to the `attachCustomKeyEventHandler` passlist in
  `terminalManager._initializeTerminal` (`modKey && key === 'escape'` →
  pass to app) so it works while the terminal has focus.
- `terminal.toggleGridView` becomes `lane.toggleGrid`: board ↔ grid.
- `terminal.new` (`Cmd+Shift+T`) creates a lane and enters it.
- Cheat sheet / palette pick these up automatically via the registry.

### Programmatic terminal consumers

Flows that push commands into "the active terminal" must behave when the
user is on the board:

- `btn-start-ai` (`index.js`) and `window.terminalCreateAndStart`
  (`terminal.js`) already create + activate a terminal → they additionally
  call `enterLane(newId)` (one line each via `getMultiTerminalUI()`).
- `window.terminalSendCommand` / `RUN_COMMAND` from the menu target
  `activeTerminalId`, which stays valid while on the board (board doesn't
  clear the active lane). Sending a command auto-enters that lane so the
  user sees the effect: a small `_revealActiveLane()` hook in
  `multiTerminalUI.sendCommand`.
- If no lane exists at all, `sendCommand` falls back to creating one first
  (covers task ▶ / spec commands on a fresh project).

## Files

- **New** `src/renderer/laneBoard.js` — board view: card grid, empty state,
  new-lane card, rename/close actions.
- **New** `src/renderer/laneStatus.js` — per-terminal activity engine
  (processing/waiting/idle), quiet-timer + buffer classification, throttled
  change events.
- **New** `src/renderer/styles/components/lane-board.css` — board grid,
  cards, status badges, empty state (imported from `main.css`).
- **Modified** `src/renderer/multiTerminalUI.js` — three view modes,
  navigation API (`enterLane`/`goHome`/grid), drop auto-create, wire
  laneBoard + laneStatus, `_revealActiveLane` in `sendCommand`.
- **Modified** `src/renderer/terminalManager.js` — viewMode values/default,
  legacy `'tabs'` session migration, `Cmd+Esc` passlist entry, optional
  `launchedTool` state field.
- **Modified** `src/renderer/terminalTabBar.js` — tabs strip → mode-aware
  left section (Lanes label / home + switcher dropdown); remove tab render,
  tab rename, tab context menu; keep action cluster and shell/more menus.
- **Modified** `src/renderer/terminal.js` — `terminalCreateAndStart` +
  `restartTerminal` enter the lane after creation.
- **Modified** `src/renderer/index.js` — command rebinds (`lane.home`,
  `lane.toggleGrid`, switch-N via `enterLane`), btn-start-ai enters lane.
- **Modified** `src/renderer/styles/components/terminal.css` — remove
  `.terminal-tab` styles, add top-bar left-section styles.
- **Modified** `src/renderer/styles/main.css` — import `lane-board.css`.
- **Modified** `STRUCTURE.json` — via `npm run structure` after
  implementation (pre-commit hook also covers it).

No `index.html` changes expected: the board renders inside the existing
`#terminal` container through `multiTerminalUI`.

## Dependencies

None. (lucide icons, xterm, existing IPC channels all already present.)

## Sequencing

1. **Status engine first** — add `laneStatus.js` + manager passlist tweak;
   expose statuses on `getTerminalStates()` consumers via the onChange API.
   Verify in DevTools console with a running Claude session: badge values
   flip processing → waiting → idle correctly. No visible UI change yet.
2. **Board view, read-only** — `laneBoard.js` + CSS + `'board'` view mode in
   `multiTerminalUI`; launch lands on board (auto-create removed); cards
   show metadata + live badges; click enters detail; `Cmd+Esc`/home returns.
   Tab bar still renders tabs at this step (harmless duplication, keeps the
   app usable mid-migration).
3. **Board actions** — "+ New Lane" with shell menu, card rename, card
   close, empty state.
4. **Top bar rework** — replace tabs strip with mode-aware left section +
   lane switcher dropdown; delete tab rendering/rename/context-menu code and
   `.terminal-tab` CSS.
5. **Shortcuts & integrations** — registry rebinds (`lane.home`,
   `lane.toggleGrid`, switch-N → `enterLane`); grid entered/exited via
   board; `terminalCreateAndStart` / `restartTerminal` / `sendCommand`
   reveal the lane; session `viewMode` migration.
6. **Cleanup & docs** — remove `'tabs'` remnants, `npm run structure`,
   update PROJECT_NOTES.md keyboard-shortcut table if touched, manual pass
   over success criteria 1–8 in spec.md.

Each step builds and runs on its own (`npm run build:renderer && npm start`).
