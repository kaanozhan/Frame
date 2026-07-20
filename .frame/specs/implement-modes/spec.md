# Implement modes — selectable and user-definable spec.implement flows

## Problem

`/spec.implement` ships exactly one flow: take the next pending task, ship it,
write an outcome entry, stop. The user turns the loop by dispatching again.
That flow is a reasonable default, but it is the *only* option — and it is not
how everyone works.

Two concrete gaps:

- **No autonomous option.** A user who trusts the plan and wants the whole spec
  built in one run has to dispatch N times, reviewing between each. There is no
  way to say "run the loop yourself, test as you go, commit each task, and show
  me a report at the end."
- **No way to bring your own flow.** Teams have implementation conventions —
  test-first, no-commit-until-review, migration-specific verification steps.
  Today the only lever is replacing `spec.implement.md` wholesale via the
  template override, which also throws away everything Frame's default flow
  does for task and phase accounting.

A richer flow already exists as a per-project Claude Code skill in another
project (autonomous per-task loop → test → atomic commit → interactive HTML
report with the real git diff per commit → Frame outcome entry). It works well
and is the reference for intent here, not a literal source: its stack-specific
content (`yarn db:migrate`, `psql`, Supabase migration numbering, repo-specific
commit scopes, `docs/reports/` location) is dropped, and the flow is
generalized to any project.

## Goal

### 1. Implement mode selection

On a `spec.implement` dispatch, if no mode is resolved yet, the agent asks the
user which implementation flow to use — **before** touching any code. Three
choices ship:

1. **Step by step** — one task at a time, the user stays in the loop.
2. **Autonomous + report** — the whole range in one run, tested, committed, and
   documented in an HTML report.
3. **Describe your own** — the user describes their flow in their own words and
   the run follows it.

The picker explains what each mode *gives the user*, in concrete terms, not by
naming it. Specifically, the autonomous option must state that it produces an
HTML report the user can open as each task completes, showing that task's real
code diff, a what-changed / why-changed summary, and its test result.

### 2. Mode resolution and persistence

Resolution order, first hit wins:

1. `status.json` `implement_mode` — this spec's already-chosen mode.
2. `.frame/config.json` — the project-wide default, when one has been saved.
3. Ask the user.

A chosen mode is written to `status.json` so later dispatches on the same spec
do not re-ask. Re-asking on every task would be unbearable in **Step by step**,
where the user dispatches once per task.

After a mode is chosen *by asking*, Frame offers to make it the project
default: **"Save this as the default implement flow? Every spec in this project
will be implemented this way unless you change it."** On yes, the mode — and,
for a custom flow, its full description — is persisted in `.frame/config.json`
and no future spec asks. The offer is made once per choice, never nagged.

### 3. The shared core every mode obeys

Modes differ only in *how* the loop runs. These are non-negotiable in all
modes, including user-described ones:

- Task selection: the lowest-numbered `pending` task in `tasks.json` whose
  `source` is `spec:<slug>:T<n>`.
- Scope authority: `plan.md`'s **Files** and **Sequencing** sections.
- Task state: `in_progress` on start, `completed` + `completedAt` on finish, in
  `tasks.json`.
- Spec phase: `status.json` → `implementing` at the start, `done` when no task
  remains pending or in-progress.
- An `outcome.md` entry per completed task, in the existing format.
- Never push. Never touch `main`.

A user's described flow layers on top of this core — it can change the loop,
the commit policy, the verification steps, and the reporting, but it cannot
drop the accounting. This is what separates "describe your own flow" from the
existing template override, which replaces everything.

### 4. Step by step (enriched)

Today's behavior plus a close-out per task: after the change is in place and
the outcome entry written, the agent reports **what changed and why**, then
asks a single question — commit this and continue to the next task, or stop
here. On continue, the loop proceeds within the same run; on stop, the run
ends. The user is never asked more than this one question per task.

### 5. Autonomous + report

Runs the full task range without pausing for permission. Per task:

1. Mark `in_progress`.
2. Implement per the task and `plan.md`.
3. **Verify** — run the cheapest meaningful check for what changed, using the
   project's own commands from `.frame/config.json` `project.commands`
   (`test`, `build`, …). No stack assumptions are baked into the template. On
   failure: fix and re-run; surface to the user only when genuinely stuck.
4. Append an entry to `report-data.json` (hash left empty).
5. Append the `outcome.md` entry.
6. Mark `completed`.
7. **One atomic commit** carrying the code, the outcome entry, the report data,
   and the state files.
8. **Fold the diff in:** read the new commit's short hash, write it into the
   entry, regenerate the HTML, `git commit --amend --no-edit`. Amend is safe
   because nothing is pushed.

Stop conditions are narrow: a genuine product or architecture fork that
`spec.md`/`plan.md` does not settle, a destructive action outside the task's
scope, or a check that fails in a way the agent cannot resolve.

### 6. The implementation report

Frame ships a report generator, staged into `.frame/runtime/assets/` on
dispatch exactly as `plan-report-template.html` is today
(`stageReportTemplateAsset`, `src/main/specManager.js`) — packaged assets live
inside `app.asar` and the terminal CLI cannot read them.

The agent writes only `report-data.json` (spec metadata, per-task entries with
subject / what / why / test results / commit hash). The generator reads it,
pulls each commit's **real unified diff from git by hash**, and emits
`.frame/specs/<slug>/implement-report.html` — self-contained, no external
assets. Diffs are never transcribed by the agent; that is the one place
hallucination would silently corrupt the artifact, and it is why the report is
generated rather than written.

Per-commit diffs exclude `.frame/` and the report's own files, so the report
shows implementation only and not its own bookkeeping.

### 7. Asking without assuming a specific tool

The prompt does not name one question mechanism. It instructs: use your
built-in structured-question tool if you have one, otherwise present the
options as a numbered list. A tool that exists can be called; one that does not
cannot — the instruction resolves itself.

The fallback path carries a hard rule: after presenting the options, **stop and
wait**. Do not pick a mode on the user's behalf, do not proceed with a
"reasonable default", write no code until the user answers. This is the
fragile half — agents left without a blocking tool tend to self-select and
continue.

## Constraints

- **Template-first.** The mode machinery lives in the prompt template and in
  `status.json` / `.frame/config.json`. No new IPC, renderer, or modal work.
- **Zero-touch.** Every artifact lives under `.frame/` — `report-data.json` and
  `implement-report.html` in the spec folder, the generator staged into
  `.frame/runtime/assets/`. Nothing is written to `docs/` or `.claude/`.
- **No stack assumptions** in shipped templates. Verification resolves through
  `.frame/config.json` `project.commands`; commit message conventions are not
  hardcoded to any scope vocabulary.
- **`status.json` stays additive.** `implement_mode` is a new optional field.
  `validateSpecStatus` (`src/main/specManager.js:91`) checks required fields
  only and every `writeStatus` call spreads the existing object, so unknown
  keys survive — no schema change is needed and none may be introduced.
- **Existing lifecycle unchanged** — `derivePhase`, the specs watcher, tasks
  sync, and the Tasks panel need no changes.
- **Template override precedence preserved** — a project's
  `.frame/templates/commands/claude-code/spec.implement.md` still wins.
- **Never push**, in any mode. Local commits only unless the user asks.
- Orchestration is untouched, but **must not be foreclosed**: the mode
  definitions stay readable independently of `spec.implement.md`'s dispatch
  path, so a later spec can teach the worker to honor
  `status.json.implement_mode` without restructuring this work.
- `codex` / `gemini` template directories stay empty; this remains Claude
  Code-only in practice, and `getCommandPrompt` has no cross-tool fallback
  (`src/main/specManager.js:285`).

## Success Criteria

- Dispatching `spec.implement` on a spec with no resolved mode asks the user
  which flow to use before any file is edited, and the autonomous option's
  description names the HTML report, the per-task diff, and the test result.
- Choosing a mode writes `implement_mode` into `status.json`; a second dispatch
  on the same spec does not re-ask.
- After a mode is chosen by asking, the user is offered the project-wide
  default once; accepting writes it to `.frame/config.json`, and a *different*
  spec in the same project then runs without being asked.
- **Step by step** ends each task with a what-changed / why-changed report and
  exactly one question; answering "continue" proceeds to the next task in the
  same run.
- **Autonomous + report** completes a multi-task spec in one run with one
  commit per task, `outcome.md` carrying one entry per task, and
  `implement-report.html` opening standalone and showing every task's real diff
  and test result.
- The report's per-commit diffs contain no `.frame/` paths and no report files.
- A user-described flow runs as described **and** still leaves `tasks.json`
  statuses, `status.json` phase, and `outcome.md` correct.
- On a CLI with no structured-question tool, the run presents numbered options
  and stops — no code is written until the user answers.
- `spec.plan`, `spec.tasks`, and the orchestration worker behave exactly as
  before.

## Out of Scope

- Teaching the orchestration worker to honor implement modes (`WORKER.md`,
  `buildWorkerPrompt`) — a follow-up spec; this one only avoids blocking it.
- A "View Implementation Report" button in the spec detail panel — mirrors the
  plan-report button and belongs in a UI-side spec.
- Rendering the report inside Frame.
- `codex` / `gemini` variants of any mode.
- Editing, listing, or deleting saved custom flows from the UI.
- Migrating specs already implemented under the current flow.
- Report versioning across re-runs.

## Open Questions

- **Where a saved custom flow's text lives.** Inline in `.frame/config.json`
  (single file, but a multi-paragraph description inside a config JSON) or a
  separate file referenced from it (e.g. `.frame/implement-flow.md`). The
  description can be long; config files are usually read whole.
  Recommendation: separate file, referenced by name from config.
- **Whether "Describe your own" re-asks per spec.** A saved custom flow becomes
  the project default and stops the asking. But before it is saved, does a
  custom description apply to just the current spec, or the current run? If the
  user declines to save it, replaying it on the next dispatch requires storing
  it in `status.json` anyway.
- **How the autonomous mode picks its verification command** when
  `project.commands` is absent or wrong (`test: "npm test"` in a project with
  no tests). Fall back to "no check", infer from the changed files, or ask
  once and remember?
- **Whether the report generator is Node-only.** Staging a `.mjs` and running
  `node` assumes Node on the user's PATH. It is present for any Frame user
  running the Electron app, but the terminal CLI may run elsewhere (a
  container, a remote host). Accept the assumption, or have the agent write
  the HTML when `node` is unavailable?
- **Commit granularity in Step by step.** The mode asks "commit and continue" —
  does it commit only the code, or also `tasks.json` / `outcome.md` /
  `status.json` as the autonomous mode does? Consistency argues for the same
  atomic shape.

RESOLVED at spec time:
- Rich mode **requires** the HTML report — it is not optional, and the picker
  must sell it in concrete terms (decided 2026-07-20).
- Report is **generated from `report-data.json`**, not written by the agent, so
  diffs come from git (decided 2026-07-20).
- Mode is asked **in the prompt**, adapting to whatever question mechanism the
  CLI has, rather than through Frame UI (decided 2026-07-20).
- Mode persists per spec in `status.json`; Frame offers to save it as the
  project-wide default in `.frame/config.json` (decided 2026-07-20).
- User-described flows **inherit the shared core** and may not drop task/phase
  accounting (decided 2026-07-20).
