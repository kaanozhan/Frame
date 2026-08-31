# Outcome — palette-jump

Shipped 2026-08-20. Live-verified all four jump types + 222 tests pass.

## What shipped

- **Registry providers** — `commandRegistry.registerProvider(fn)`: dynamic
  command-shaped items merged into getAll() at search time, executed via a
  transientById map (never stored in recents). Static commands, shortcuts,
  fuzzy scoring and recents untouched.
- **paletteSources.js** — four providers:
  - Projects (Project) → selectProject; "(current)" suffix on the active one.
  - Terminals (Terminal) → all projects, label `name · agent — project`,
    focus with project switch (presence flow).
  - Specs (Spec) → current project, titles clamped at 80 chars, opens the
    lifecycle view (specSection). Cache push-fed by SPEC_DATA + warm
    LIST_SPECS at init/project change — providers stay synchronous.
  - Views (View) → the nine workspace destinations ("Go to X").
- Verified live: "fingrid" → project jump; spec title → lifecycle view;
  "go to tasks" → inline kanban; "terminal 1" → focused terminal.

## Incident during implementation (caught by live verification)

First build shipped `registerProvider` without exporting it; the resulting
boot-time TypeError in paletteSources.init silently aborted the rest of
index.js init() — killing the palette AND every keyboard shortcut, with
zero visual symptoms. Found via pageerror capture in the driven run, fixed
by exporting. Lesson reinforced: renderer init is one long function — any
module wired into it must be exercised in a live run, and boot-time
pageerror capture is now part of the verification recipe.
