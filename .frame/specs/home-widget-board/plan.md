# Plan — Home becomes a widget board

## Architecture

### Resolved plan-time decisions

**Business (asked)**

- **D1 · The rename happens in this spec.** `laneBoard.js` → `homeBoard.js`,
  new code under `src/renderer/home/`, `lane-board.css` → `home-board.css`.
  *Rationale:* the file is split apart by this work anyway; renaming later means
  a second pass over the same lines and a second layer of noise in the history.
  *Rejected:* keeping the name (a module holding no terminal keeps a terminal's
  name permanently); deferring it (the same lines edited twice).
  This **narrows a recorded decision** — the terminals-view convention of
  2026-08-20, *code says "lane", the UI says "Terminal"/"Home"*. Narrowed, not
  reversed: the convention governs **terminal** naming, and a board that no
  longer contains a terminal falls outside it. `laneStatus.js`,
  `laneDetailRail`, `#btn-lane-home` and the rest of the lane vocabulary are
  untouched. Recorded in `PROJECT_NOTES.md` as part of the final step.

**Technical (asked)**

- **D2 · Test posture — pure logic and data transforms only.** The two pieces of
  real logic (which agent lanes are listed and in what order; which sessions are
  shown and how they are labelled) move into dependency-free modules and get
  unit tests. DOM, mounting and wiring are not tested.
  *Rationale:* this is the convention the project already practises — the
  testing record's **Covered** line describes targeting the pure module and
  skipping its Electron-coupled wrapper (`telemetryEvents.js` is tested,
  `telemetry.js` is not). *Rejected:* no tests (a regression in the attention
  ordering would pass silently); a renderer harness (a new dependency and a
  setup cost outside this spec's subject, and one CI cannot install — C8).

**Technical (decided silently)**

- **D3 · The board subscribes; widgets never do.** A widget declares `sources`
  and receives data; it has no access to `ipcRenderer`. This makes C1
  structural rather than a rule an author has to remember.
- **D4 · `update()` is the only per-tick entry point.** `mount()` runs once and
  builds DOM; `update()` patches. A widget that rebuilds its subtree per tick
  violates the contract rather than the style guide (C1).
- **D5 · The tool selector is read and written through `aiToolSelector`'s
  existing exports, not relocated.** `setupSelector()` and `updateUI()` both
  guard with `if (!selector) return` (`aiToolSelector.js:42`, `:76`), so
  removing `#ai-tool-selector` from the top bar is already safe, and the module
  keeps `currentTool` fresh from `AI_TOOL_CHANGED` whoever called `SET_AI_TOOL`.
  Nothing in that file changes.
- **D6 · `isAvailable()` gates mounting, not content.** A widget returning false
  is not mounted and occupies no grid cell — distinct from a mounted widget
  showing an empty state.
- **D7 · Proceed against the in-flight perf spec.** `laneBoard.js` sits in
  `audit-q3-performance-resources`' footprint (phase `implementing`), but its
  only open task is **T10, a measurement pass that writes no code**. The same
  fork was resolved the same way by `terminals-home-agents` (its D1), with the
  user preferring the measurement to see the final design. No collision to plan
  around; T10 will measure the widget board.

### Constraints (C-IDs)

- **C1 — The IPC storm must stay fixed.** The `mount()`/`update()` split and the
  init-once listener guard are the remedy for the storm measured **2026-08-20**
  (~100 round-trips/sec, 163% CPU), recorded at `laneBoard.js:15-19` and
  `:96`. Both properties move into the contract: one subscription set owned by
  `homeData`, and `update()` as the only per-tick call.
  `multiTerminalUI._renderBoardView` (`:656`) keeps the matching host guard.
- **C2 — Home's board is a singleton and stays one.** `LaneBoard._instance` and
  `_dataListenersBound` exist because a second construction would stack a second
  listener set. `homeData` inherits both properties.
- **C3 — The `!malformed` filter travels with the spec subscription.** A spec
  whose folder cannot be read is not an active spec. It lives in `homeData`'s
  `specs` source so no widget can forget it.
- **C4 — Session ids are validated before reaching a command line.**
  `resumeClaudeSession` enforces the UUID shape (`agentDispatch.js:331`) and
  opens its own terminal rather than typing into a focused one — the failure
  `sessions-from-transcripts` fixed. The widget calls that function and adds no
  path of its own.
- **C5 — The `terminalsView` empty-state import dies with the Terminals card.**
  `laneBoard.js:40` borrows `EMPTY_TITLE` / `EMPTY_HINT` so Home and the
  Terminals section say the same thing about an empty project. With the card
  gone the import goes; the section keeps its own copy.
- **C6 — Home has no no-project widgets.** `_renderNoProjectState` stays as it
  is, ahead of the grid, and `isMountedIn`'s `!!this.cards ===
  !!state.currentProjectPath` invariant survives the refactor.
- **C7 — The renderer feedback discipline holds.** `audit-q3-ux-error-feedback`
  recorded it on this file (`laneBoard.js:38`, `:645`, `:649`): a user-triggered
  action that can fail routes its failure to `notify.error(...)`, never a bare
  console line or a silent return. Starting an agent and resuming a session are
  both such actions.
- **C8 — Tests may require nothing.** CI runs `npm test` with **no `npm ci`**
  (`.github/workflows/ci.yml:7`), so a test reaching into `node_modules` passes
  locally and fails in CI. `agentRows.js` and `sessionRows.js` must therefore
  require neither `electron` nor `lucide` nor `laneStatus` — they take plain
  data and return plain data.

### Components

**`homeData`** — one module, one subscription set, installed once behind the
existing guard. Exposes `subscribe(source, cb)`, `get(source)`,
`refresh(source)`. Sources: `lanes` (`state.terminals` + `laneStatus.onChange`),
`specs` (`SPEC_DATA` with `!malformed` + `onSpecLaneActivity`), `tasks`
(`TASKS_DATA` + `onTaskLaneActivity`), `git` (`GIT_STATUS_DATA`, for the
header), `sessions` (`LOAD_CLAUDE_SESSIONS` / `REFRESH_CLAUDE_SESSIONS`) and
`aiTool` (`GET_AI_TOOL_CONFIG` + `AI_TOOL_CHANGED`). The last two are new *to
Home*; both channels already exist, so this spec adds no IPC channel (S6).

**`registry`** — the ordered widget list plus `resolveLayout()`, which in this
pass returns registry order filtered by `isAvailable()`. It is the single seam
a future settings surface would write to.

**Widget contract** — `{ id, title, icon, sources, defaultSpan, defaultEnabled,
isAvailable(ctx), mount(el, ctx), update(data, ctx), dispose() }`. `id` is
stable and never derived from the title, so a stored layout cannot break when a
title changes. `span` exists now so a future full-width widget needs no second
layout mechanism.

**`homeBoard`** — what remains of `laneBoard.js`: host lifecycle
(`mount`/`update`/`isMountedIn`), the header, the no-project state, the shell
menu, and the loop that mounts widgets and routes source updates to them.
`_card()` becomes the shared `widgetShell()` the widgets call.

**`agentRows`** *(pure)* — given lanes and their statuses, returns rows to draw:
keep `agent-working` / `agent-approval` / `agent-input`, drop `idle` /
`running`, sort approval → input → working. That order is what
`laneStatus.js`'s `ATTENTION_MARKS` already implies — the first two carry a
mark, the third does not.

**`sessionRows`** *(pure)* — given the session list, returns the top three by
last activity with their display fields (title, relative time, message count,
branch), and the panel's existing fallback when a session has no title.

**Widgets** — `agents`, `lastSessions`, `activeSpecs`, `activeTasks`. Specs and
Tasks are the existing `_updateSpecsCard` / `_updateTasksCard` bodies moved
verbatim behind the contract; their rendering is not redesigned here (G3, S4).

**Layout** — `.home-group`, `.home-group-title`, `.home-cards`,
`.home-cards-solo` and the `@container (max-width: 699px)` override
(`lane-board.css:73-115`) give way to one `.home-grid` on
`repeat(auto-fill, minmax(320px, 1fr))`; the `min-height: 232px` floor moves
from the group to the widget shell. Four widgets read as 2×2 wide and one
column narrow with no special case. Home becomes scrollable past four widgets —
intended, recorded in `spec.md` §4.3.

**Top bar** — `terminalTabBar._render()` drops `<select id="ai-tool-selector">`
(`:145`) and keeps `#sidebar-agent-launch` (`:149`) as a bare Start. Its click
handler in `index.js` is unchanged; only the markup shrinks.

### Coverage

| ID | Item | Owning section |
|---|---|---|
| G1 | Agents widget | Components → `agentRows`, Widgets · Seq 3 |
| G2 | Last Sessions widget | Components → `sessionRows`, Widgets · Seq 4 |
| G3 | Specs/Tasks carried over unchanged | Components → Widgets · Seq 1 |
| G4 | Terminals card removed | Components → Layout · Seq 2 |
| G5 | Flat grid, no group headings | Components → Layout · Seq 2 |
| G6 | Widget contract + registry | Components → contract, `registry` · Seq 1 |
| G7 | Single data layer | Components → `homeData` · Seq 1 |
| G8 | Launcher split (bare Start / selector in widget) | D5, Components → Top bar · Seq 3 |
| G9 | Rename to `homeBoard` | D1 · Seq 5 |
| C1–C8 | Constraints | Constraints (C-IDs) |
| S1 | Four widgets, one grid, no Terminals card | Seq 2 |
| S2 | Agents filtered, ordered, row enters lane, empty = launcher | Seq 3 + `test/homeRows.test.js` |
| S3 | Three sessions, one click resumes | Seq 4 + `test/homeRows.test.js` |
| S4 | Specs and Tasks unchanged | Seq 1 |
| S5 | A fifth widget = one file + one registry line | Components → `registry` · proven by Seq 3–4 |
| S6 | No new IPC channel; no widget touching `ipcRenderer` | D3, Components → `homeData` |

## Files

**New**
- `src/renderer/home/homeData.js` — the single subscription layer
- `src/renderer/home/registry.js` — widget list and layout resolution
- `src/renderer/home/widgetShell.js` — the card shell, extracted from `_card()`
- `src/renderer/home/agentRows.js` — pure: agent-lane filter and attention order
- `src/renderer/home/sessionRows.js` — pure: top three sessions and their fields
- `src/renderer/home/widgets/agents.js` — start an agent, list running ones
- `src/renderer/home/widgets/lastSessions.js` — three resumable Claude sessions
- `src/renderer/home/widgets/activeSpecs.js` — the existing Specs card, moved
- `src/renderer/home/widgets/activeTasks.js` — the existing Tasks card, moved
- `src/renderer/homeBoard.js` — the host, from `laneBoard.js`
- `src/renderer/styles/components/home-board.css` — from `lane-board.css`
- `test/homeRows.test.js` — covers `agentRows` and `sessionRows`

**Modified**
- `src/renderer/multiTerminalUI.js` — the require (`:24`) and `_renderBoardView` (`:656`)
- `src/renderer/terminalTabBar.js` — the tool `<select>` leaves `_render()`
- `src/renderer/styles/main.css` — the stylesheet import (`:69`)
- `src/renderer/styles/components/terminals-view.css` — the stale `lane-board.css` reference (`:54`)

**Deleted**
- `src/renderer/laneBoard.js` — replaced by `homeBoard.js` plus `home/`
- `src/renderer/styles/components/lane-board.css` — replaced by `home-board.css`

**Deliberately untouched:** `aiToolSelector.js` (D5), `laneStatus.js`,
`agentDispatch.js`, `statusBar.js`, `index.js`, `notify.js`.

## Footprint

- src/renderer/laneBoard.js
- src/renderer/homeBoard.js
- src/renderer/home/homeData.js
- src/renderer/home/registry.js
- src/renderer/home/widgetShell.js
- src/renderer/home/agentRows.js
- src/renderer/home/sessionRows.js
- src/renderer/home/widgets/agents.js
- src/renderer/home/widgets/lastSessions.js
- src/renderer/home/widgets/activeSpecs.js
- src/renderer/home/widgets/activeTasks.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalTabBar.js
- src/renderer/styles/components/lane-board.css
- src/renderer/styles/components/home-board.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/main.css
- test/homeRows.test.js

## Dependencies

None. Every channel the widgets need already exists (`LOAD_CLAUDE_SESSIONS`,
`REFRESH_CLAUDE_SESSIONS`, `GET_AI_TOOL_CONFIG`, `SET_AI_TOOL`,
`AI_TOOL_CHANGED`, `SPEC_DATA`, `TASKS_DATA`, `GIT_STATUS_DATA`), and C8 rules
out adding a test dependency.

## Sequencing

1. **The seam.** `homeData`, `registry`, `widgetShell`, and the widget contract;
   the existing Specs and Tasks cards move onto it as `activeSpecs` /
   `activeTasks` with their rendering unchanged. Home still shows two groups and
   the Terminals card — nothing user-visible changes, everything structural
   does. Carries C1, C2, C3, C6.
2. **The layout.** Groups and headings out, `.home-grid` in; the Terminals card,
   its tile grid and their wiring (`_buildTerminalsCard`,
   `_updateTerminalsCard`, `_wireTerminalTiles`, the `home-tile*` rules,
   `MAX_TILES`) deleted along with the `terminalsView` empty-state import (C5).
   Home is now three widgets in a flat grid.
3. **Agents.** `agentRows.js` with its cases in `test/homeRows.test.js` — shell
   lanes excluded, the three agent statuses kept, ordering approval → input →
   working, empty in / empty out — then `widgets/agents.js` (rows enter their
   lane, the empty state is the launcher, the tool selector reads and writes
   through `aiToolSelector`, failures go to `notify.error` per C7), then the
   `<select>` leaves `terminalTabBar._render()`. In that order, so the selector
   never disappears before its replacement exists.
4. **Last Sessions.** `sessionRows.js` with its cases in `test/homeRows.test.js`
   — at most three, newest first, the panel's existing fallback for a session
   with no title — then `widgets/lastSessions.js`, including `isAvailable()`
   returning false under a non-Claude default tool (D6) and resume routed
   through `resumeClaudeSession` (C4) with `notify.error` on failure (C7).
5. **The rename.** `laneBoard.js` → `homeBoard.js`, `lane-board.css` →
   `home-board.css`, the import in `main.css` and the stale comment in
   `terminals-view.css`, and the `PROJECT_NOTES.md` entry recording D1. Last, so
   a bisect across steps 1–4 reads against familiar filenames.
