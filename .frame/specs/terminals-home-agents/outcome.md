# Outcome — Home, Terminals and Agents — three surfaces folded into one model

## T01 — Move the status vocabulary into `laneStatus.js`

Added a Presentation section to `laneStatus.js` holding one `STATUS_LABELS`
table (with a `short` override for the single word that differs), the new
`ATTENTION_MARKS`, and `statusLabel` · `attentionMark` · `cleanCommand` ·
`formatRelativeTime` · `assignmentIcon` · `assignmentText`. Pointed
`laneBoard.js` and `laneDetailRail.js` at them and deleted their local copies,
which collapses `laneBoard.STATUS_LABELS` and `laneDetailRail.STATUS_SHORT`
into one and drops the rail's import dependency on the board; `laneBoard` now
exports only `{ LaneBoard }`. Gave `statusLabel` an options object rather than
the plan's positional shape so the agent-name prefix is keyed off `agentName`
being passed instead of off `short` — the two call sites keep byte-identical
output (checked across 180 status/foreground/command/agent combinations), and
`_armQuietTimer` and the init-once guard are untouched.

_Captured: 2026-08-26 · 3 file changes_

---

## T02 — Add the tab strip to `terminalsView.js`

Split `render()` into a strip plus a body: `_renderOverview` is today's grid
untouched, `_renderSingle` is one terminal filling the section, and
`openTabs`/`activeTab` joined `cols`/`order` in the per-project prefs (D3).
Added `_normalizeTabs`, `_buildTabStrip` and the public
`openTab`/`closeTab`/`showOverview`/`getActiveTab`, gave `_buildPane` a
`{ single }` variant with no drag and no maximize control, and styled
`.tv-tabs` with `overflow-x: auto` so nine tabs scroll instead of truncating.
A closed terminal loses its tab through `_normalizeTabs` on the next render
rather than through a `TERMINAL_DESTROYED` listener — the prefs are already
normalised against the live set for `order`, and a second mechanism would be a
second source of truth. Both bodies mount their terminals every render (C1);
`maximizedId` stays until T03 takes it.

_Captured: 2026-08-26 · 2 file changes_

---

## T03 — The magnifier opens a terminal in its own tab

Turned the pane header's `data-maximize` into `data-open` with a `Search`
icon calling `openTab(id)`, and deleted `maximizedId` along with every branch
that read it: the render-time normalisation, the grid class and column
override, the shown-pane filter, the ghost-pane condition, the layout bar's
back-to-grid button, the rename's draggable restore, and the
`.tv-grid.maximized` / `.tv-pane.maximized` rules. Overview now always draws
every pane in `cols` columns, because the one-pane case is a tab rather than a
mode of the grid. Stale `maximizedId` keys already in localStorage fall out on
the next `_updatePrefs`, which spreads the new `_prefs()`.

_Captured: 2026-08-26 · 2 file changes_

---

## T04 — Retire the `detail` view mode

Deleted `terminalGrid.js` and every piece of the cell machinery in
`multiTerminalUI` (`_renderDetailView`, `_ensureAssignments`, `_assignCell`,
`_newLaneInCell`, `_cellAssignments`, `_detailRailCallbacks`, the
`TerminalGrid` and `laneDetailRail` imports), dropped `gridLayout` /
`setGridLayout` and the dead viewMode restore from `terminalManager`,
redefined `enterLane` as "open or focus this terminal's tab in the Terminals
section" and `isViewingFrame` per the plan — which fixes
`agentDispatch.js:251`, where Start never used the focused terminal because
the old definition answered false on the default view. Two deviations, both
forced: the top bar's layout select had to go **here** rather than in T05,
because it called the `setGridLayout` this task deletes and would otherwise
have left a broken intermediate commit; and `openTab` gained a
`{ render: false }` mode so `enterLane` writes the tab *before* switching
view mode and the section draws once. Also removed the CSS orphaned by the
deletions (`.grid-cell*`, `.grid-divider*`, `.grid-resizer*`,
`.detail-layout`, `.lane-menu`), and made the render dispatch's `else` branch
`_renderTerminalsView` so an unrecognised viewMode lands on the default
surface instead of a deleted one.

_Captured: 2026-08-26 · 7 file changes_

---

## T05 — Rebuild the top bar

Reduced `_renderLeftSection` to `Home` + a removable `Terminals` + the open
section chips, and deleted the per-terminal tabs, the presence container,
`onEnterFrames`/`onEnterLane`, `multiTerminalUI.enterFrames`,
`presenceBar.js` and the `.btn-lane-frame*` / `.btn-lane-frames*` /
`.presence-*` CSS. `terminalsInStrip` lives on `multiTerminalUI` and travels
in the state; `dropTerminalsFromStrip()` clears it while `showTerminals()` and
`enterLane()` both restore it (D11). Terminals reuses the section chip's
markup and CSS instead of getting its own, so the shared × keeps meaning "drop
from this strip" at both levels — the click handler branches on
`.lane-bar-terminals` first because the chip carries no section key. Dropping
Terminals while looking at it lands on Home; dropping it from Specs or a panel
leaves the user where they are.

Followup: the shell menu in `terminalTabBar` (`_createLane`, `_showShellMenu`,
`_getShellIcon`) is unreachable since the top bar's `+` retired — pre-existing
dead code, left alone as outside this spec's Files.

_Captured: 2026-08-26 · 6 file changes_

---

## T06 — Make the Overview pane header legible

Replaced the pane header's bare `· claude` with two elements drawn from the
shared vocabulary: `.tv-pane-attention` from `attentionMark(status)` and
`.tv-pane-status` from `statusLabel(status, { agentName, foreground,
commandLine, short: true })`, both kept live by the `laneStatus.onChange`
handler that was already updating the dot, and both coloured per status.
Putting the agent name inside the label rather than in a chip of its own makes
"claude · Needs approval" one string from one source — the same words the rail
shows. The marker span always renders and hides through `:empty`, so the live
updater only sets `textContent` instead of adding and removing nodes. No rail
work was needed in Overview: it has had none since `detail` retired in T04.

_Captured: 2026-08-26 · 2 file changes_

---

## T07 — The Other Terminals rail

`git mv`'d `laneDetailRail.js` to `otherTerminalsRail.js` and reworked it for
the single-terminal body: it lists the project's terminals minus the one on
screen, is closed by default (`isHidden` inverted, new storage key, and an
unreadable value falls back to closed), opens from a control that appears on
hover at the edge, and shows only approval and input in the collapsed strip —
one entry per waiting agent, replacing the two generic icons.
`terminalsView._renderSingle` hosts it and `multiTerminalUI` supplies
`onEnterLane`, so a row click still goes through the single choke point. Two
judgement calls: the rail renders nothing when there are no other terminals,
because a strip that opens onto an empty list is worse than no strip; and the
`active-lane` row highlight is gone, since the terminal it marked is by
definition never in this list. Collapse mechanics, the `.lane-rail` CSS and
the init-once subscribe guard (C5) are untouched.

_Captured: 2026-08-26 · 4 file changes_

---

## T08 — The sidebar chip and the status bar slot

Extracted `computeCounts(states)` out of `projectStatusBadges.recompute()`
and exported it; `recompute()` now feeds `projectListUI` and `statusBar` from
a single traversal inside the existing rAF debounce (C2). The sidebar `◆` chip
gained the attention colour, the shared attention mark and a tooltip naming
what is waiting — it calls `computeCounts` on this project's terminals rather
than reading the debounced `agentStatusMap`, so it is never a frame behind its
own `laneStatus` listener. `statusBar` fills the declared left slot with the
other-projects indicator in its three states, an upward hover menu grouped by
project (180ms open, 320ms close, and a `::after` strip bridging the gap so
the pointer never crosses dead space), and a row click that runs
`state.setProjectPath` then `enterLane` — the navigation `presenceBar` carried
before T05 deleted it. The menu's rows come from the same `states` array the
tally was computed from, so nothing is traversed twice.

_Captured: 2026-08-26 · 5 file changes_

---

## T09 — Home becomes the four-card project board

Rewrote `laneBoard.js` as Terminals / Orchestration / Specs / Tasks with a
`mount()`/`update()` split, and gave `_renderBoardView` the matching
idempotence guard (C2) — 20 consecutive `update()` calls build zero elements.
Deleted `laneRail.js` and moved its `SPEC_DATA`/`TASKS_DATA` subscriptions,
`!malformed` filter included (C6), into the board behind the init-once idiom
(C5). `isMountedIn` takes the state as well as the container, so a
project → no-project switch remounts instead of patching a board whose cards
do not exist. Two judgement calls: the Terminals card's action creates with the
default shell on click and offers the shell menu on right-click — the reverse
of the old new-lane card, but the spec asks for a *direct* action; and the
Tasks rows are static, since the dashboard is the surface that opens a task.
The orchestrator card's running badge moved out of `orchestrator.css` into
`.home-card-running`, and the per-terminal card CSS went with the cards.

_Captured: 2026-08-26 · 5 file changes_

---

## T10 — Finish the vocabulary sweep

Renamed the command registry's entries to `Go to Home`, `New Terminal`,
`Close Terminal`, `Next Terminal`, `Previous Terminal` and
`Switch to Terminal N` under a `Terminals` category, and swept the last
"Mainframe" / "Frames" / "Agent frame" strings out of the JS and the CSS
comments — the words now appear nowhere in the codebase.
`Go to Home` is the renamed `lane.home` command rather than a new
`paletteSources` view item: both feed one registry search, so a second entry
would put two identical rows in the palette. The shortcuts needed no
rebinding — `switchTerminal`, `setActiveTerminalByIndex` and `terminal.new`
all route through `enterLane`, which T04 redefined, so ⌘1–9, ⌘Tab and
⌘⇧T open tabs already. The empty state the spec flagged as written twice was
collapsed when T09 deleted `laneBoard._renderEmptyState`; `terminalsView` now
exports `EMPTY_TITLE`/`EMPTY_HINT` and Home's Terminals card reads its
one-line version from them, so it cannot drift back apart.

_Captured: 2026-08-26 · 7 file changes_

---
