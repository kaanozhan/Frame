# Plan — Deep /spec.tasks — cross-check generated tasks against the plan report

## Architecture

### Resolved plan-time decisions

- **D1 · When a risk row implies work** (asked) — A row in the report's risk
  table becomes a task only when the plan's answer names concrete behavior that
  no `## Sequencing` step describes. Answers that describe existing behavior
  ("the panel is already single-toast") or that cite a step explicitly
  ("Sequencing step 8 is a grep sweep") produce nothing. *Rationale:* the test
  is objective and mechanically applicable. Run against the real 9-row table in
  `audit-q3-ux-error-feedback/plan-report.html`, it correctly eliminates 8 rows
  and leaves 1 candidate — the list does not inflate.

- **D2 · How report sections are located** (asked) — Semantically ("find the
  table listing risks and the plan's answers"), not by heading text or card
  number. *Rationale:* the report template and a future implement-report will
  evolve independently; a loose binding survives that. Anchoring to
  `"4 · Risks & edges"` fails **silently** the day the template renames a
  heading — the pass would find nothing and report no error.

- **D3 · How the report is read** (silent) — Whole file, no targeted section
  extraction. *Rationale:* D2's semantic location requires the full content,
  and real reports run 418–472 lines — affordable.

- **D4 · Section not found** (silent) — Treated as absent; the run finishes
  normally. *Rationale:* indistinguishable from "no gaps of that kind" in
  practice, and C4 already requires the same behavior for a missing report.

- **D5 · Revision and ID binding** (silent) — Rewording a task's description
  does not rebind its ID. *Rationale:* a clarified description is the same
  work; only genuinely new work earns a new number.

- **D6 · Source of the ID↔work binding on regeneration** (asked, then revised)
  — `tasks.md` alone. *Rationale:* an earlier reading of the Stage 1 evidence
  concluded the risk was "not uniform" — that renumbering a `pending` task
  costs nothing while renumbering a `completed` one is corruption — and
  therefore that `tasks.json` had to be read for status. That framing quietly
  reintroduced renumbering as something the flow does at all. **It does not.**
  No ID is ever reassigned, for any task, in any status. With reassignment off
  the table, status is irrelevant to the binding: `tasks.md` carries the whole
  ID↔work mapping and is always present. This also restores the spec's own
  original recommendation.

- **D8 · Renumbering is never performed** (asked) — An ID, once bound to a
  piece of work, keeps that work for the life of the spec. New work always
  takes the next unused number; nothing shifts to accommodate it.
  *Rationale:* this is the whole defence. `specManager.js:441-443` overwrites a
  matched task's title in place while preserving its status, so a shifted ID
  transplants a completion flag onto work never done — but the path is only
  reachable *by renumbering*. Not renumbering makes the corruption
  unreachable rather than merely unlikely, needs no guard in
  `syncTasksFromMarkdown`, and leaves every existing flow untouched.

- **D7 · Verifying S6** (silent) — S6 is covered by a new test rather than by
  inspection. *Rationale:* the project has a working suite (`npm test` →
  `node --test test/`, 7 existing files) and S6 states a precise, cheap
  property. This is verification of existing behavior, not the sync hardening
  that the spec places out of scope.

### The three-stage prompt

`spec.tasks.md` becomes a staged prompt. The stages are strictly ordered and
the first is self-sufficient:

1. **Plan pass** — read `spec.md` + `plan.md`, derive a complete draft task
   list. This pass alone must produce a shippable list; the report may not
   weaken it.
2. **Report pass** — only when `.frame/specs/<slug>/plan-report.html` exists.
   Reconcile the draft against it.
3. **Write** — emit `tasks.md`, then update `status.json`.

### Reconcile rules (stage 2)

| Report content | Effect on the draft list |
| --- | --- |
| Risk / edge rows | New task when D1's test passes |
| Coverage matrix | A G/C/S ID whose owning plan section produced no task is a gap — close it with a new task or fold into an existing one |
| Verified claims / drift notes | Correct the description of any task whose premise drifted |
| Decision story | **Read for context only.** A rejected option never becomes a task; a task contradicting a recorded decision is corrected to match it |

Authority is bounded: the pass may **add** and **revise**, never **delete**.
`plan.md` wins every conflict — the report denounces gaps, it is not a second
source of truth. The 5–12 ceiling holds; if closing the gaps would exceed 12,
the run stops and recommends splitting the spec rather than shipping 20 tasks.

### ID assignment

Ordering carries implementation order; identity is separate.

- **First generation** — T01, T02, T03 … in order.
- **Regeneration** — every ID already bound to a piece of work keeps it,
  regardless of that task's status. New work takes the next unused number and
  is inserted at its correct position in the list. **Nothing is ever
  renumbered** (D8).

A regenerated list may therefore read `T01, T02, T05, T03, T04`. Ascending file
order is deliberately sacrificed to keep `spec:<slug>:T<n>` markers pointing at
the work they were created for.

Because numbers are only ever allocated and never reclaimed, the highest number
drifts above the task count over successive regenerations — a 9-task list may
legitimately end at `T14`. The 5–12 ceiling counts **tasks, not numbers**; the
prompt must say so, or the agent will read `T13` as a ceiling violation and
renumber to "fix" it, reopening exactly the hole this closes.

### Degradation

No report → the plan pass output is final; the run mentions the absence once in
its closing message and exits normally. Report present but a section not
locatable → D4.

### Output shape

`tasks.md` gains nothing: heading plus the flat `- T<n> · …` list, exactly as
today. Reconciliation leaves no section, annotation, or log in the file
(silent reconcile). `TASK_LINE_RE` (`specManager.js:363`) is order-agnostic, so
non-ascending IDs parse without any code change.

### Preserved by construction

Because the change is confined to a prompt template plus a test, the sync path,
`derivePhase`, the specs watcher, and orchestration are untouched (C3). Loading
still runs through `loadCommandTemplate` (`specManager.js:266-270`), so a
project's `.frame/templates/commands/claude-code/spec.tasks.md` override still
wins (C5). Only the `claude-code` template directory is touched, leaving
`codex` / `gemini` empty as they are today (C7). The prompt names no stack,
path, or convention from this repository (C6).

### Known limitation — footprint blind spot

`parseFootprintMarkdown` (`specManager.js:404`) filters footprint entries by
**basename** against `ORCH_META_FILES` (`frameConstants.js:51`), which contains
`AGENTS.md` and `CLAUDE.md`. The sample-project doc files therefore drop out of
the footprint silently: `src/templates/sample-project/AGENTS.md` and
`CLAUDE.md` are invisible to the orchestration conflict guard, while
`GEMINI.md` is not. This is a pre-existing Frame limitation, out of scope here;
it is recorded because step 8 edits those files and a parallel spec touching
them would not be flagged as conflicting.

## Files

- `src/templates/commands/claude-code/spec.tasks.md` — **Modified** — rewritten
  as the three-stage prompt: plan pass, report pass, write.
- `test/specTasksSync.test.js` — **New** — asserts `parseTasksMarkdown` handles
  non-ascending IDs and that `syncTasksFromMarkdown` produces no spurious adds
  on a regenerated list (S6).
- `src/templates/sample-project/AGENTS.md` — **Modified** — line 87's one-line
  `/spec.tasks` description updated to mention the report cross-check.
- `src/templates/sample-project/CLAUDE.md` — **Modified** — same edit; separate
  real file, not a symlink.
- `src/templates/sample-project/GEMINI.md` — **Modified** — same edit.

## Footprint

- src/templates/commands/claude-code/spec.tasks.md
- test/specTasksSync.test.js
- src/templates/sample-project/AGENTS.md
- src/templates/sample-project/CLAUDE.md
- src/templates/sample-project/GEMINI.md

## Dependencies

None. The test uses Node's built-in `node --test` runner, already wired as
`npm test` and already used by the seven existing files under `test/`.

## Sequencing

1. **Restructure `spec.tasks.md` into the staged skeleton.** Split the current
   single-pass prompt into an explicit plan pass and a write stage, keeping the
   emitted `tasks.md` and the `status.json` update byte-identical in intent to
   today's behavior. A spec with no report must come out of this step producing
   exactly what it produces now.

2. **Add the report pass and its location rules.** Read
   `.frame/specs/{slug}/plan-report.html` when present, in full, locating its
   risk table and coverage matrix semantically rather than by heading or card
   number (D2, D3). A section that cannot be located is treated as absent (D4).

3. **Add the reconcile rules.** The risk-row test (D1), the coverage-matrix gap
   rule, drift-driven description corrections, and the decision-story guardrail
   that keeps rejected options out of the task list.

4. **Add the authority limits.** Add and revise only, never delete; `plan.md`
   wins conflicts; the 5–12 ceiling holds and an overflow stops the run with a
   split recommendation.

5. **Add the ID assignment rules.** First-generation numbering; on
   regeneration, read the existing `tasks.md` and keep every bound ID
   regardless of status (D6, D8); new work takes the next unused number and is
   inserted in implementation order. State explicitly that non-ascending output
   is correct, that renumbering is never permitted, and that the 5–12 ceiling
   counts tasks rather than numbers.

6. **Add degradation and the closing message.** Missing report → plan-pass
   output stands, absence mentioned exactly once, no repeated warnings and no
   failure. Confirm nothing in the write stage emits a cross-check section
   (silent reconcile).

7. **Add `test/specTasksSync.test.js`.** Cover a regenerated list with
   non-ascending IDs: `parseTasksMarkdown` returns every entry in file order,
   and a re-sync of an unchanged list reports zero adds and zero updates.

8. **Update the sample-project command docs.** Correct the `/spec.tasks`
   one-liner in all three of `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` under
   `src/templates/sample-project/`.
