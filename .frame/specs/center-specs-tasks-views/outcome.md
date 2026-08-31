# Outcome — center-specs-tasks-views

Shipped 2026-08-20. Live-verified (driven app run) + 222 tests pass.

## What shipped

- **Inline dashboard hosting.** Both `specsDashboard` and `tasksDashboard`
  gained `setInlineHost / mountInline / notifyDetached`; `show()/hide()/
  toggle()` delegate to the registered host, so every legacy entry point
  (lane rail, section rail, instrument rail, ⌘-palette, IPC toggles) now
  lands on the center surface. The `position:fixed` overlay CSS stays as a
  dormant fallback; `.inline` switches to static in-flow rendering. Element
  re-parenting is handled centrally in `multiTerminalUI._onStateChange`
  (detach before the container wipe) so view switches can't destroy the
  dashboards' DOM.
- **New viewModes `specs` / `tasks`** rendered by `_renderDashView`;
  `showSpecsGrid()` / `showTasksBoard()` enter them; Escape/× routes back to
  the terminals view via the inline host's `close`.
- **Lifecycle-first Specs entry** (`showSpecs()`): sidebar Specs opens the
  most relevant active spec (phase order implementing → … → draft, fallback
  any) in the existing linear `specSection` (stepper + spec/plan/tasks/
  outcome + list rail). The rail's ↗ button is now the in-center switch to
  the card grid. No specs → inline grid (owns the New Spec flow).
- **Sidebar nav wiring + active states** via `multiTerminalUI.
  getActiveSurface()` ('specs' or 'section:spec' lights Specs; 'tasks' or
  'section:task' lights Tasks).

## Decisions of record

- Center-first, not overlay-maximize: the user's "büyütme ile dashboard"
  alternative was rejected in favor of staying in the center and switching
  (lifecycle ⇄ grid) — agreed in conversation.
- The full-window overlay code path is dormant, not deleted — removal is a
  later cleanup once the center model has settled.

## Known gaps

- specsDashboard's detail pane (in-grid) still exists alongside specSection;
  consolidating the two spec-detail surfaces is a future step.
- Playwright's `page.screenshot` sporadically times out on this view's
  font-wait (tooling quirk; `document.fonts.ready` verified clean) —
  webContents.capturePage works.

## Post-ship fix (2026-08-20, same day)

CPU runaway when a dashboard was open alongside an open spec/task section
chip: the section's SPEC_DATA/TASKS_DATA listeners call
notifySectionChanged → _onStateChange re-rendered the dash view →
mountInline re-ran _load() → WATCH_SPECS/LOAD_TASKS → new pushes → loop
(~100 IPC round-trips/s; WATCH_SPECS also does stageCommandFiles +
upgradeSpecDocs in main on every call, which is what burned the CPU).
Fix: _renderDashView (and _renderPanelView) are idempotent — an
already-mounted surface is never remounted/reloaded on state changes; its
own IPC listeners keep it fresh. Measured: 1039 calls + 163% CPU per 10s →
0 calls, 0% CPU.
