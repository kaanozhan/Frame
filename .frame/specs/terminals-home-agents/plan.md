# Plan — Home, Terminals and Agents — three surfaces folded into one model

## Architecture

### Resolved plan-time decisions

**Business decisions (asked)**

- **D1 · Ordering against the perf spec** — start while
  `audit-q3-performance-resources` T10 (the measurement pass) is still open.
  *Rationale:* T01–T09 are complete and T10 changes no code; the user preferred
  the measurement to see the final design. *Note:* T10 has been `in_progress`
  for 37 days — do not lean on "it closes soon".
- **D2 · Agent visibility is not concentrated in one panel** — it is spread
  across four surfaces (Overview pane headers · the Other Terminals rail · the
  sidebar chip · the status bar slot). *Rationale:* each surface shows what its
  own context cannot. A single "Agents" rail overlapped Overview and vanished
  entirely once Terminals could be dropped from the strip.
- **D10 · Terminals stays in the sidebar** — its place in `sidebar-nav-groups`'
  Work group is preserved. *Rationale:* that spec gave the sidebar the meaning
  "where you act"; sidebar = entry point, top bar = what is open. Two jobs, not
  a duplicate.
- **D11 · Terminals can be dropped from the top bar strip** — `×` removes it
  from the top bar only; the section, its tabs, the layout and the agents all
  live on. *Rationale:* it establishes one rule — Home is permanent, everything
  else is open and removable — and makes `×` mean "drop from this strip" at
  both levels, never "destroy".
- **D13 · Other Terminals is closed by default** — opened by a hover control at
  the edge, its state remembered; only approval and input appear in the
  collapsed strip. *Rationale:* in the single-terminal view the screen belongs
  to the terminal; the panel comes when asked for, without leaving you blind.
- **D14 · The status bar slot covers only the other projects** — this project's
  attention lives in the sidebar chip. *Rationale:* otherwise it repeats what is
  already on screen in Overview. The label states the scope.
- **D15 · Status bar: hover opens, click acts** — *Rationale:* the bar's own
  idiom (`status-bar.css:38-39`: the usage meters reveal detail on hover, a
  click refreshes). Consistency within the bar.

**Technical decisions (asked)**

- **D3 · Tab state lives in `terminalsView`'s prefs** — `openTabs`/`activeTab`
  in `localStorage['frame-terminals-view']`, in the same per-project record as
  `cols`/`order`. *Rationale:* the dead-id pruning is already there, and
  `saveProjectSession`'s early-return branch (C4) and the perf spec's MRU
  pruning are left untouched.
- **D4 · The tab strip stays inside `terminalsView`** — not extracted into its
  own module. *Rationale:* splitting the mount-moving logic is the one way C1
  gets violated.
- **D5 (revised) · `laneDetailRail.js` → `otherTerminalsRail.js`** — the file
  *survives*. An interim decision deleted it on the grounds that the status bar
  made it redundant; that was withdrawn once the framing changed from "agent
  panel" to "the terminals I cannot see". The name follows the content;
  `detail` is retiring.

**Silent decisions (one defensible answer)**

- **Test posture: none this time.** PROJECT_NOTES §Testing records "no DOM/UI
  harness present" for `src/renderer/`, verified again today (`jsdom`,
  `playwright`, `@testing-library`, `puppeteer` all absent). This spec's work is
  100% renderer. The five sections carry no test work.
- **The single source for status vocabulary is `laneStatus.js`** — it already
  owns the taxonomy. All four surfaces (Overview header, rail, sidebar chip,
  status bar slot) use the same words and the same attention symbols.
- **D8 (extended) · `projectStatusBadges.computeCounts()`** — the per-project
  tally is extracted into a pure function and exported, feeding **two
  consumers**: the sidebar chip's attention state and the status bar slot. One
  implementation, no new IPC.
- **The rail is not agents-only** — it lists every terminal in the project bar
  the one on screen, with agents marked. Agents-only would leave no path to
  plain shells in the single-terminal view.
- **Only attention shows in the collapsed strip.** A repeat one level down of a
  principle already recorded in `projectStatusBadges.js`: "the list only flags
  projects that need the user's attention."
- **D9 · Not dispatched through the orchestrator.** The footprint overlaps
  `audit-q3-performance-resources` in four files and that spec is
  `implementing`, so the conflict guard refuses the dispatch. The work runs
  directly until T10 closes.

### Constraints (C-IDs)

- **C1 — One live mount per terminal.** `mountTerminal` does not copy the DOM
  element, it **moves** it (`terminalManager.js:547`). The target body always
  re-mounts on an Overview↔tab switch; assuming "it was already mounted" is
  forbidden. The failure mode is a silent empty pane.
- **C2 — Inline surfaces must be mount-idempotent.** `laneBoard.render()`
  rebuilds the container on every state change today (`laneBoard.js:135`). With
  four live data cards that is exactly the shape of the IPC storm measured on
  2026-08-20 (~100 round-trips/sec, 163% CPU). Home splits into
  `mount()`/`update()`.
- **C3 — Switching projects does not kill terminals**
  (`terminalManager.js:666-672`). Tabs are therefore not discarded either.
- **C4 — `saveProjectSession`'s early return** (`terminalManager.js:163-165`) is
  side-stepped by not writing tab state there; that branch is not changed.
- **C5 — The recorded decisions of `audit-q3-performance-resources` are kept:**
  `_armQuietTimer` in `laneStatus`, the 20-entry MRU session pruning and the
  `clearProjectSession` wiring in `terminalManager`, and the **init-once
  listener guards** in `laneRail`, `laneBoard`, `laneStatus` and
  `terminalManager`. The rewritten `laneBoard` and the new rail carry the idiom
  forward.
- **C6 — The decisions of the 2026-08-25 merge are kept.** The Work/Context/Frame
  groups, their collapse state and the Terminals row's count; `historyPanel`'s
  retirement; the usage meters staying in the status bar and the theme toggle in
  the top bar. And the `!malformed` filter in the spec lists
  (`laneRail.js:204`, `multiTerminalUI.js:520`) — **Home's Specs card must carry
  it over when it inherits `laneRail`'s subscriptions.**

### Components

**The status vocabulary.** `laneStatus.js` becomes the single home for the
presentation helpers: `statusLabel(status, { agentName, foreground,
commandLine, short })`, `attentionMark(status)` (the symbol used in the Overview
header and the collapsed strip), `cleanCommand`, `formatRelativeTime`,
`assignmentIcon`, `assignmentText`. `laneBoard`'s helper exports go away, which
also breaks the rail's current import dependency on it
(`laneDetailRail.js:15`).

**The Terminals section.** `terminalsView` splits into two layers:
`_buildTabStrip()` and the active tab's body. `activeTab === null` renders the
Overview body (today's `tv-grid` plus the layout bar; the pane header gains
legible status and an attention marker, and there is **no** rail);
`activeTab === id` renders a single-terminal body plus the Other Terminals
rail. The strip scrolls horizontally. The pane's `data-maximize` becomes
`data-open`, its icon `Maximize2` → `Search`, and it calls `openTab(id)`;
`maximizedId` and every branch reading it are deleted.

Tab lifecycle: `openTab` only changes `activeTab` when the tab already exists;
`closeTab` drops the tab and leaves the terminal alone; a dying terminal drops
its tab through normalisation; a pane click in Overview keeps today's
focus-in-place behaviour (`terminalsView.js:243-252`).

**The top bar.** `_renderLeftSection` reduces to `Home` (permanent) plus
`Terminals` (removable, with an `×`) plus the section chips. Terminals inherits
the chip mechanics from the sections; when dropped the user lands on Home and
**Work → Terminals** puts it back. The per-terminal tabs, the
`grid-layout-select` and the presence container are removed; the theme toggle
and the update notification stay (C6).

**Retiring `detail`.** `viewMode` becomes `board | terminals | specs | tasks |
panel`. `_renderDetailView`, `_ensureAssignments`, `_assignCell`,
`_newLaneInCell`, `_cellAssignments`, `_detailRailCallbacks` and the
`TerminalGrid` import are removed. `enterLane(id)` stays the single choke point
with its new meaning: "go to Terminals (restoring it to the strip if needed)
and open or focus that terminal's tab". `isViewingFrame()` becomes
`viewMode === 'terminals' && !isSectionVisible && !isDecisionsVisible &&
!!activeTerminalId`, which fixes the bug at `agentDispatch.js:251`.

**Home.** `laneBoard` is rewritten as four cards (Terminals, Orchestration,
Specs, Tasks) with a `mount()`/`update()` split. `laneRail.js` is deleted and
its Specs/Tasks subscriptions (`SPEC_DATA`/`TASKS_DATA`, with the `!malformed`
filter) move into the cards. Home does not render without a project.

**The Other Terminals rail.** `otherTerminalsRail` renders only in the
single-terminal body. Its source is this project's terminals minus the one on
screen. It is closed by default (the `isHidden` default is inverted); while
closed, only agents waiting on approval or input appear, as a red exclamation
and an agent marker, replacing today's two generic icons
(`laneDetailRail.js:103-106`). The collapse mechanics and the `.lane-rail` CSS
are preserved.

**The sidebar chip.** `projectListUI`'s `workspace-nav-agents` (`:392-395`)
gains an attention state on top of its count: colour and symbol change when
`computeCounts()` reports approval or input. The Terminals row and its count
are preserved (C6).

**The status bar slot.** The declared empty left slot in `statusBar.js` (`:10`)
is filled: scope is **the other projects only**, with three states (none → a
quiet hint · some → a calm count · waiting → prominent). Hover opens a menu
grouped by project, **upward**; a row click runs `state.setProjectPath` then
`enterLane` — logic inherited from `presenceBar._focus`
(`presenceBar.js:105-113`) as `presenceBar.js` is deleted. The hover menu needs
an open delay and a forgiving close area.

## Files

**Modified**

- `src/renderer/laneStatus.js` — the single home for status words, attention symbols and the presentation helpers; `_armQuietTimer` and the init-once guard preserved (C5).
- `src/renderer/terminalsView.js` — the tab strip, `openTab`/`closeTab`, the magnifier, removal of `maximizedId`, `openTabs`/`activeTab` in prefs, the legible Overview pane header, and rail hosting in the single-terminal body.
- `src/renderer/multiTerminalUI.js` — removal of the `detail` render path and the cell logic, redefinition of `enterLane`/`isViewingFrame`, Terminals' removability from the strip, and an idempotent board render for Home.
- `src/renderer/terminalManager.js` — removal of `gridLayout`/`setGridLayout` and the legacy mapping, cleanup of the dead viewMode restore; MRU pruning preserved (C5).
- `src/renderer/terminalTabBar.js` — left section becomes `Home` plus a removable `Terminals` plus section chips; per-terminal tabs, layout select, presence container and the dead `onEnterFrames` go; the theme toggle stays (C6).
- `src/renderer/laneBoard.js` — rewritten as the four-card Home board with a `mount()`/`update()` split (C2); the Specs card carries the `!malformed` filter (C6); the init-once idiom continues (C5).
- `src/renderer/agentDispatch.js` — aligned with the new meaning of `isViewingFrame`; `_startAgentIn` no longer tears the user out of Overview.
- `src/renderer/projectStatusBadges.js` — the per-project tally exported as a pure `computeCounts()`, with two consumers.
- `src/renderer/projectListUI.js` — the Work → Terminals row and its count preserved; the `◆` indicator gains an attention state (C6).
- `src/renderer/statusBar.js` — the empty left slot filled: the other-projects indicator, its hover menu and its navigation.
- `src/renderer/paletteSources.js` — `Go to Home` added.
- `src/renderer/index.js` — the command vocabulary "Frame/Mainframe" → "Terminal/Home", the category `Frames` → `Terminals`; the `presenceBar` init removed.
- `src/renderer/styles/components/lane-board.css` — the new top bar, the Home cards, cleanup of the orphaned `.btn-lane-frames*`.
- `src/renderer/styles/components/terminals-view.css` — the tab strip, the single-terminal body, the legible pane header, removal of the `maximized` rules.
- `src/renderer/styles/components/status-bar.css` — the left slot and its upward-opening hover menu.
- `src/renderer/styles/components/terminal.css` — removal of the presence chip rules.
- `src/renderer/styles/components/orchestrator.css` — the orchestrator badge rules that move into the Home card.
- `src/renderer/styles/components/project-section.css` — the sidebar chip's attention state.

**New**

- `src/renderer/otherTerminalsRail.js` — `git mv` from `laneDetailRail.js`; "the other terminals" in the single-terminal body, closed by default, attention markers in the collapsed strip.

**Deleted**

- `src/renderer/laneDetailRail.js` — moved to `otherTerminalsRail.js`.
- `src/renderer/laneRail.js` — Home's Specs/Tasks side panel; its content moved into the cards.
- `src/renderer/terminalGrid.js` — the `detail` view's cell grid.
- `src/renderer/presenceBar.js` — the top bar's agent chips; merged into the status bar slot.

## Footprint

- src/renderer/laneStatus.js
- src/renderer/terminalsView.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/terminalTabBar.js
- src/renderer/laneBoard.js
- src/renderer/otherTerminalsRail.js
- src/renderer/laneDetailRail.js
- src/renderer/laneRail.js
- src/renderer/terminalGrid.js
- src/renderer/presenceBar.js
- src/renderer/agentDispatch.js
- src/renderer/projectStatusBadges.js
- src/renderer/projectListUI.js
- src/renderer/statusBar.js
- src/renderer/paletteSources.js
- src/renderer/index.js
- src/renderer/styles/components/lane-board.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/components/status-bar.css
- src/renderer/styles/components/terminal.css
- src/renderer/styles/components/orchestrator.css
- src/renderer/styles/components/project-section.css

## Dependencies

None. No new packages and no new IPC channels — `src/main/` and
`src/shared/ipcChannels.js` stay outside this spec.

## Sequencing

1. **Move the status vocabulary into `laneStatus`.** `statusLabel` (with the
   `short` flag), `attentionMark`, `cleanCommand`, `formatRelativeTime`,
   `assignmentIcon`, `assignmentText`. Behaviour is unchanged and the two label
   dictionaries collapse into one. `_armQuietTimer` and the init-once guard are
   untouched. — G7, C5, S17
2. **Build the tab strip.** `openTabs`/`activeTab` in prefs, `_buildTabStrip()`,
   `openTab`/`closeTab`, the single-terminal body, the strip's `overflow-x`
   behaviour; the terminal re-mounts on every Overview↔tab switch. — G2, C1, C3,
   S2, S5
3. **Wire the magnifier and remove `maximizedId`.** — G2, S4
4. **Retire `detail`.** Delete the cell logic and `terminalGrid.js`; drop
   `gridLayout`, the legacy mapping and the dead viewMode restore; redefine
   `enterLane` and `isViewingFrame` and align `agentDispatch`. — G3, C5, S6, S7,
   S8
5. **Rebuild the top bar.** `Home` plus a removable `Terminals` plus the section
   chips, where `×` drops it from the strip and the section lives on, and Work →
   Terminals puts it back. Remove the per-terminal tabs, the layout select, the
   presence container and the dead `enterFrames`; delete `presenceBar.js` and
   the orphaned CSS; keep the theme toggle. — G1, C6, S1, S14, S18, S21
6. **Make the Overview pane header legible.** Status text and attention marker
   from the `laneStatus` vocabulary. No rail is added to Overview. — G5, S22
7. **Build the Other Terminals rail.** `git mv laneDetailRail.js
   otherTerminalsRail.js`; render only in the single-terminal body; closed by
   default with a hover control to open; only approval and input in the
   collapsed strip; a row click calls `enterLane`. The init-once idiom
   continues. — G5, C5, S12, S23, S24
8. **The sidebar chip and the status bar slot.** Export `computeCounts()` from
   `projectStatusBadges`; give the sidebar `◆` chip its attention state; fill
   the status bar's left slot with its three states, an upward-opening hover
   menu, and a row click that switches project when needed and opens the tab.
   — G5, C6, S13, S25, S26
9. **Turn Home into the card board.** Four cards, the `mount()`/`update()`
   split, the idempotence guard on `_renderBoardView`, `laneRail.js` deleted,
   the `!malformed` filter carried into the Specs card, project selection when
   there is no project. — G4, C2, C6, S9, S10, S11, S19, S27
10. **Palette, vocabulary and the remaining cleanup.** `Go to Home`; the
    command vocabulary "Frame/Mainframe" → "Terminal/Home"; the shortcuts bound
    to the new `enterLane`; the remaining "New Frame" strings; the duplicated
    empty state collapsed into one. — G6, G7, S16, S19
