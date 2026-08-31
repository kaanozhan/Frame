# Topbar presence — the Agent sidebar tab retires

> **What we're building:** The sidebar's Agent tab (Default Agent launcher +
> cross-project "Running agents" list) retires. Running agents become live
> presence chips in the top bar (prototype's presence model): one chip per
> agent across all projects, status-colored, click focuses that terminal —
> switching project first when needed. The Default Agent launcher (tool
> selector + Start) moves into the top bar's action cluster.

## User's request (original, Turkish)

> agent sekmesini de topbar presence'a taşıyalım o zaman

## Goal / Acceptance

- Sidebar rail has no Agent tab; its content markup is gone; agentPanel.js
  deleted.
- Top bar action cluster shows presence chips (◆) for every terminal with a
  live agent, across ALL projects: status flavor (working/approval/input/
  ready), tooltip "agent · terminal · project — status", click focuses the
  lane (project switch included). Derived state only — recomputed from
  laneStatus + open terminals, debounced to one rAF (agentPanel's idiom).
- Default Agent selector (#ai-tool-selector) and Start (#sidebar-agent-launch)
  keep their IDs and existing bindings but live in the top bar cluster.
- Per-project attention badges on project rows (projectStatusBadges) stay.
- No main-process / IPC changes.

## Constraints

- The top bar's action cluster is static (built once) — presence chips render
  into a dedicated container there, so existing ID-bound wiring survives.
