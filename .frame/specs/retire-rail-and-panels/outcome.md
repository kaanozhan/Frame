# Outcome — retire-rail-and-panels

Shipped 2026-08-20. Live-verified (all nav items, panel-× routing, theme
toggle, overview highlight) + 222 tests pass.

## What shipped

- **Instrument rail deleted** — `#instrument-rail` removed from index.html,
  `instrumentRail.js` deleted, its CSS block stripped from activity.css.
  Theme toggle re-homed to the sidebar icon rail above Settings (boot-time
  theme restore was already in terminalTabBar, untouched).
- **Generic inline panel host** in multiTerminalUI: viewMode `'panel'` +
  `PANEL_REGISTRY` (github/claude/prompts/activity/history). Mounting
  re-parents the existing panel element into the center with `.panel-inline`
  (centered 900px column) and calls the module's own show() — data loading
  unchanged, zero edits inside the five panel modules. A MutationObserver on
  the element's class routes the module's own hide()/× back to the terminals
  view. `showOverview` parks inline surfaces before wiping the container.
- **Workspace nav grew to nine entries**: Terminals, Specs, Tasks, Overview,
  GitHub, Claude, Prompts, History, Activity — data-driven
  (WORKSPACE_NAV_ITEMS), each with click wiring and surface-based active
  states (`panel:<key>`, `overview`).
- **Legacy openers retargeted**: ⌘-palette panel commands → togglePanel,
  sampleBanner auto-open → showTasksBoard. specPanel/tasksPanel slide-ins
  have no interactive openers left (programmatic APIs kept).

## Process note (of record)

The two previous specs' tasks were written only to tasks.md, skipping the
tasks.json mirror (`task-spec-<slug>-T##` + generated_task_ids). That was a
mistake, acknowledged and backfilled the same day; this spec created its
tasks.json rows at spec time and closed them at completion — the correct
flow for hand-authored specs going forward.

## Known gaps

- Panel inline width (900px column) is a first pass; per-panel layout tuning
  may follow.
- specPanel/tasksPanel modules and their CSS remain in the codebase as dead
  weight; deletion is a later cleanup once nothing programmatic needs them.
- The sidebar "Agent" tab still exists (cross-project attention) — its fate
  is the top-bar presence step.
