---
keywords: terminals view, workspace nav, viewMode, pane grid, layout columns, maximize, naming, terminal
related: lane-orchestrator, agent-dispatch
---
Project selection now lands on a new default center view ('terminals'
viewMode, terminalsView.js): all of the project's terminals as live panes in
a 1/2/3-column grid with drag reorder, per-pane maximize and per-project
persisted prefs (localStorage frame-terminals-view). Sidebar got a
workspace-nav block under the selected project (Terminals + live count).
Overturns lane-orchestrator's rules: user-facing vocabulary is "Terminal"
(was "Frame"); the lane board is demoted from landing view but stays
reachable via Home. laneStatus keeps feeding the pane status dots. Next
steps deferred: Specs/Tasks nav entries, right-panel consolidation, board
removal decision.

Chain: spec.md → plan.md → tasks.md → outcome.md
