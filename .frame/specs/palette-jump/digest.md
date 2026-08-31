---
keywords: command palette, cmd+k, jump, providers, projects, terminals, specs, views, transient commands
related: project-rail, terminals-view, center-specs-tasks-views
---
⌘K became the prototype's everything-jumper: commandRegistry gained dynamic
providers (transient items, executed via transientById, excluded from
recents) and paletteSources registers projects / cross-project terminals /
current-project specs (SPEC_DATA-fed cache, 80-char clamp) / nine "Go to"
views alongside the static commands. Boot lesson of record: a missing
export aborted index.js init silently (palette + all shortcuts dead, no
visual symptom) — caught only by pageerror capture in the driven live run.

Chain: spec.md → plan.md → tasks.md → outcome.md
