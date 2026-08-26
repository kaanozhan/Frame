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
