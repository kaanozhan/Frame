# Plan — Conductor Orchestration (V1)

## Architecture

Three actors; Frame is the nervous system + isolation layer between them:

```
USER        → assigns specs, steers the conductor, enters any worker lane by hand
  │
CONDUCTOR   → a specialized Frame (real Claude + CONDUCTOR.md). Validates specs,
(1 lane)      checks inter-spec footprint conflicts, dispatches parallel-safe
              specs, reads done-reports, merges into integration branches.
  │
WORKERS     → one Frame per spec, each in its own worktree+branch. Runs the
(N lanes)     spec's tasks.md sequentially. Commits to own branch only.
  │
FRAME       → never decides. Provides the Orchestrator screen, worktree
(app)         isolation, the conductor↔Frame command channel, and a
              code-enforced conflict guard.
```

### Reuse map (what already exists)

| Need | Reused from |
|---|---|
| Worker status (`processing`/`waiting`/`idle`) | `laneStatus.js` |
| create lane → start agent → wait-ready → inject | `agentDispatch.js` |
| Worker cards + badges | `laneBoard.js` / lane card components |
| Drill into a worker terminal | lane detail (`mountTerminal`, `terminalManager.js`) |
| Spec list + phase | `specPanel.js` / `specSection.js`, `specManager` |
| Worktree add/remove | `gitBranchesManager.js` |
| Conductor terminal | normal lane/terminal machinery + `CONDUCTOR.md` |

New work: the conductor role, worktree-per-spec isolation, inter-spec
coordination + guard, and the orchestrator layout.

### The Orchestrator screen

A new renderer view (`orchestrator.js` + `orchestrator.css`) composing existing
parts into three zones:

```
┌───────────────────────────────┬──────────────┐
│ Conductor lane (top ~1/3)      │ Specs rail   │
│  + assigned-spec queue strip   │ (full height)│
├───────────────────────────────┤  tasks_      │
│ Worker lanes board (bottom 2/3)│  generated   │
│  scoped mini board + badges    │  → assign    │
└───────────────────────────────┴──────────────┘
```

- Opened from a **"Start Orchestrator"** card on the Home board.
- Right rail = `specSection`/`specPanel` filtered to assignable specs + an
  "assign to conductor" action.
- Top = conductor lane (a terminal lane flagged `role: conductor`).
- Bottom = a `laneBoard` instance filtered to lanes tagged with this
  orchestration session, reusing cards + `laneStatus`.
- Worker card click → existing full-screen lane detail, with a back-to-
  orchestrator control.

### Conductor → Frame command channel

The conductor is a Claude session bound to a shell; it triggers Frame actions
through `.frame/bin/` scripts (same pattern as `.frame/bin/codex`). Frame
injects an absolute `FRAME_ORCH_BUS` env var into the conductor + worker lanes
so the bus path is shared even though worktrees have separate `.frame/` copies.

- `dispatch.js <slug>` — conductor asks Frame to run a spec: create worktree +
  branch, spawn worker lane, dispatch agent + worker prompt.
- `report-done.js <slug>` — worker signals completion.
- `merge.js <slug>` — conductor asks Frame to merge the worker branch into the
  spec's integration branch (Frame runs the merge and reports conflicts cleanly,
  rather than the LLM hand-resolving).
- `status.js` — conductor queries current orchestration state as JSON
  (for rehydration / decisions).

`orchestrationManager` (new, main process) watches `FRAME_ORCH_BUS` (debounced
`fs.watch`, atomic write+rename, unique filenames), executes requests, and
relays worker reports into the conductor lane (reusing the inject path).

### Worktree mechanics + conflict guard

- On a `dispatch` request: `gitBranchesManager.addWorktree` creates
  `.frame/worktrees/<slug>` on branch `frame/<slug>/work` from current `HEAD`.
- **Code-enforced guard:** before creating, `orchestrationManager` compares the
  spec's declared footprint against in-flight specs' footprints; on overlap it
  **refuses** and tells the conductor to serialize — the safety net does not
  depend on the prompt.
- **Footprint source:** each spec's `plan.md` declares a structured, parseable
  footprint (e.g. a `## Footprint` list). `specManager` gains a
  `getSpecFootprint(slug)` parser. (Generating good footprints is a small
  plan-template improvement included here; richer per-task `acceptance/verify`
  is out of scope.)
- **Merge:** `merge.js` → `git -C <main> merge` of `frame/<slug>/work` into
  `frame/<slug>/integration`, after a `git diff --name-only` drift check vs the
  declared footprint. Meta files reconciled post-merge by the conductor.
- **Teardown (`STOP_ORCHESTRATION`):** stop worker lanes, `removeWorktree`,
  prune orphan `frame/<slug>/work` branches (keep un-merged work), leave main
  clean.

### Runtime state ownership

`orchestrationManager` holds ephemeral state only:

```
session = {
  workers: Map<slug, {
    worktreePath, branch, terminalId,
    status,        // queued | running | idle | done | blocked | failed
    diffStat, declaredFooprint, lastActivityAt
  }>,
  cap                // max concurrent workers
}
```

Source of truth stays in git (branch naming) + `.frame/specs/` + `tasks.json`.
On reopen, rehydrate best-effort from `frame/<slug>/*` branches + worktrees.

### Status (reuse + spec-granularity)

- `processing`/`waiting`/`idle` straight from `laneStatus` per worker lane.
- `done` from `report-done`; **soft-done** = idle + new commits + no report.
- `failed` = terminal/process exit; long-idle surfaced for the conductor.
- `blocked` = a spec held pending a conflicting predecessor's merge.

## Files

**New**
- `src/main/orchestrationManager.js` — session state, bus watcher, worktree
  lifecycle, conflict guard, merge runner, conductor relay, IPC.
- `src/renderer/orchestrator.js` — the three-zone orchestrator view (conductor
  lane + assigned-spec queue + scoped worker board), composing existing parts.
- `src/renderer/styles/components/orchestrator.css`.
- `src/templates/orchestration/CONDUCTOR.md` — conductor protocol: validate
  phase, read footprints, reason waves/serialization, dispatch/merge via
  `.frame/bin`, read reports, reconcile meta, rehydrate.
- `src/templates/orchestration/WORKER.md` — worker contract: do only this spec,
  tasks in order, own branch only, don't touch meta files, report done.
- `.frame/bin/` orchestration scripts (materialized per project via
  `frameTemplates`): `dispatch.js`, `report-done.js`, `merge.js`, `status.js`.

**Modified**
- `src/shared/ipcChannels.js` — orchestration channels (START/STOP, ORCH_STATE,
  OPEN_ORCHESTRATOR, etc.).
- `src/main/index.js` — register `orchestrationManager`.
- `src/main/ptyManager.js` — inject `FRAME_ORCH_BUS` into spawned env; expose
  `lastOutputAt` if not already (for soft-done/idle).
- `src/main/gitBranchesManager.js` — thin helpers for the `frame/<slug>/*`
  naming + worktree-under-`.frame/worktrees/` + branch pruning.
- `src/main/specManager.js` — `getSpecFootprint(slug)` parser; plan template
  emits a structured `## Footprint`.
- `src/shared/frameConstants.js` + `frameTemplates.js` — bus dir, worktree dir,
  `.frame/bin` orchestration script templates, CONDUCTOR/WORKER templates.
- Home board (`laneBoard.js` / `index.html`) — a "Start Orchestrator" card +
  route to the orchestrator view.
- `src/renderer/index.js` / `state.js` — wire the orchestrator view + session.
- `AGENTS.md`, `PROJECT_NOTES.md`, `STRUCTURE.json` — docs/structure.

## Footprint

- src/main/orchestrationManager.js
- src/renderer/orchestrator.js
- src/renderer/styles/components/orchestrator.css
- src/templates/orchestration/CONDUCTOR.md
- src/templates/orchestration/WORKER.md
- src/templates/commands/claude-code/spec.plan.md
- src/shared/ipcChannels.js
- src/shared/frameConstants.js
- src/shared/frameTemplates.js
- src/main/index.js
- src/main/ptyManager.js
- src/main/gitBranchesManager.js
- src/main/specManager.js
- src/renderer/laneBoard.js
- src/renderer/laneStatus.js
- src/renderer/agentDispatch.js
- src/renderer/specSection.js
- src/renderer/index.js
- src/renderer/state.js
- index.html

## Dependencies

None new. Reuses `node-pty`, `fs`, `child_process`, git, and the existing
lane/dispatch renderer modules.

## Sequencing

1. **Footprint foundation.** `specManager.getSpecFootprint` + plan template
   `## Footprint` section. Verify parse on this repo's specs.
2. **Bus + command channel.** `FRAME_ORCH_BUS` env injection; `.frame/bin`
   scripts; `orchestrationManager` bus watcher (atomic, debounced). Verify a
   manual `dispatch.js <slug>` reaches the manager.
3. **Worktree + worker spawn + guard.** Lazy `frame/<slug>/work` worktree from
   HEAD; spawn worker lane via the dispatch machinery; inject WORKER.md prompt;
   code-enforced conflict guard. Verify two disjoint specs isolate; an
   overlapping one is refused.
4. **Conductor lane + relay.** Conductor terminal with CONDUCTOR.md; relay
   `report-done` into it; soft-done + `failed` detection.
5. **Orchestrator screen.** Three-zone view: conductor (top), assignable spec
   rail (right), scoped worker board (bottom); worker card → lane detail;
   "Start Orchestrator" card on Home.
6. **Merge + lifecycle.** `merge.js` (drift check, integration branch); meta
   reconcile; bounded parallelism; `STOP_ORCHESTRATION` teardown; rehydration.
7. **Docs + structure.** `AGENTS.md`, `PROJECT_NOTES.md`, `npm run structure`.
