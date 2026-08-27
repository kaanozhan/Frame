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
# Second pass — the definition changed mid-flight

T01–T10 shipped and the branch stayed local. In the conversation that followed,
three of this spec's own decisions were overturned; `spec.md` §0 records which
and why, and §2/§4 were rewritten to the model below. What follows is what the
second pass actually did.

---

## T11 — Land on Home when a project has no running terminals

`enterLane` is the only way into the Terminals section, and it needs a terminal
to enter. With none, the old path landed on an empty grid — a screen whose only
content is an invitation to create the thing you did not ask for. Home is the
honest destination: it is the project's board and it has something to say about
a project with nothing running.

_Captured: 2026-08-26 · 2 file changes_

---

## T12 — The status bar says "in other projects"

The other-projects slot read "3 waiting elsewhere". "Elsewhere" names no place,
so the count had nothing to attach to — the reader cannot tell whether it means
another project, another window, or another machine. "In other projects" is the
only reading the data supports, so it is what the bar says.

_Captured: 2026-08-26 · 1 file change_

---

## T13 — The collapsed rail is an edge, not a broken sidebar

Collapsed, the sidebar rail kept its panel's border and background, so it read
as a sidebar that had failed to render rather than a deliberate edge. It now
presents as an edge of the window.

_Captured: 2026-08-26 · 1 file change_

---

## T14 — Home becomes a dashboard; Orchestration moves to the sidebar

Home gained a header (project name + branch — no path, the sidebar already
carries it) and two groups, Work and Project planning, that split the window
evenly so the board fills it instead of trailing off into empty space. Terminals
became tiles rather than rows: nine per project at most, so boxes fill the width
a list wasted, six per grid, and the last cell counts what is *not* shown rather
than what is over the cap.

Orchestration left the board. §4 listed four cards; there are three. It is a
surface you open, not a state you read, and it already opened as a top-bar
section tab — so its entry is the sidebar's Work group. The card was the only
place a live conductor session announced itself, so that sidebar row carries a
running badge now. **This reverses §4 of this spec.**

_Captured: 2026-08-26 · 6 file changes_

---

## T15 — The tab strip becomes a breadcrumb in the top bar

T02's tab strip shipped and put two rows of tabs directly above each other: the
top bar is itself a strip of surfaces, and the section's own strip sat
immediately under it, answering a different question with the same shape.

The strip is gone. Every live terminal of the project is now a chip in the top
bar beside Terminals itself, enlarged or not: Terminals is the grid of all of
them, a chip is that one enlarged. Prefs stopped tracking `openTabs`/`activeTab`
and now track `shownTerminal` + `hiddenFromBar` — what is *out* of the bar rather
than what is in it, so a terminal created later shows up by default.

The grid's magnifier became `⤢` again, since "enlarge this here" is what it now
does; an enlarged pane carries no shrink control, because Terminals never leaves
the top bar and is the way back. Chips are drawn in the grid's own order, so
dragging a pane moves its chip with it, and each carries the live status dot —
the whole point is seeing an agent go red while you look at something else.
`×` on a chip means "drop from this bar", never "destroy", the same as it means
on Terminals itself; `terminalChipNotice` teaches that until the user opts out.
Terminals keeps its own `×` only while the project has no terminals — with
terminals in it, the breadcrumb beside it would be orphaned.

The enlarged header gained the spec or task chip. Filling the screen with one
terminal is exactly when "what is this for" stops being answerable from anything
else on screen; the grid's panes are narrow and already say it. The conductor's
sentinel ref stays a label rather than becoming a link that leads nowhere.
**This reverses §2 and tasks T02/T03 of this spec.**

_Captured: 2026-08-26 · 8 file changes_

---

## T16 — Terminals wears the sidebar's own mark

Two surfaces name the same destination — the top bar's Terminals chip and the
sidebar's Work → Terminals row — and they looked like two different things. The
sidebar's row carries a `›_` prompt glyph; the top bar drew lucide's Boxes beside
a label in the UI sans, while the terminal chips that now sit right next to it
are set in mono. Terminals took the `›_` mark and the mono face of the chips it
heads, at the sidebar's own weight and size.

_Captured: 2026-08-26 · 2 file changes_

---

## T17 — The Add Project CTA belongs to the empty sidebar only

With a project selected, the Projects panel is that project's navigation, and an
accent-filled "+ Add new Project" sat at its foot as the loudest thing in the
sidebar — pulling toward the one action the user is demonstrably not taking. It
now shows only while no project is selected. Nothing is lost: the switcher above
leads to the same modal, and its entry says so more plainly now
("+ Open a project…" became "+ Add a project…"). The button follows the project
both ways — removing the last one hands `projectListUI` a null path and it comes
back.

_Captured: 2026-08-26 · 5 file changes_

---

## Status

Complete on `feat/terminals-home-agents`; **not merged**. Files touched across
both passes are the plan's `## Footprint`.

Deliberately **not** in this spec, though they landed on the same branch:
splitting Settings by scope (its own record, `settings-by-scope`) and the
inline-panel cleanup — the `retire-rail-and-panels` spec that work belongs to
has no folder in the archive.
