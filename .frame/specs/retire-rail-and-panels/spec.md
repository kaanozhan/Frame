# Retire the instrument rail and the slide-in panels

> **What we're building:** The right-edge instrument rail and the slide-in
> side panels (GitHub, Claude/plugins, Prompts, Activity, History) are
> retired. Every destination moves to the sidebar workspace nav under the
> selected project and opens in the center — same model as Terminals, Specs
> and Tasks. The theme toggle (which lived in the rail's footer) moves to the
> sidebar's icon rail next to Settings.

## User's request (original, Turkish)

> instrument rail ile slide-in panelleri de emekli edelim o zaman.

## Problem

After terminals-view and center-specs-tasks-views, the app has two competing
navigation systems: the left sidebar (projects + workspace nav → center
views) and the right instrument rail (→ slide-in flex panels that squeeze
the center). The rail's two most-used items (Specs, Tasks) already route to
center views, leaving a half-retired rail and seven panel surfaces with
inconsistent behavior.

## Goal / Acceptance

- `#instrument-rail` is gone from the DOM; `instrumentRail.js` deleted.
- Workspace nav under the selected project gains: Overview, GitHub, Claude,
  Prompts, History, Activity — each opens in the center content area.
- Panels open inline via a generic host in multiTerminalUI (no per-module
  rewrite): the panel element is mounted into the center, its own show()
  loads data; closing it from its own × routes back to the terminals view.
- Legacy openers keep working but land in the center: ⌘-palette entries,
  the history keyboard shortcut, sampleBanner's spec/tasks panel opens.
- Theme toggle lives in the sidebar icon rail (next to Settings).
- specPanel / tasksPanel slide-ins have no interactive openers left (their
  programmatic APIs — loadTasks, showNewSpecPrompt, hide — stay).
- No main-process / IPC changes.

## Constraints

- Panel modules keep their internal logic; the host mechanism must not
  depend on per-module cooperation beyond the existing show()/hide().
- Overview stays a view mode; the nav item reuses multiTerminalUI's
  showOverview/hideOverview.
