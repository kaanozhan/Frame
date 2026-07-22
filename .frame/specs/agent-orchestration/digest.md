---
keywords: orchestration, conductor, worker, worktree, parallel specs, merge, command bus, conflict guard
related: agent-dispatch, lane-orchestrator
---
Parallel spec execution: a conductor agent (real Claude session driven by
CONDUCTOR.md) dispatches one worker per spec, each in an isolated git
worktree (`.frame/worktrees/<slug>`, branch `frame/<slug>/work`), and merges
to `frame/<slug>/integration` — `main` is never touched, promotion stays
manual. Frame owns the mechanics via a file command bus (`.frame/bin/`
dispatch/report-done/merge/status): worktrees, a code-enforced footprint
conflict guard (overlapping in-flight footprints refuse to dispatch —
safety in code, not prompt), and fast-forward merges. Workers implement
only their spec's tasks.md, never push/merge, never touch meta files.
Rejected: task-level parallelism (superseded early draft) — the spec is the
unit of parallelism because its tasks are sequential by design.

Chain: spec.md → plan.md → tasks.md → outcome.md
