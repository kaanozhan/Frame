## T01 — Flagged-launch tracking on lanes (launchedAutonomous)

Added a module-level `launchedAutonomousLanes` Map to `src/renderer/agentDispatch.js`, set at the CLI start when a dispatch carried launch flags that the CLI kept (guarded on `!flagsDropped`), cleared on `TERMINAL_DESTROYED`, and exposed as `launchedAutonomous` on `getSpecLaneInfo` (gated on a live `agentName` so a dead-but-remembered lane never reports a session that no longer exists). No deviation from plan.md — the plan named the map `launchedAutonomousLanes` and this matches. Files touched: `src/renderer/agentDispatch.js`.

_Captured: 2026-07-22 · 1 file change_

---

## T02 — Expose implementHint on getSpec

Added `implementHint: resolveImplementLaunchHint(projectPath, slug)` to `getSpec`'s return in `src/main/specManager.js`. No deviation — `resolveImplementLaunchHint` already existed (D10 launch-hint work) with exactly the status.implement_mode → config implement.defaultMode → null precedence the task requires, so this only surfaces it on the spec payload for the modal and next-action button. Files touched: `src/main/specManager.js`.

_Captured: 2026-07-22 · 1 file change_

---

## T03 — Unified implement mode + destination modal

Created `src/renderer/implementModeModal.js`, a Promise-based `spec-modal-overlay` with the four mode entries (hinted mode preselected), a destination section shown only when the spec's lane is alive, autonomous "Continue" disabled with a stated reason and forced to a new Frame unless `lane.launchedAutonomous`, and Escape/backdrop/Cancel resolving null. Added the matching mode/destination styles to `src/renderer/styles/components/panels.css`. Deviation from plan: built as a dynamic overlay (agentDispatch's own idiom) rather than the pre-baked-HTML `taskConfirmModal` pattern the plan cited, because the reactive mode↔destination coupling makes dynamic markup the cleaner fit — the plan already allowed reusing the `spec-modal-overlay` idiom. Files touched: `src/renderer/implementModeModal.js`, `src/renderer/styles/components/panels.css`.

_Captured: 2026-07-22 · 2 file changes_

---

## T04 — Route spec.implement through the modal (ordering flip)

Branched `dispatchSpecCommand` in `src/renderer/agentDispatch.js`: `spec.implement` now goes through a new `_dispatchImplement` that opens the modal, records `implement_mode` via `UPDATE_SPEC_STATUS`, then stages (so launch flags derive from the recorded mode), then dispatches to the chosen destination — cancel writes and dispatches nothing. Rewrote the flags-dropped `notify.info` and the prompt note from the old "unavailable → step-by-step" copy to the guided-fallback wording. Non-implement commands keep the stage-first + `_askContinueOrNew` path unchanged. Files touched: `src/renderer/agentDispatch.js`.

_Captured: 2026-07-22 · 1 file change_

---

## T05 — Shared next-action bar with mode-driven label and lock

Created `src/renderer/specNextAction.js` (`nextActionForPhase` + `renderNextActionBar` + `taskCounts`): mode-driven implement label table, turn-scoped lock for step-by-step/custom/no-mode, and run-liveness lock for guided/autonomous (live lane ∧ pending tasks → locked across turn boundaries with "Running — X/Y tasks" and "Waiting for permission" on approval). Wired `specSection.js`, `specPanel.js`, `specsDashboard.js` to it and deleted their three local `nextActionForPhase`/`renderNextActionBar` copies, keeping each surface's own click wiring. Minor deviation: unified the previously-divergent idle labels onto specSection's descriptive set and dropped specSection's inline command-code chip, so one bar renders everywhere. Files touched: `src/renderer/specNextAction.js`, `src/renderer/specSection.js`, `src/renderer/specPanel.js`, `src/renderer/specsDashboard.js`.

_Captured: 2026-07-22 · 4 file changes_

---

## T06 — Rewrite spec.implement.md for v2 dispatch

Rewrote `src/templates/commands/claude-code/spec.implement.md`: a recorded `implement_mode` now runs its loop with no in-session picker; conversational entry offers step-by-step/guided/describe-your-own as runnable and resolves autonomous to one `status.json` write plus one handoff (Frame button + `node .frame/bin/implement-launch.js {slug}`). Added the guided mode (shares the autonomous loop, no flags, CLI prompts pace, same `report-data.json` contract), a flags-refused override that runs guided, and the described-flow skill lifecycle (detect/offer/save under `.claude/skills/<name>/SKILL.md`) superseding the `.frame/implement-flow.md`/`flowFile` mechanism. No deviation from plan; the `{project_path}`/`{slug}`/`{report_generator_path}` interpolation contract is unchanged. Files touched: `src/templates/commands/claude-code/spec.implement.md`.

_Captured: 2026-07-22 · 1 file change_

---

## T07 — Stage the implement template, generator and helper

Added `stageImplementCommandFiles` and a `copyIfChanged` content-diff helper to `src/main/specManager.js`, wired into the `WATCH_SPECS` handler (project open) and `buildSpecCommandFile` for `spec.implement`. It copies the raw `spec.implement.md` and `build-implement-report.mjs` into `.frame/runtime/commands/claude-code/` (override→packaged precedence) and the launch helper into `.frame/bin/`; imported `FRAME_BIN_DIR`. No deviation; a missing helper source (until T08) and unchanged destinations are both skipped, and the staged files are gitignored so only `specManager.js` is tracked. Files touched: `src/main/specManager.js`.

_Captured: 2026-07-22 · 1 file change_

---

## T08 — The launch helper plus its tests

Wrote `src/templates/bin/implement-launch.js`, a self-contained helper: records `implement_mode: autonomous`, writes `.frame/implement-permissions.json` (own copies of specManager's allow/deny sets and the test→lint→build verification resolution), resolves the raw template (override → staged), interpolates and stages the prompt, ensures the report generator, then execs `claude --settings <abs> --permission-mode auto "Read <rel> …"` with a clear error when `claude` is off PATH. Everything above `main()` is pure and require-able; added `test/implementLaunch.test.js` (14 tests) covering interpolation, verification resolution, permission-file shape, launch-line composition and template resolution order. No deviation from plan. Files touched: `src/templates/bin/implement-launch.js`, `test/implementLaunch.test.js`.

_Captured: 2026-07-22 · 2 file changes_

---

## T09 — Live-followable implementation report (--open, progress banner, reload note)

Added three things to `src/templates/commands/claude-code/build-implement-report.mjs`: a `--open` flag that opens the written HTML in the default browser (detached `spawn`, best-effort, never fails the build — `openCommand` maps darwin/win32/linux, purely and testably); a top-of-report run-status banner rendered by the new pure `renderProgress` from a `{ total, completed, current }` object that `computeProgress` derives from `tasks.json` (`source spec:{slug}:*`) in `main()`, keeping `renderReport` clock/fs-free; and a `truncateTitle` clamp because the "next" task's title comes from `tasks.json` (a full sentence) and was flooding the banner. `spec.implement.md`'s "Producing the report" now passes `--open` on the first generation only. Per mid-run feedback the reload note is bright (`--text-primary`) with an inline info glyph and reads "Regenerated after each task. Reload for the latest.". Extended `test/implementReport.test.js` (+11 tests, 35 total); full suite 133/133. Files touched: `build-implement-report.mjs`, `spec.implement.md`, `test/implementReport.test.js`.

_Captured: 2026-07-22 · 3 file changes_

---
