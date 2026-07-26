---
keywords: activity log, observability, background work, watchers, hooks, monitoring, diagnostics, JSONL
related: audit-q3-reliability-recovery, audit-q3-performance-resources, spec-knowledge-layer, audit-q3-product-analytics, non-invasive-overlay
---
Made Frame's invisible work visible: a JSONL record of what Frame does on
its own, plus a side panel and a fixed outer-edge rail. The sink is a *file
contract* (`scripts/activity-log.js`, shipped to `.frame/bin/`) not a module,
because half the surface runs in processes the app cannot see — the git
pre-commit hook, Claude Code hooks, `implement-launch.js` with the app
closed. Rejected: an in-process logger (unreachable from those hosts),
in-repo `.frame/runtime/` storage (Frame never edits a user's `.gitignore`,
so it would dirty their `git status`), a modal (blocks the terminal you need
to watch), and a rail between terminal and panel (shifts on every toggle).
Biggest win: `spec-hint.js`'s eleven silent returns now carry distinct
reason codes, so the Spec Knowledge Layer's determinism claim is finally
falsifiable. Suppressions are first-class — a guard that prevented work
records it, because silence alone cannot distinguish healthy from dead.
Rules established: an event must be declared in `src/shared/activityEvents.js`
to be writable; fields are enums/counts/paths only, never free-form text; any
registry change updates PRIVACY.md in the same commit; recording never breaks
its host (guarded require out-of-process, lazy require at boot, no stdout, no
throw); `repeats` (layer aggregation) and `collapsed` (a debounce) stay
separate facts. Tier 2 (repo mutations, version drift) and Tier 3
(orchestration, PTY, IPC detail) deferred by name.

Chain: spec.md → plan.md → tasks.md → outcome.md
