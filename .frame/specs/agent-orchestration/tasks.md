# Tasks — Conductor Orchestration (V1)

Grouped by the plan's 7-step sequencing. Each task lists its file footprint as a
sub-bullet (parser ignores sub-bullets; they document the footprint this very
feature consumes). Meta files (`tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`,
`AGENTS.md`) are excluded from conflict analysis by design.

## Phase 1 — Footprint foundation

- T01 · Add a structured `## Footprint` section to the plan command template so generated plans declare touched files
  - footprint: src/shared/frameTemplates.js
- T02 · Implement specManager.getSpecFootprint to parse the `## Footprint` list from a spec's plan.md
  - footprint: src/main/specManager.js

## Phase 2 — Bus + command channel

- T03 · Add orchestration constants (FRAME_ORCH_BUS dir, .frame/worktrees dir, frame/<slug>/* branch naming) to frameConstants
  - footprint: src/shared/frameConstants.js
- T04 · Add .frame/bin orchestration script templates (dispatch, report-done, merge, status) to frameTemplates
  - footprint: src/shared/frameTemplates.js
- T05 · Inject FRAME_ORCH_BUS env into spawned terminals and expose per-terminal lastOutputAt in ptyManager
  - footprint: src/main/ptyManager.js
- T06 · Create orchestrationManager skeleton with a debounced, atomic (write+rename) bus watcher
  - footprint: src/main/orchestrationManager.js
- T07 · Add orchestration IPC channels (START/STOP_ORCHESTRATION, ORCH_STATE, OPEN_ORCHESTRATOR)
  - footprint: src/shared/ipcChannels.js
- T08 · Register orchestrationManager (init + setupIPC) in the main process entry
  - footprint: src/main/index.js

## Phase 3 — Worktree + worker spawn + conflict guard

- T09 · Add gitBranchesManager helpers for frame/<slug>/* naming, .frame/worktrees placement, and orphan-branch pruning
  - footprint: src/main/gitBranchesManager.js
- T10 · Implement lazy worktree creation from current HEAD and worker lane spawn on a dispatch request
  - footprint: src/main/orchestrationManager.js
- T11 · Author WORKER.md prompt template (own spec only, tasks sequentially, own branch only, don't touch meta files, report done)
  - footprint: src/templates/orchestration/WORKER.md
- T12 · Bridge worker dispatch through agentDispatch (start agent, wait agent-ready, inject worker prompt)
  - footprint: src/renderer/agentDispatch.js, src/renderer/orchestrator.js
- T13 · Code-enforced conflict guard: refuse a worktree whose declared footprint overlaps an in-flight spec
  - footprint: src/main/orchestrationManager.js

## Phase 4 — Conductor lane + relay + status

- T14 · Author CONDUCTOR.md protocol (validate phase, read footprints, reason waves/serialization, dispatch/merge via .frame/bin, read reports, reconcile meta, rehydrate)
  - footprint: src/templates/orchestration/CONDUCTOR.md
- T15 · Start the conductor lane with CONDUCTOR.md loaded and relay report-done into the conductor terminal
  - footprint: src/main/orchestrationManager.js, src/renderer/orchestrator.js
- T16 · Derive worker status: laneStatus passthrough + soft-done (idle + commits + no report) + failed/long-idle
  - footprint: src/main/orchestrationManager.js, src/renderer/laneStatus.js

## Phase 5 — Orchestrator screen

- T17 · Add a "Start Orchestrator" card on the Home board and route to the orchestrator view
  - footprint: src/renderer/laneBoard.js, index.html
- T18 · Build orchestrator.js three-zone view (conductor top-left, spec rail right, worker board bottom-left)
  - footprint: src/renderer/orchestrator.js
- T19 · Spec rail: filter to assignable (tasks_generated) specs, add assign-to-conductor action and the assigned-spec queue strip
  - footprint: src/renderer/orchestrator.js, src/renderer/specSection.js
- T20 · Scoped worker board (reuse laneBoard) with worker card → full lane detail and return-to-orchestrator
  - footprint: src/renderer/orchestrator.js, src/renderer/laneBoard.js
- T21 · Orchestrator screen styles
  - footprint: src/renderer/styles/components/orchestrator.css

## Phase 6 — Merge + lifecycle

- T22 · Implement merge.js flow: pre-merge diff drift check + merge worker branch into frame/<slug>/integration
  - footprint: src/main/orchestrationManager.js
- T23 · Post-merge meta reconcile (regenerate STRUCTURE.json, reconcile tasks.json status, append PROJECT_NOTES) — protocol + manager support
  - footprint: src/templates/orchestration/CONDUCTOR.md, src/main/orchestrationManager.js
- T24 · Enforce bounded parallelism cap (queue beyond maxWorkers, respect per-project terminal limit minus conductor)
  - footprint: src/main/orchestrationManager.js
- T25 · STOP_ORCHESTRATION teardown (stop workers, remove worktrees, prune orphan branches, keep un-merged work)
  - footprint: src/main/orchestrationManager.js, src/main/gitBranchesManager.js
- T26 · Best-effort rehydration from frame/<slug>/* branches + worktrees on reopen
  - footprint: src/main/orchestrationManager.js

## Phase 7 — Docs + structure

- T27 · Document the orchestration convention (conductor/worker, .frame/bin commands, CONDUCTOR.md) in AGENTS.md
  - footprint: AGENTS.md
- T28 · Capture the orchestration design decision in PROJECT_NOTES.md and refresh STRUCTURE.json
  - footprint: PROJECT_NOTES.md, STRUCTURE.json
