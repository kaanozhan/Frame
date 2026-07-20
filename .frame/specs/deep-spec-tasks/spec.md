# Deep /spec.tasks — cross-check generated tasks against the plan report

## Problem

`/spec.plan` now produces two artifacts: `plan.md` (the strict five-section
contract) and `plan-report.html` (the reasoning that the strict format cannot
carry — risks & edge matrix, coverage matrix, decision story, verified claims,
convergence log).

`/spec.tasks` was written before the report existed. Its prompt
(`src/templates/commands/claude-code/spec.tasks.md`) reads only `spec.md` and
`plan.md`, so everything the planning run learned and recorded *outside*
`plan.md` is invisible at task-generation time. Two concrete losses:

- **Risks & edges become nobody's work.** The report's risk matrix names edge
  cases and the plan's answer to each. If an answer implies work that
  `## Sequencing` states only implicitly, no task is ever created for it.
- **Coverage gaps go undetected.** The report maps every Goal / Constraint /
  Success-criterion ID to the plan section that owns it. A success criterion
  whose owning section produced no task is a silent hole — the spec ships
  "done" with an unmet criterion.

The task list is the last artifact before code, and the only one the
orchestration worker actually executes. A gap here is a gap that ships.

## Goal

### 1. Two-pass `spec.tasks` prompt

Rewrite `src/templates/commands/claude-code/spec.tasks.md` so the dispatched
run performs, in order:

1. **Plan pass** — read `spec.md` + `plan.md` and derive the task list exactly
   as today. `plan.md` is the spine; this pass alone must produce a complete,
   shippable list. Nothing about the report may weaken it.
2. **Report pass** — read `.frame/specs/{slug}/plan-report.html` *when it
   exists*, and reconcile the draft list against it:
   - **Risks & edges** — every row whose plan-side answer implies work with no
     owning task becomes a new task.
   - **Coverage matrix** — every G/C/S ID whose owning plan section produced
     no task is a gap; close it with a task or fold it into an existing one.
   - **Verified claims** — a drift note that invalidates a task's premise
     means that task's description is corrected.
   - The **decision story is read for context only**. Rejected options never
     become tasks; a task that contradicts a recorded decision is corrected to
     match the decision.
3. **Write** `.frame/specs/{slug}/tasks.md` — the reconciled list, in the
   existing flat `- T01 · …` format. Then update `status.json`.

### 2. Reconcile authority and its limits

The report pass may **add** tasks and **revise** existing task descriptions.
It may not **delete** tasks, and the reconciled list still obeys the 5–12
task ceiling. When plan and report conflict, **`plan.md` wins** — the report
is a denouncer of gaps, not a second source of truth. If closing the report's
gaps would push the list past 12, the agent stops and recommends splitting
the spec rather than shipping 20 tasks.

### 3. Silent reconcile

`tasks.md` gains no new sections, no provenance annotations, no cross-check
log. The output is the same flat list it is today — the reconciliation is an
internal step, not a visible artifact.

### 4. ID stability across regeneration

Task ordering in `tasks.md` reflects implementation order, so a task added by
the report pass is inserted at its correct position rather than appended.
Ordering and identity are separated to make that safe:

- On **first generation**, IDs are assigned in order: T01, T02, T03, …
- On **regeneration** (the file already exists), an ID that is already bound
  to a piece of work stays bound to it. New work gets the next unused number,
  inserted at its correct position in the list.

This means a regenerated list may read `T01, T02, T05, T03, T04` — ascending
file order is sacrificed to keep `spec:<slug>:T<n>` markers pointing at the
work they were created for.

## Constraints

- **Marker stability is non-negotiable.** `syncTasksFromMarkdown`
  (`src/main/specManager.js`) keys tasks by `spec:<slug>:T<n>` and preserves
  user-set status across re-syncs. Renumbering existing work silently
  transplants a `completed` flag onto different work. No change may
  reintroduce that.
- **`tasks.md` format is unchanged.** `TASK_LINE_RE`
  (`src/main/specManager.js:363`) parses `- T01 · <text>`; the sync path, the
  Tasks panel, and the orchestration worker all depend on it.
- **Lifecycle unchanged** — end artifacts stay `tasks.md` + `status.json`
  phase `tasks_generated`. `derivePhase`, the specs watcher, and tasks sync
  need no changes.
- **The report is optional.** A spec planned before the report existed, or
  one whose Stage 5 was skipped, has no `plan-report.html`. The plan pass
  alone must produce a valid list, and the run must not fail, warn
  repeatedly, or degrade — it notes the absence once in its final message and
  finishes normally.
- **Template override precedence preserved** — a project's
  `.frame/templates/commands/claude-code/spec.tasks.md` still wins over the
  Frame default.
- No project-specific content in the shipped template — no paths or stack
  assumptions from this repo.
- `codex` / `gemini` template directories are untouched.

## Success Criteria

- Running `/spec.tasks` on a spec **with** a `plan-report.html` produces a
  task list that covers every risk-matrix row implying work and every G/C/S ID
  in the coverage matrix, within the 5–12 ceiling.
- Running `/spec.tasks` on a spec **without** a report produces the same list
  today's prompt would, completes without error, and mentions the missing
  report once.
- No task in a generated list corresponds to an option the report records as
  *rejected*.
- Re-running `/spec.tasks` on a spec whose tasks already synced leaves every
  existing task's ID bound to its original work; a task marked `completed` in
  `tasks.json` still describes the work that was completed.
- `tasks.md` contains only the heading and the flat `- T<n> · …` list — no
  cross-check section.
- `parseTasksMarkdown` parses a regenerated list with non-ascending IDs
  correctly, and `syncTasksFromMarkdown` reports no spurious adds.

## Out of Scope

- Changing `plan-report.html`'s structure or the `spec.plan` prompt.
- Deep versions of `/spec.new` or `/spec.implement`.
- Machine-readable report data (e.g. embedding JSON in the HTML for the tasks
  pass to parse) — the pass reads the rendered HTML as-is.
- A tasks-side HTML report.
- `codex` / `gemini` variants.
- Backfilling or regenerating task lists for existing specs.
- Making `syncTasksFromMarkdown` resilient to renumbering by matching on
  title — the ID-stability rule solves this at the prompt level; hardening the
  sync itself is a separate spec.

## Open Questions

- **Where the report pass draws the line on "implies work".** A risk row
  answered by "the existing guard already covers this" implies no task; one
  answered by "handled during implementation" implies a task. The prompt needs
  a crisp test the agent can apply without inflating the list. Candidate: a
  row implies work only when its answer names behavior not already described
  by a `## Sequencing` step.
- **Whether the report pass reads the HTML directly or is given extracted
  sections.** Reading the raw HTML is zero-infrastructure but spends context
  on markup (reports run 300–500 lines). Alternative: the prompt instructs the
  agent to grep for the specific section anchors and read only those ranges.
  Recommendation: read directly for v1, revisit if context pressure shows up.
- **How regeneration detects "already bound" work.** The prompt can compare
  against the existing `tasks.md`, or against `tasks.json` entries carrying
  `spec:<slug>:` markers. `tasks.md` is simpler and always present;
  `tasks.json` is the thing that actually holds the statuses at risk.
  Recommendation: `tasks.md`, since sync derives from it.
- **Whether the 12-task ceiling should rise when a report is present.** The
  report pass can legitimately surface real work the plan pass missed;
  refusing to exceed 12 may force a split that isn't warranted. Keep 12, or
  allow a small overage (say 14) when the extra tasks are report-derived?

RESOLVED at spec time:
- Reconcile is **silent** — no cross-check section in `tasks.md`
  (decided 2026-07-20).
- Report pass may **add and revise, never delete**; 5–12 ceiling holds; on
  conflict `plan.md` wins (decided 2026-07-20).
- New tasks are **inserted in implementation order**, with IDs kept bound to
  their work across regeneration (decided 2026-07-20).
