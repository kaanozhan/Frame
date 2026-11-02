---
keywords: spec tasks, plan report, reconcile, task ids, renumbering, tasks.md, templates
related: deep-spec-plan, test-aware-planning
---
Made `/spec.tasks` cross-check its list against `plan-report.html`: a plan pass derives the list from spec.md + plan.md alone, a report pass adds or revises tasks from the report, and no task ID is ever renumbered on regeneration.

- Prompt-only change: `src/templates/commands/claude-code/spec.tasks.md` became three stages (plan pass → report pass → write); `specManager.js`, the tasks sync, `derivePhase` and the codex/gemini templates were not touched. Eight tasks, one commit each (2cde777…e66dd6b), merged 2026-07-20 as fork PR #1 (a4ba550).
- Reconcile rules: a risk row becomes a task only when its answer names behavior no `## Sequencing` step describes (on audit-q3-ux-error-feedback's 9-row table it left 1 candidate); a G/C/S coverage ID with no task is closed; drift notes correct task descriptions; the decision story is context only, so rejected options never become tasks. Rejected: leaving risk rows to agent judgement (task count changes per run).
- Authority: add and revise, never delete; `plan.md` wins every conflict; the 5–12 ceiling holds and an overflow stops the run with a split recommendation. Rejected: a 14-task overage for report-derived tasks (it hides an oversized spec).
- The report is found by meaning and read whole (reports ran 418–472 lines). Rejected: anchoring to heading text such as "4 · Risks & edges", which finds nothing and reports success the day a heading is renamed, and grep-extracted ranges. A missing or unlocatable report leaves the plan-pass list standing, mentioned once in the closing message.
- IDs: the binding is read from the existing `tasks.md` alone; new work takes the next unused number, inserted in implementation order, so `T01, T02, T05, T03` is correct output and the ceiling counts tasks, not numbers. Rejected: reading `tasks.json` status to move "safe" pending IDs, and a title-matching guard in `syncTasksFromMarkdown`. The sync overwrites a matched title and keeps its status, so a renumber puts a completed flag on undone work; never renumbering makes that unreachable without code.
- Silent reconcile: `tasks.md` stays the heading plus the flat `- T<n> · …` list, with no cross-check section or provenance note.
- `test/specTasksSync.test.js`: 5 tests (non-ascending IDs parse in file order, an unchanged re-sync adds and updates nothing, status survives, appended work leaves a completed task on its own work). Unplanned in the same PR: the test stubs electron and @aptabase through `Module._load` so CI runs without node_modules (d92e513), and `npm test` became `node --test test/*.test.js` because fixture .js files were running as tests, and an ESM one kept main's CI red (29b0e9a). 84 pass, 0 fail.
- Not recorded: a run of the new prompt against a spec that has a report. S1–S4 rest on the prompt text.
- Rules: never renumber a spec task ID; the report points out gaps, and `plan.md` stays the only source of truth.

Chain: spec.md → plan.md → plan-report.html → tasks.md (no outcome.md — commits 2cde777…e66dd6b, d92e513, 29b0e9a carry the story)
