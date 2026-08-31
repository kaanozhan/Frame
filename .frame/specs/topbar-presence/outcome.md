# Outcome — topbar-presence

Shipped 2026-08-20. Live-verified end-to-end with a real Claude session:
chip appeared with "Awaiting input" flavor and full tooltip, sidebar ◆ count
tracked it, chip click entered the lane, closing the terminal cleared the
chip. 222 tests pass.

## What shipped

- **presenceBar.js (new)** — one ◆ chip per live agent across ALL projects
  in the top bar's action cluster; status flavors working/approval/input/
  ready (working pulses); tooltip "agent · terminal · project — status";
  click focuses the lane with project switch; +n overflow past 8 chips.
  Same derived-state idiom as the module it supersedes (laneStatus +
  open-terminal set, rAF-debounced, TERMINAL_DESTROYED-aware).
- **Default Agent launcher relocated** — the tool selector and Start button
  moved from the sidebar Agent tab into the top bar cluster with IDs
  preserved (#ai-tool-selector, #sidebar-agent-launch), so aiToolSelector
  and the index.js dispatch binding kept working untouched.
- **Agent tab retired** — rail button + tab content out of index.html,
  agentPanel.js deleted, index.js rewired to presenceBar, ~180 lines of
  dead agent-tab CSS stripped from layout.css (launch-button base styles
  kept — reused in the top bar).
- Per-project attention badges on project rows (projectStatusBadges) stay.

## Also in this session (bug fix, outside the spec)

Hover jitter on task cards and specs grid cards: `transform:
translateY(-1px)` on :hover made the card slip out from under the cursor at
its edges → oscillating hover. Transform removed from
`.tasks-dashboard-card:hover` and `.specs-card:hover` (border/bg/shadow
feedback kept).
