---
keywords: home, dashboard, widgets, widget contract, home data layer, agents card, last sessions, ai tool selector, grid layout, card registry
related: terminals-home-agents, lane-orchestrator, sessions-from-transcripts, agent-dispatch, audit-q3-performance-resources
---
Home stopped being a two-group card board and became a flat grid of four
independent widgets: Agents, Last Sessions, Active Specs, Active Tasks. The
Terminals card and its six-tile machinery are gone; `laneBoard.js` (775 lines)
is now `homeBoard.js` (383) — a host owning the header, the no-project state,
the shell menu and one `.home-grid`.

Why this path: **one data layer, zero widget IPC.** `home/homeData.js` owns all
six sources behind an init-once guard; a widget declares `sources` and receives
plain data through `update()`. Rejected: each card subscribing for itself (the
2026-08-20 storm, ~100 round-trips/sec at 163% CPU, was exactly that shape) and
a renderer test harness (CI runs `npm test` with no `npm ci`, so `agentRows.js`
and `sessionRows.js` require nothing and are tested directly).

Rules established: widgets never require `electron` — writes go through
`homeData` (`setAiTool`), which is why the Agents widget does not call
`SET_AI_TOOL` itself as `plan.md` D5 assumed; `mount()` builds once and
`update()` patches, never rebuilds; `isAvailable()` gates mounting, not
content; a widget's `id` is stable and never derived from its title; the
`!malformed` spec filter lives in the data layer so no widget can forget it.
A fifth widget is one file plus one line in `home/registry.js`.

D1 narrows — does not reverse — the terminals-view naming convention of
2026-08-20: `homeBoard`/`home-board.css` say "home", while every `lane*`
module and the `.lane-board` DOM classes are untouched.

Chain: spec.md → plan.md → tasks.md → outcome.md
