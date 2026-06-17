# Conductor Orchestration — parallel spec execution in isolated worktrees

> **What we're building:** an **Orchestrator** — a specialized Frame opened from
> the Home board — where a **conductor agent** (a real Claude session) is given
> several ready specs and runs them **in parallel, one agent per spec, each in
> its own git worktree**. The conductor validates readiness, checks inter-spec
> file conflicts, spawns an isolated worker Frame per spec, and manages merge
> order. The user watches the orchestrator board and can drop into any worker
> lane's live terminal to continue by hand. Frame coordinates and isolates; it
> never decides — the conductor + the user do.

---

## Background — what this builds on

The lane/dispatch foundation already shipped (PRs #86, #87) and this spec sits
directly on top of it:

- **Lane Orchestrator** (`lane-orchestrator` spec): Home is a board of lane
  cards; lane = terminal; cards carry live `laneStatus` badges
  (`processing` / `waiting` / `idle`); enter/leave/switch; grid survives.
- **Agent Dispatch** (`agent-dispatch` spec): a single choke point that creates
  a lane, starts the agent, **waits for an agent-ready signal** (no blind
  timeouts), then injects the prompt. Specs already get a **lane assignment**.
- The `lane-orchestrator` spec explicitly deferred **"Lane = work-context model
  (lane bundling spec + tasks + branch metadata)"** to a future spec. **This is
  that spec** — it enriches a lane into a worktree-isolated spec workspace and
  adds a conductor that coordinates several of them.

This spec supersedes the earlier task-level-parallelism draft of
`agent-orchestration` (which predated the lane/dispatch foundation and the
spec-level pivot).

---

## Problem

Frame can now run a single spec in a single Frame, user-driven, with reliable
prompt delivery. But running **several specs at once, safely**, is still
impossible:

1. **No isolation.** Every Frame shares the one working tree. Two agents working
   at once collide; there is no per-spec sandbox.
2. **No coordination.** Nothing decides which specs can run together, in what
   order, or how their results come back together.
3. **No supervisor.** The user must personally start each run, watch each lane,
   and merge by hand. There is no agent that owns "run these specs and bring me
   the results."

The unit of safe parallelism is the **spec**: a spec's own tasks are
interdependent and belong to one agent running them in sequence; *different*
specs are the coarser, more independent units that parallelize well.

---

## Goal

### 1. The Orchestrator (a specialized Frame)

- A **"Start Orchestrator"** card on the Home board opens the Orchestrator: a
  full-screen specialized Frame view (tab bar is retired), with a Home return.
- Layout (confirmed):
  - **Right rail — Specs (full height):** the project's specs. Only specs at
    phase `tasks_generated` or beyond are **assignable** to the conductor;
    others are shown but not assignable.
  - **Top-left (~1/3) — Conductor terminal:** a real Claude lane running with
    `CONDUCTOR.md` loaded. The user can type into it to steer.
  - **Bottom-left (~2/3) — Worker lanes board:** a board scoped to *this*
    orchestration's worker lanes — compact cards with `laneStatus` badges. As
    the conductor dispatches specs, worker lanes appear here automatically.
- Clicking a worker card opens the **standard full-screen lane detail**
  (existing `mountTerminal`) with a "return to Orchestrator" affordance.

### 2. Assign ready specs to the conductor

- From the right rail, the user assigns one or more `tasks_generated` specs to
  the conductor (e.g. an "assign" affordance per spec).
- Assigned specs appear in the conductor's queue (surfaced near the conductor
  terminal). The user tells the conductor to run them.

### 3. Conductor runs specs in parallel, isolated

- On "run", the conductor:
  1. **Validates** each assigned spec is `tasks_generated` (spec + plan + tasks
     present). Not-ready specs are reported and skipped.
  2. **Checks inter-spec conflicts** from each spec's declared **footprint**
     (the files/areas its plan touches). Specs with disjoint footprints run in
     parallel; specs whose footprints overlap are **serialized**.
  3. **Dispatches** each parallel-safe spec: Frame **creates a git worktree +
     branch** for it (lazily, from current `HEAD`), spawns a worker Frame in
     that worktree, starts the agent, waits for ready, and injects the worker
     prompt. A worker lane card appears in the bottom board.
- The worker agent works **only** on its spec, running its `tasks.md`
  **sequentially** in its worktree, and **commits to its own branch only** —
  never pushes, never merges.

### 4. Worktrees — orchestration-only, lazy

- Worktrees are created **only** in the orchestrator, and **only** at the moment
  the conductor is about to run a spec (not when the spec is authored, not for
  normal single-spec/task runs outside the orchestrator).
- One worktree + branch per spec: `frame/<slug>/work`, under
  `.frame/worktrees/<slug>/` (kept out of git via the non-invasive
  `.git/info/exclude` model; never pollutes the main tree).
- Branched from current `HEAD` at dispatch time, so a serialized spec picks up
  already-merged work.

### 5. Completion, review, merge

- When a worker finishes (reports done, or **soft-done**: branch has commits +
  lane gone idle with no report), its card flips to `done` and the conductor
  terminal receives a report (branch, diff stat).
- **Merge is local, conductor-driven, into a per-spec integration branch**
  (`frame/<slug>/integration`) — **not** a PR. Before merging, the conductor
  checks the worker's *actual* `git diff --name-only` against the declared
  footprint (drift backstop). `main` is never touched by orchestration; pushing
  / opening a PR stays a separate, user-driven step (existing GitHub support).
- After merge the conductor reconciles meta files (regenerate `STRUCTURE.json`,
  reconcile `tasks.json` status, append to `PROJECT_NOTES.md`).

### 6. The user stays in control

- The user can enter any worker lane and continue manually; the **done report
  stays the single sync point** so manual work and conductor belief don't
  silently diverge.
- The user can **stop the orchestration**: workers stopped, worktrees removed,
  orphan branches pruned (un-merged work kept on its branch), main left intact.

---

## Constraints

- **Builds on lane/dispatch, does not reinvent it.** Reuses `laneStatus`
  detection, the `agentDispatch` create→start→wait-ready→inject machinery, lane
  cards, lane detail, and the spec panel. New work is the conductor, the
  worktree isolation, the inter-spec coordination, and the orchestrator layout.
- **Main-process work is required and accepted here.** Unlike `agent-dispatch`
  (renderer-only), worktree creation is inherently a git/main-process operation
  (`gitBranchesManager`). This spec deliberately adds a main-process
  orchestration layer.
- **Spec-level parallelism only.** No intra-spec task parallelism: one agent
  runs a spec's tasks sequentially. A too-large spec is split into multiple
  specs, not parallelized internally.
- **Conductor-centric, code-enforced safety.** The conductor decides what/when
  to dispatch, but Frame **deterministically refuses** to create a worktree for
  a spec whose footprint overlaps an in-flight spec — safety lives in code, not
  only in the prompt.
- **Workers never push/merge.** Only the conductor (or the user) merges, locally.
- **Bounded parallelism.** A configurable cap on concurrent workers, bounded by
  the per-project terminal limit minus the conductor.
- **Worker lanes persist after done/failure** (never auto-killed) so the user
  can resume by hand.
- **Non-invasive.** Worktrees and orchestration artifacts live under `.frame/`;
  the tracked tree and `.gitignore` are never modified.
- **Self-contained agent instructions.** `CONDUCTOR.md` and the worker prompt
  are plain markdown so any AI tool can follow them without a Frame runtime.
- **V1 tool scope: claude-code only** for the conductor; other tools later.

## Success Criteria

1. **Open:** "Start Orchestrator" on Home opens the orchestrator with the three
   zones; the right rail lists specs and only `tasks_generated` ones are
   assignable.
2. **Assign + run:** assigning two disjoint-footprint specs and telling the
   conductor to run spawns **two worker lanes**, each in its **own worktree +
   branch**, each running its tasks sequentially — visible in the bottom board.
3. **Conflict safety:** two specs with overlapping footprints are **not** run in
   parallel; the second is serialized (and Frame refuses a conflicting worktree
   even if asked).
4. **Isolation:** each worker's changes land only in its worktree/branch; the
   main working tree is untouched during runs.
5. **Drill-in:** clicking a worker card opens its live terminal; the user can
   type and continue; the lane is not killed when it finishes.
6. **Completion + merge:** a finished worker shows `done`, reports to the
   conductor, and the conductor merges its branch into the spec's integration
   branch locally — with a pre-merge drift check — without touching `main`.
7. **Soft-done / failure:** a worker that commits but never reports is surfaced
   as soft-done; a crashed/stuck worker is surfaced as `failed`/long-idle, not
   silently hung.
8. **Stop:** stopping the orchestration removes worktrees and prunes orphan
   branches, keeps un-merged work, and leaves the main repo clean.

## Out of Scope

- **Intra-spec task parallelism** (one agent per spec, sequential tasks).
- **Auto-merge to `main` / auto-PR** — merge target is the integration branch;
  promotion to main / PR is user-driven via existing GitHub support.
- **Task/spec status auto-sync back** beyond the conductor's post-merge
  reconcile (deeper auto-completion is future).
- **Multi-tool conductors** (claude-code only in V1).
- **Persisting orchestration state across app restarts** (rehydrate from
  branches/worktrees is best-effort; full persistence later).
- **Per-task `acceptance`/`verify` generation** — valuable but a separate
  generation-quality improvement; this spec relies on sequential execution +
  the human-in-loop review, not automated per-task gating.
- **Remote / web / multi-user (team mode).**
