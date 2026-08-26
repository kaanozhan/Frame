---
keywords: home, terminals, overview, tabs, other terminals rail, status bar, navigation, view modes, lane board, top bar, cross-project attention, presence, sidebar nav groups
related: lane-orchestrator, decisions-view, agent-dispatch, agent-orchestration, sidebar-project-section, status-bar, sidebar-nav-groups, audit-q3-performance-resources
---
Folded Home, Terminals and agent visibility into one model. `viewMode` is now
`board | terminals | specs | tasks | panel` — `detail` and `terminalGrid.js`
are gone, and `enterLane` means "go to the Terminals section and open or focus
that terminal's tab". The Terminals section owns a tab strip (Overview + one
tab per opened terminal, `openTabs`/`activeTab` in the per-project prefs); the
pane header's ⤢ became a 🔍 that opens a tab, and `maximizedId` is gone.

Rules established. **× always means "drop from this strip", never "destroy"** —
at the tab level and on the top bar's Terminals chip alike. **One status
vocabulary**: `laneStatus` owns `statusLabel`/`attentionMark` and the
formatters; `laneBoard.STATUS_LABELS` and `laneDetailRail.STATUS_SHORT` are
one table now. **Agent visibility is spread across four surfaces, never
repeated** (D2): the Overview pane header, the Other Terminals rail (D13 —
closed by default, hover to open, only approval/input in the collapsed strip),
the sidebar ◆ chip (this project), the status bar slot (D14 — the *other*
projects only, hover opens and click acts per D15). A single "Agents" panel was
rejected: it overlapped Overview and vanished once Terminals could be dropped.
**Home is a board of four summary cards**, not a terminal list — with a
`mount()`/`update()` split and a guard in `_renderBoardView` (C2), because four
live data cards rebuilt per state change is the 2026-08-20 IPC storm.
`laneRail.js` and `presenceBar.js` are deleted, their subscriptions and
navigation absorbed; no new IPC channel exists for any of it.

Fixed on the way: `isViewingFrame()` was bound to the retired `detail` mode, so
it answered false on the default view every time and Start never used the
focused terminal.

Chain: spec.md → plan.md → tasks.md → outcome.md
