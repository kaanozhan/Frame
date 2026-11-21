# Plan — Full-auto spec flow

## Architecture

### Resolved plan-time decisions

- **D1 · How the full-auto session starts after `spec.new` (business, asked).**
  Chosen: Frame opens the flagged lane itself as soon as the agent records
  `flow_mode: "full-auto"`. Rejected: the agent tells the user to click a
  Start button. Why: the user's goal is "start to finish with no
  interruption"; an extra click is exactly the hand-off this spec removes.
- **D2 · How Generate Plan offers the choice (business, asked).** Chosen: a
  small modal (Step by step / Full auto, last choice preselected), the same
  pattern as the implement mode modal. Rejected: a second button beside
  Generate Plan. Why: one door per phase, consistent with implement-modes-v2's
  "mode chosen before the session" modal.
- **D3 · Test posture (technical, asked).** Chosen: pure logic only — the new
  rules go into dependency-free modules tested with `node --test`; DOM modals
  are not tested. Why: matches the project's testing record (pure modules
  covered, DOM-coupled renderer code not covered).
- **D4 · One session, flagged (business, settled with the user before the
  gate).** The rest of the run (plan → tasks → implement → outcome) runs in
  one new session launched with the autonomous flags
  (`--settings <perms> --permission-mode auto`). Implement runs in the
  autonomous mode. Why: permissions can only be granted at launch
  (implement-modes-v2); one session keeps the run uninterrupted.
- **D5 · How one session runs three phases (technical, silent).** Chosen: a
  new orchestrating template `spec.auto.md`. Staging `spec.auto` also stages
  the interpolated `spec.plan`, `spec.tasks` and `spec.implement` prompts and
  names them in order; the agent reads each in turn, starting at the spec's
  current phase. Rejected: concatenating the three templates into one
  prompt. Why: the three templates stay the single source of each phase
  (cli-spec-command-parity); resume-from-phase is just "skip the prompts for
  phases already done".
- **D6 · How the phase templates know they are in full auto (technical,
  silent).** Each reads `flow_mode` from `status.json`, which it already
  reads. `spec.plan`'s gate: when `full-auto`, ask nothing — pick the
  recommended option for every fork (test posture included: the option that
  matches the record's convention) and mark each decision
  `(auto-decided — full auto)`. `spec.implement`'s pre-flight: when
  `full-auto`, a dirty tree made only of this spec's plan artifacts is
  committed as a plan commit without asking; foreign changes and `main` still
  stop and ask. Why: no second prompt source, no new variable plumbing.
- **D7 · Codex (technical, silent).** Full auto is Claude Code only for now,
  like autonomous: the launch flags are Claude Code's and the launcher
  resolves claude-code paths (`toolVocabulary` already says so for
  autonomous). A new dialect value `full_auto_offer` tells Codex's `spec.new`
  to stop after the spec without offering full auto. Why: offering a mode the
  CLI cannot run sends the user in a circle. This narrows the spec's "Codex
  gets the same flow" constraint; the question wording still comes from the
  dialect.
- **D8 · What the trigger listens to (technical, silent).** The renderer
  starts a full-auto run only on a live *transition* it observes: a spec bound
  to a lane in this window (`specLanes`) whose previous `SPEC_DATA` snapshot
  had no `flow_mode: "full-auto"` and whose new one does, at phase
  `specified`. Opening a project, `git pull`, or another window's write never
  starts a run; those specs show "Resume Full Auto" instead. Why: a file
  write on its own must never launch an agent with elevated permissions.
- **D9 · Resume and switching back (technical, silent).** When a spec has
  `flow_mode: "full-auto"`, is not `done` and has no live run, the
  next-action button reads "Resume Full Auto…" in every phase and opens the
  same flow modal with Full auto preselected; choosing Step by step there
  records `step-by-step` and runs that phase's normal command. Why: one
  surface to leave full auto, no extra button.
- **D10 · Bare CLI hand-off (technical, silent).** `implement-launch.js`
  gains `--full-auto`: it records `flow_mode: "full-auto"` and
  `implement_mode: "autonomous"`, stages the four prompts from the staged
  templates, and execs claude with the flags and the `spec.auto` prompt. The
  `spec.new` agent prints `node .frame/bin/implement-launch.js <slug>
  --full-auto` for the case Frame is not running. Why: implement-modes-v2
  made this helper the single source of flagged launches outside Frame.
- **D11 · Flags refused (technical, silent).** If the CLI refuses the flags,
  the existing bare-retry fallback applies; the Frame note tells the agent to
  keep plan and tasks auto-decided and run implement guided. Why: reuses
  `flagsDroppedNote` as-is.
- **D12 · Analytics (technical, silent).** No new analytics event. Why: an
  enum change requires a `PRIVACY.md` change; `flow_mode` in status.json is
  enough for now.

### Data

- `status.json` gains optional `flow_mode`: `"step-by-step" | "full-auto"`.
  Absent means today's behavior. `implement_mode` is unchanged and is set to
  `"autonomous"` by Frame (or the helper) before a full-auto launch.
- `SPEC_DATA` list entries carry `flow_mode` only when present (same
  payload-size rule as `reports`).

### Components

- **`src/shared/specFlow.js` (New, pure).** `FLOW_MODES`,
  `normalizeFlowMode(status)`, `shouldStartFullAuto(prevEntry, nextEntry,
  isBound)`, `fullAutoResumeAction(entry, laneAlive)`,
  `fullAutoStageLabel(phase, counts, laneStatus)` ("Full auto · planning",
  "· tasks", "· implementing 3/7"; "Full auto · needs you" when the live
  agent is idle waiting for input — a stop condition was hit).
- **Templates.** New `spec.auto.md`; `spec.new.md` "After writing" asks the
  flow question via `{ask_mechanism}` and `{full_auto_offer}`;
  `spec.plan.md` Stage 2 gets the full-auto branch; `spec.implement.md`
  pre-flight gets the full-auto plan-commit rule.
- **Main.** `specManager`: `spec.auto` in `SUPPORTED_COMMANDS`;
  `buildSpecCommandFile('spec.auto')` stages the three phase prompts and the
  auto prompt (vars `plan_prompt_path`, `tasks_prompt_path`,
  `implement_prompt_path`) and returns launch flags; launch flags generalize
  from `spec.implement`-only to `spec.implement` (autonomous hint) and
  `spec.auto` (always, Claude Code only); list entries carry `flow_mode`.
  `commandStaging` stages `spec.auto.md`.
- **Server.** `src/server/specs.js`: `spec.auto` in `COMMANDS`,
  `flow_mode` in `STATUS_KEYS`.
- **Renderer.** New `flowModeModal.js` (Step by step / Full auto).
  `agentDispatch`: `dispatchFullAuto({ slug, title })` = record
  `flow_mode` + `implement_mode` → stage `spec.auto` → dispatch to a new lane
  with flags → `expectReport` plan and implement; `dispatchSpecCommand`
  routes `spec.plan` through the modal and `spec.auto` to `dispatchFullAuto`;
  `_onSpecData` applies `shouldStartFullAuto`. `specNextAction`: the
  full-auto resume action and the run-liveness lock with the stage label.

## Files

- `src/shared/specFlow.js` — **New** — pure flow-mode rules: normalize, trigger, resume action, stage label.
- `test/specFlow.test.js` — **New** — tests for `specFlow.js`.
- `src/templates/commands/claude-code/spec.auto.md` — **New** — the orchestrating full-auto prompt.
- `src/templates/commands/claude-code/spec.new.md` — **Modified** — ask the flow question after writing; record `flow_mode`; hand-off wording.
- `src/templates/commands/claude-code/spec.plan.md` — **Modified** — full-auto branch of the decision gate.
- `src/templates/commands/claude-code/spec.implement.md` — **Modified** — full-auto plan-commit rule in pre-flight.
- `scripts/toolVocabulary.js` — **Modified** — `full_auto_offer` dialect value for claude-code and codex.
- `test/toolVocabulary.test.js` — **Modified** — pin `full_auto_offer` for both CLIs.
- `src/main/specManager.js` — **Modified** — `spec.auto` command, sub-prompt staging, launch flags, `flow_mode` in list entries.
- `test/specAutoStaging.test.js` — **New** — `buildSpecCommandFile('spec.auto')` stages all prompts, names them, returns flags; Codex gets none; `flow_mode` in list entries.
- `src/main/commandStaging.js` — **Modified** — stage `spec.auto.md`.
- `test/commandStaging.test.js` — **Modified** — `spec.auto.md` is staged.
- `src/server/specs.js` — **Modified** — accept `spec.auto` and `flow_mode`.
- `test/serverSpecs.test.js` — **Modified** — `specs.status` accepts `flow_mode`; `specs.stage` accepts `spec.auto`.
- `src/templates/bin/implement-launch.js` — **Modified** — `--full-auto` mode.
- `test/implementLaunch.test.js` — **Modified** — `--full-auto` argument parsing, recorded modes, staged prompt names.
- `src/renderer/flowModeModal.js` — **New** — Step by step / Full auto modal.
- `src/renderer/agentDispatch.js` — **Modified** — `dispatchFullAuto`, modal routing for `spec.plan`, transition trigger in `_onSpecData`.
- `src/renderer/specNextAction.js` — **Modified** — `nextActionForPhase(phase, status)`: resume action and full-auto locked bar.
- `src/renderer/specSection.js` — **Modified** — pass the spec's status to `nextActionForPhase`.
- `src/renderer/specPanel.js` — **Modified** — pass the spec's status to `nextActionForPhase`.
- `src/renderer/specsDashboard.js` — **Modified** — pass the spec's status to `nextActionForPhase`.

## Footprint

- src/shared/specFlow.js
- test/specFlow.test.js
- src/templates/commands/claude-code/spec.auto.md
- src/templates/commands/claude-code/spec.new.md
- src/templates/commands/claude-code/spec.plan.md
- src/templates/commands/claude-code/spec.implement.md
- scripts/toolVocabulary.js
- test/toolVocabulary.test.js
- src/main/specManager.js
- test/specAutoStaging.test.js
- src/main/commandStaging.js
- test/commandStaging.test.js
- src/server/specs.js
- test/serverSpecs.test.js
- src/templates/bin/implement-launch.js
- test/implementLaunch.test.js
- src/renderer/flowModeModal.js
- src/renderer/agentDispatch.js
- src/renderer/specNextAction.js
- src/renderer/specSection.js
- src/renderer/specPanel.js
- src/renderer/specsDashboard.js

## Dependencies

None.

## Sequencing

1. Add `src/shared/specFlow.js` (flow modes, `normalizeFlowMode`,
   `shouldStartFullAuto`, `fullAutoResumeAction`, `fullAutoStageLabel`) with
   `test/specFlow.test.js`.
2. Carry `flow_mode` through main and server: list entries in
   `specManager.listSpecsCore`, `STATUS_KEYS` in `src/server/specs.js`;
   extend `test/specAutoStaging.test.js` (list entry) and
   `test/serverSpecs.test.js` (status key).
3. Add `full_auto_offer` to `scripts/toolVocabulary.js` (claude-code: offer
   Step by step / Full auto and the hand-off; codex: stop after the spec,
   full auto not available yet) with `test/toolVocabulary.test.js`.
4. Write `spec.auto.md` and register it: `SUPPORTED_COMMANDS`,
   `COMMAND_TEMPLATE_FILES`, server `COMMANDS`;
   `buildSpecCommandFile('spec.auto')` stages the three phase prompts and the
   auto prompt with their paths; launch flags for `spec.auto` (Claude Code
   only). Tests in `test/specAutoStaging.test.js`,
   `test/commandStaging.test.js`, `test/serverSpecs.test.js`.
5. Update the phase templates: `spec.plan.md` full-auto gate branch,
   `spec.implement.md` full-auto pre-flight rule.
6. Update `spec.new.md` "After writing": ask the flow question with
   `{ask_mechanism}`, record `flow_mode`, state the hand-off
   (`{full_auto_offer}`), stop.
7. Add `--full-auto` to `implement-launch.js` (record both modes, stage the
   four prompts from the staged templates, exec with flags and the auto
   prompt) with `test/implementLaunch.test.js`.
8. Add `src/renderer/flowModeModal.js` and `agentDispatch.dispatchFullAuto`;
   route `spec.plan` through the modal (Step by step → record and run as
   today; Full auto → `dispatchFullAuto`), and `spec.auto` to
   `dispatchFullAuto`.
9. Start a run on the live transition: `_onSpecData` keeps the previous
   entries and calls `dispatchFullAuto` when `shouldStartFullAuto` holds for
   a bound slug.
10. Update `specNextAction`: `nextActionForPhase(phase, status)` returns
    "Resume Full Auto…" (`spec.auto`) from `fullAutoResumeAction`, and the
    bar shows the full-auto run-liveness lock with `fullAutoStageLabel`. Pass
    the spec's status from `specSection`, `specPanel` and `specsDashboard`
    (their click handlers already forward `action.command` unchanged).
