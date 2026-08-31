## T01 — homeData.js, the single subscription layer

Added `src/renderer/home/homeData.js` owning all six Home sources (`lanes`,
`specs`, `tasks`, `git`, `sessions`, `aiTool`) behind an idempotent `init()`,
exposing `subscribe`/`get`/`refresh` plus a host-only `setHostState()` that
feeds the terminal list in and re-fetches on project change. Two additions
beyond `plan.md`: `setAiTool()` and `reloadSessions()` live here rather than in
a widget, because S6 forbids a widget touching `ipcRenderer` and D5 named the
channels without saying who would call them. `laneBoard.js` is untouched so
far — T02–T04 move it onto this layer.

_Captured: 2026-08-27 · 1 file change(s)_

---
## T02 — registry.js and widgetShell.js, the widget contract

Added `src/renderer/home/registry.js` — the contract documented in full, the
ordered `WIDGETS` list, `resolveLayout()` and a `sourcesFor()` helper the board
will subscribe from — and `src/renderer/home/widgetShell.js`, the card shell
lifted from `LaneBoard._card()` with the header and footer made optional.
Deviation from `plan.md`: `WIDGETS` ships **empty**, because naming widget
modules before they exist would leave a commit that cannot be required; T03,
T07 and T10 each add their own line, which is the one-line cost S5 promises.
The shell keeps the `home-card*` class names verbatim so the existing
stylesheet still carries the cards until T04.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T03 — Specs and Tasks move onto the widget contract

Added `home/widgets/activeSpecs.js` and `activeTasks.js` carrying
`_updateSpecsCard` / `_updateTasksCard` / `_wireTaskCard` over verbatim,
registered both, and rewired `laneBoard.js` to resolve a layout, mount widgets
into the Project planning group and subscribe **once per source** instead of
once per card — which cost the board every `ipcRenderer` listener it had, and
with them the `electron` and `ipcChannels` imports. Two deviations from
`plan.md`: the shared card furniture (`statsHtml`/`tally`/`moreHtml`/
`MAX_ROWS`) went into `widgetShell.js` rather than a new module, keeping the
plan's Files list intact; and `_buildTerminalsCard` now calls `widgetShell()`
so `_card()` could be deleted here rather than shadow it until T05. Nothing
user-visible changed — still two groups, still the Terminals card.

_Captured: 2026-08-27 · 5 file change(s)_

---
## T04 — Flat `.home-grid` replaces the two-group layout

Replaced `.home-group` / `.home-group-title` / `.home-cards` /
`.home-cards-solo` and the `@container (max-width: 699px)` override with one
`.home-grid` on `repeat(auto-fill, minmax(320px, 1fr))`, moved the 232px floor
onto `.home-card`, and rewrote `mount()` to build a single grid — `_buildGroup`
is gone. `auto-fill` does what the container query did by hand, so the
responsive branch disappeared rather than being ported. Beyond `plan.md`: the
no-project branch now disposes the previous mount's widgets and clears
`_layout`, otherwise they keep live subscriptions and detached DOM behind the
no-project state.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T05 — The Terminals card and its tile machinery are gone

Deleted `_buildTerminalsCard` / `_updateTerminalsCard` / `_wireTerminalTiles` /
`MAX_TILES` / `_attentionRank`, the `laneStatus.onChange` refresh, the
`EMPTY_TITLE` / `EMPTY_HINT` borrow (C5) and 172 lines of `home-tile*` /
`.home-card-terminals` CSS with its two container queries — `laneBoard.js`
went 775 → 383 lines and now imports neither `laneStatus` nor `widgetShell`.
Deviation from C6: with no board-owned card left, `this.cards` held nothing,
so the mounted-with-a-project invariant is keyed on `this.gridEl` instead —
same guarantee, expressed by the thing that still exists. The shell menu kept
an opener by moving to the widget ctx as `showShellMenu()` rather than being
left dead.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T06 — agentRows.js, pure, with its tests

Added `src/renderer/home/agentRows.js` — filters `homeData`'s `lanes` to the
three agent statuses, shapes each into a row and orders them approval → input
→ working — and `test/homeRows.test.js` covering shell-lane exclusion, the
three statuses kept, the ordering fed in reverse so a no-op sort cannot pass,
empty in / empty out, and the row shape. Beyond the task: a recency tie-break
inside a status, because ordering is this module's whole job and three lanes
all working otherwise sat in arbitrary order. The test file's plain `require`
is itself half the check — grow an `electron` or `laneStatus` dependency here
and the suite stops loading (C8).

_Captured: 2026-08-27 · 2 file change(s)_

---
## T07 — The Agents widget

Added `home/widgets/agents.js`, registered first in the layout: rows from
`agentRows` enter their lane on click, and the card footer carries the tool
`<select>` plus Start — always, not only when empty, since the point of taking
it off the top bar (G8) is that it stays reachable while agents run. Divergence
from D5: the widget reads the tool from `homeData`'s `aiTool` source and writes
through `homeData.setAiTool` instead of invoking `SET_AI_TOOL` itself, because
D3/S6 forbid a widget touching `ipcRenderer` — `aiToolSelector` is still
unchanged and still owns `currentTool`. Start reuses
`agentDispatch.startDefaultAgent`; a rejected tool switch reverts the select
and calls `notify.error` (C7).

_Captured: 2026-08-27 · 3 file change(s)_

---
## T08 — The tool select leaves the top bar

Removed `<select id="ai-tool-selector">` from `terminalTabBar._render()`,
leaving `#sidebar-agent-launch` a bare Start with its id, class and `index.js`
handler untouched. Safe by D5 and checked rather than assumed:
`aiToolSelector.setupSelector()` (`:42`) and `updateUI()` (`:77`) both guard on
a missing element, so the module keeps `currentTool` fresh from
`AI_TOOL_CHANGED` with no DOM to write to. Followup: the
`.lane-bar-launcher .ai-tool-select` rule in `terminal.css` is now dead, but
that file is outside this plan's Files list so it was left as is.

_Captured: 2026-08-27 · 1 file change(s)_

---
## T09 — sessionRows.js, pure, with its tests

Added `src/renderer/home/sessionRows.js` — top three by last activity, the
panel's `summary → firstPrompt → "Untitled session"` fallback carried over
verbatim, and the fields a row draws — plus seven cases in
`test/homeRows.test.js`. Deviation from `plan.md`: the relative time is
computed here rather than left to the widget, because neither existing
formatter is reachable — `laneStatus`'s is banned by C8 and takes epoch
millis, the panel's is private to `pluginsPanel` — so this module carries its
own with an injectable `now`, which makes every time in the suite an assertion
instead of a race with the clock.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T10 — The Last Sessions widget

Added `home/widgets/lastSessions.js`, registered second: three rows carrying
title, relative time, message count and branch, each resuming through
`agentDispatch.resumeClaudeSession` — which validates the UUID before it
reaches a command line and opens its own terminal (C4) — with `notify.error`
on anything it cannot report itself (C7). `isAvailable()` returns false under a
non-Claude default tool, and true while the tool config is still in flight:
hiding a card while waiting on IPC is worse than showing one the next visit
removes. The footer calls `pluginsPanel.show()` with no argument, because that
function takes no tab; the row carries no Claude chip, as the user asked.

_Captured: 2026-08-27 · 3 file change(s)_

---
## T11 — laneBoard becomes homeBoard

`git mv` on both files, plus the exported class: `LaneBoard` → `HomeBoard`,
since a `homeBoard.js` exporting `LaneBoard` is the half-rename D1 warns
against. Updated the require and construction in `multiTerminalUI.js`, the
`@import` in `main.css`, the stale comment in `terminals-view.css` and the
module id in `scripts/intent-map.json`; regenerated `STRUCTURE.json`, which
now carries `renderer/homeBoard` with no phantom left behind. The
`.lane-board*` DOM classes stayed — D1 narrows the terminals-view convention
rather than reversing it, and the file header now records that in place of the
superseded 2026-08-20 paragraph. `PROJECT_NOTES.md` was left for the end of
the branch per the user's standing preference; T11's text does not name it.

_Captured: 2026-08-27 · 6 file change(s)_

---
## T08 — REVERSED (2026-09-01)

The tool select is back beside Start in the top bar. T08 removed it on the
grounds that "a rarely-changed default is not worth the top-bar width", with
Home's Agents widget carrying it instead. In use that traded a cheap glance for
a navigation: Start launches whatever the default is, and confirming which tool
that was meant leaving the terminal for Home. The width argument still holds —
it is simply the smaller cost of the two.

What T08 said about the mechanism was right and is what made the reversal
cheap: `aiToolSelector` guards on a missing `#ai-tool-selector`, and the
`.lane-bar-launcher .ai-tool-select` rule T08 knowingly left behind in
`terminal.css` was still there, so restoring the markup restored the styling
with no CSS work.

Home keeps its copy — this is a second view of one value, not a move back. Both
write through `SET_AI_TOOL` and both redraw from `AI_TOOL_CHANGED`, so neither
can show something the other contradicts.

One thing T08 did not have to handle: `terminalTabBar._render()` can run either
side of `init()`'s await on `GET_AI_TOOL_CONFIG`, so a select that exists only
after `init()` finished would never be populated. `aiToolSelector` now exports
`mountSelector()`, which `_render()` calls after appending — whichever of the
two lands second, the dropdown ends up correct.

_Reversed by: the user, 2026-09-01 · 2 file change(s)_

---
