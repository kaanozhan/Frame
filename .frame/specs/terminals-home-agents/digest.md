---
keywords: home, terminals, overview, breadcrumb chips, tabs, other terminals rail, status bar, navigation, view modes, lane board, top bar, dashboard, cross-project attention, presence, sidebar nav groups
related: lane-orchestrator, decisions-view, agent-dispatch, agent-orchestration, sidebar-project-section, status-bar, sidebar-nav-groups, settings-by-scope, audit-q3-performance-resources
---
Folded Home, Terminals and agent visibility into one model. `viewMode` is
`board | terminals | specs | tasks | panel`; `detail` and `terminalGrid.js` are
gone. **Shipped in two passes — the second overturned three of the first's own
decisions, recorded in spec.md §0.**

The Terminals section has **two bodies and no navigation of its own**: the grid,
and one terminal enlarged. Navigation is the top bar, where **every live
terminal is a breadcrumb chip** beside Terminals itself. Prefs are
`shownTerminal` + `hiddenFromBar` (what is *out* of the bar, so a new terminal
appears by default) — **not** the `openTabs`/`activeTab` tab strip the first pass
built and the second removed. The pane's `⤢` means "enlarge"; `maximizedId` is
gone. **Home is a dashboard** — a header plus two groups, Work and Project
planning — **not** the four-card board of §4; Orchestration is a sidebar entry,
not a card.

Rules established. **× always means "drop from this strip", never "destroy"** —
on Terminals, on a terminal chip, everywhere. **One status vocabulary** in
`laneStatus` (`statusLabel`/`attentionMark` + formatters). **Agent visibility is
spread across four surfaces, never repeated** (D2): the grid pane header, the
Other Terminals rail (D13), the sidebar ◆ chip, the status bar slot (D14/D15).
A single "Agents" panel was rejected. `mount()`/`update()` split with a guard in
`_renderBoardView` (C2) — live cards rebuilt per state change is the 2026-08-20
IPC storm. `laneRail.js` and `presenceBar.js` are deleted; no new IPC channel.

Fixed on the way: `isViewingFrame()` was bound to the retired `detail` mode, so
Start never used the focused terminal.

Chain: spec.md → plan.md → tasks.md → outcome.md
