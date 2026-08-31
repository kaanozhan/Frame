---
keywords: presence, topbar, agent chips, agent tab, launcher, laneStatus, running agents
related: retire-rail-and-panels, agent-dispatch, lane-orchestrator
---
The sidebar Agent tab retired: running agents are now ◆ presence chips in
the top bar (presenceBar.js — all projects, status-flavored, click focuses
the lane with project switch, derived from laneStatus with no stored state),
and the Default Agent launcher (selector + Start, IDs preserved) moved into
the same cluster. agentPanel.js deleted with its markup and CSS. Same-day
fix: hover transform removed from task/spec cards (edge-oscillation jitter).

Chain: spec.md → plan.md → tasks.md → outcome.md
