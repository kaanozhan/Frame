# Plan — Implement modes v2 — the mode is chosen before the session, never inside it

## Architecture

### Resolved plan-time decisions

**Business**

- **Middle mode name → `guided`** *(asked)*. The string is both UI copy and the
  persisted `implement_mode` value; `guided` matches the spec's own vocabulary
  ("Start Guided Run") and reads as "the CLI's prompts guide the pace".
- **Mode C placement → fourth modal slot, CLI-conversational body, skill save**
  *(asked; user-directed)*. "Describe your own" appears in the modal as a fourth
  mode. Choosing it dispatches a normal-permission session where the agent asks
  for the flow description conversationally. When the described run finishes,
  the agent offers **once** to save the flow as a real Claude Code project
  skill (`.claude/skills/<name>/SKILL.md`, committable). On later runs the
  agent detects an existing implement-flow skill and offers to run it; a
  conversational "implement the tasks" may route through it too. This
  supersedes v1's `.frame/implement-flow.md` + `implement.flowFile` mechanism
  for claude-code — the template's saved-flow detection reads skills instead.
  The skill is written by the CLI agent at run time in the user's project;
  no Frame code path writes under `.claude/`.
- **Flags refused on an explicit autonomous choice → stated fallback to guided**
  *(asked)*. When the bare-retry fires after the CLI rejects
  `--settings/--permission-mode`, the dispatch continues as a guided run: the
  in-app notice and the prompt note both say so, and the prompt is told to run
  the guided loop. The recorded `implement_mode` stays `autonomous` — it is the
  user's actual choice and the next flagged launch should honor it.
- **External-run adoption marker → none** *(silent)*. Out of Scope already
  excludes lane/assignment tracking for helper-launched runs; a marker no code
  consumes is dead weight. File-level progress via the specs watcher is enough.
- **The modal always opens on an implement click** *(silent)*. Goal 2's text is
  explicit ("The implement button opens a single modal … remembered mode
  preselected"); skipping it on a remembered mode would remove the only
  mode-switch and destination affordance. "Behaves as today" for step-by-step
  means the post-confirm dispatch semantics, which are unchanged.

**Technical**

- **Helper raw material → v2 stages it itself** *(asked)*.
  `cli-spec-command-parity` is still phase `specified`, so its
  `.frame/runtime/commands/<tool>/` staging does not exist. v2 ships a minimal
  slice: on project open (the `WATCH_SPECS` hook) and on every implement
  dispatch, Frame copies the raw `spec.implement.md` template and
  `build-implement-report.mjs` into `.frame/runtime/commands/claude-code/`,
  and the helper into `.frame/bin/`. Parity later generalizes the same
  location to all four commands — no conflict, no dependency.
- **Test posture → pure logic only** *(asked)*. Matches the standing
  convention (Node built-in runner, `test/*.test.js`, target the pure module,
  skip Electron-coupled wrappers, no renderer harness). One new test file
  covers the helper's pure parts; renderer and template prose ship untested,
  as the record says they must today.
- **`launchedAutonomous` tracking is built new** *(silent; spec drift)*. The
  spec says `launchedAutonomousBySlug` "already tracks this" — no such symbol
  exists anywhere in `src/`. agentDispatch gains a module-level
  `Map<terminalId, boolean>`, set when a dispatch that started the CLI
  succeeded with launch flags and did **not** drop them, cleared on
  `TERMINAL_DESTROYED`, exposed as `launchedAutonomous` on `getSpecLaneInfo`.
- **Modal is a new renderer module** *(silent)*. `implementModeModal.js`
  follows the existing `taskRunModal`/`taskConfirmModal` module pattern and
  reuses the `spec-modal-overlay` idiom, per the spec's constraint.
- **No new IPC channels** *(silent)*. The mode write reuses
  `UPDATE_SPEC_STATUS` (merge-partial, validated — `implement_mode` passes
  untouched). The modal's preselection and the button label read a new
  `implementHint` field added to `getSpec`'s return (resolved
  `status.implement_mode` → `config.implement.defaultMode` → null), so the
  renderer never re-implements the hint resolution.
- **The three next-action bars collapse into one shared state machine**
  *(silent)*. `specSection`, `specPanel` and `specsDashboard` each carry a
  near-copy of `nextActionForPhase` + `renderNextActionBar`; the new
  label × lock × progress logic in three drifting copies would be a bug farm.
  A shared `specNextAction.js` renders the bar; the surfaces keep their own
  click wiring.
- **The helper is self-contained** *(silent)*. `.frame/bin` scripts run with
  the app closed, so `implement-launch.js` carries its own copies of the
  allow/deny rule sets and the verification-command resolution (comment
  cross-links `specManager.js`; the sets are unchanged by this spec, per
  constraint). It merges `implement_mode: "autonomous"` into `status.json`
  before staging, so either entry path finds the recorded mode.
- **`_askContinueOrNew` survives for non-implement commands** *(silent)*.
  Absorption applies only where a mode exists; `spec.new/plan/tasks`
  dispatches keep today's continue-or-new dialog unchanged.

### Data shapes

- `status.json` — `implement_mode` gains the value `"guided"` alongside
  `"step-by-step" | "autonomous" | "custom"`. Additive; `validateSpecStatus`
  does not inspect the field, so no schema change.
- `.frame/runtime/commands/claude-code/` — **new staged dir**: raw
  `spec.implement.md` + `build-implement-report.mjs`, refreshed (content-diff
  write) on project open and implement dispatch. Override precedence is kept:
  the staged copy is resolved through the existing
  `.frame/templates/commands/<tool>/` → built-in fallback order.
- `.frame/bin/implement-launch.js` — staged copy of the helper (same
  ship-latest pattern as `structureBootstrap.copyParserScripts`).
- agentDispatch: `launchedAutonomousLanes: Map<terminalId, boolean>`;
  `getSpecLaneInfo(slug)` gains `launchedAutonomous: boolean`.
- Modal result: `{ mode: 'step-by-step'|'guided'|'autonomous'|'custom',
  destination: 'continue'|'new' } | null` (null = cancel, nothing written,
  nothing dispatched).

### Flows

**UI implement dispatch (ordering flip).** Button click →
`implementModeModal.open({slug, hint, lane})` → user confirms → renderer
invokes `UPDATE_SPEC_STATUS` with `{implement_mode}` → `BUILD_SPEC_COMMAND_FILE`
stages the prompt and derives `launchFlags` from the now-recorded mode
(`getImplementLaunchFlags` already reads `status.implement_mode` first — the
flip needs **no change** to flag derivation; only `guided` yielding no flags
falls out of the existing `!== 'autonomous'` guard) → `dispatch()` targets the
chosen destination. Mode × destination coupling in the modal: step-by-step and
guided offer both destinations when the lane is alive; autonomous enables
"Continue in *<Frame>*" only when `lane.launchedAutonomous` is true, otherwise
the option is rendered disabled with the reason and destination is forced to
"new". Cancel resolves null before any write or staging.

**CLI conversational path.** The rewritten template resolves the mode from
`status.json` first: a recorded mode runs without any picker. With no recorded
mode (conversational entry), the agent offers step-by-step, guided and
describe-your-own as runnable; an autonomous answer produces exactly (a) one
`implement_mode: "autonomous"` merge into `status.json`, then (b) one handoff
message naming the spec's implement button in Frame and
`node .frame/bin/implement-launch.js <slug>` — then stops. No re-dispatch
request path remains in the template.

**Helper (`implement-launch.js <slug>`).** Resolve project root (cwd) and spec →
merge `implement_mode: "autonomous"` → write
`.frame/implement-permissions.json` (own copy of allow/deny + verification
resolution from `.frame/config.json`) → load the raw template
(`.frame/templates/commands/claude-code/spec.implement.md` override, else
`.frame/runtime/commands/claude-code/spec.implement.md`; missing → exit with
"open the project in Frame once") → interpolate `{project_path}/{slug}/{report_generator_path}` →
write `.frame/runtime/prompts/<slug>__spec.implement.md` → ensure
`build-implement-report.mjs` sits in `.frame/runtime/assets/` → exec
`claude --settings <abs> --permission-mode auto "Read <relPath> and follow its
instructions exactly."` (clear error if `claude` is not on PATH). Agents never
hand-compose this line; the template prints only the helper invocation.

**Button state machine** (shared `specNextAction.js`; inputs: resolved hint,
`getSpecLaneInfo`, the spec's tasks from `TASKS_DATA`):

| Resolved mode | Idle label | Lock rule |
| --- | --- | --- |
| none | "Implement Tasks…" | turn-scoped (today's `lane.busy`) |
| step-by-step | "Implement Next Task" | turn-scoped (unchanged) |
| guided | "Start Guided Run" | run-liveness |
| autonomous | "Start Autonomous Run" | run-liveness |
| custom | "Run Custom Flow" | turn-scoped (a described flow defaults to Mode A pacing) |

Run-liveness lock: `mode ∈ {guided, autonomous} ∧ lane.agentName ∧
pendingCount > 0` → locked across turn boundaries, showing
"Running — {completed}/{total} tasks" and, on `agent-approval`,
"Waiting for permission". The inputs are all derived per render (no stored
busy flag), so a dead agent or closed Frame drops `lane` and the lock
self-releases — same anti-stuck contract as today.

**Permission carriers.** Only the launch line (`--settings`,
`--permission-mode`) — produced by Frame's dispatch or the helper — and the
user's own in-session decisions. No code this plan adds reads or writes
`.claude/settings.local.json` (grep-verified: zero references exist today),
and the `autonomous-permission-lifecycle` branch machinery is never merged.

## Files

- **Modified** `src/main/specManager.js` — stage `.frame/runtime/commands/claude-code/` (template + generator) and `.frame/bin/implement-launch.js` on `WATCH_SPECS` and implement dispatch; `getSpec` gains `implementHint`.
- **New** `src/templates/bin/implement-launch.js` — helper source (staged into user projects; self-contained: perms write, template interpolate, prompt stage, exec).
- **Modified** `src/templates/commands/claude-code/spec.implement.md` — mode resolved from `status.json` (no in-session picker when recorded); guided mode section; autonomous → record-then-handoff; describe-your-own skill lifecycle (offer-save / detect / run). **[T09]** "Producing the report" passes `--open` on the first generation only.
- **Modified** `src/templates/commands/claude-code/build-implement-report.mjs` **[T09]** — `--open` flag opens the written HTML cross-platform (best-effort in `main()`, never fails the build); a pure `{ total, completed, current }` progress object computed in `main()` from `tasks.json` (`source spec:{slug}:*`) drives a top-of-report banner (in-progress with reload note vs complete), rendered by the still-pure `renderReport`.
- **Modified** `test/implementReport.test.js` **[T09]** — cover the pure banner rendering across in-progress and complete states.
- **New** `src/renderer/implementModeModal.js` — unified mode + destination modal, coupling and disabled-reason logic, cancel-inert contract.
- **New** `src/renderer/specNextAction.js` — shared next-action bar: label per resolved mode, turn- vs run-liveness lock, progress copy.
- **Modified** `src/renderer/agentDispatch.js` — implement path ordering (modal → record → stage → dispatch); `launchedAutonomousLanes` tracking + `getSpecLaneInfo.launchedAutonomous`; guided-fallback notice/note copy.
- **Modified** `src/renderer/specSection.js` — use `specNextAction`; pass status/hint/tasks; drop local bar copy.
- **Modified** `src/renderer/specPanel.js` — same.
- **Modified** `src/renderer/specsDashboard.js` — same.
- **Modified** `src/renderer/styles/components/panels.css` — modal mode/destination styles; locked-bar progress state.
- **New** `test/implementLaunch.test.js` — helper pure parts: template interpolation, permission-file shape, launch-line composition, template resolution order.

## Footprint

- src/main/specManager.js
- src/templates/bin/implement-launch.js
- src/templates/commands/claude-code/spec.implement.md
- src/templates/commands/claude-code/build-implement-report.mjs
- test/implementReport.test.js
- src/renderer/implementModeModal.js
- src/renderer/specNextAction.js
- src/renderer/agentDispatch.js
- src/renderer/specSection.js
- src/renderer/specPanel.js
- src/renderer/specsDashboard.js
- src/renderer/styles/components/panels.css
- test/implementLaunch.test.js

## Dependencies

None.

## Sequencing

1. **Flagged-launch tracking** — add `launchedAutonomousLanes` to
   `agentDispatch.js` (set on successful flagged start without drop, cleared on
   `TERMINAL_DESTROYED`), expose `launchedAutonomous` on `getSpecLaneInfo`.
2. **Hint exposure** — `getSpec` returns `implementHint` via
   `resolveImplementLaunchHint` in `specManager.js`.
3. **Unified modal** — `implementModeModal.js` + `panels.css`: four mode
   entries (remembered/hinted mode preselected), destination section only when
   the lane is alive, autonomous-Continue coupling with disabled reason,
   Escape/backdrop cancel resolving null.
4. **Dispatch flip** — in `agentDispatch.js`, route `spec.implement` through
   the modal; on confirm write `implement_mode` via `UPDATE_SPEC_STATUS`, then
   stage, then dispatch to the chosen destination; cancel does nothing; update
   the flags-dropped notice and prompt note to the guided fallback wording.
   `_askContinueOrNew` remains for other commands.
5. **Button state machine** — `specNextAction.js` with the label table and
   turn- vs run-liveness lock + progress copy; wire `specSection.js`,
   `specPanel.js`, `specsDashboard.js` to it and delete their local
   `nextActionForPhase`/`renderNextActionBar` copies.
6. **Template rewrite** — `spec.implement.md`: recorded mode runs without a
   picker; conversational fallback offers step-by-step/guided/describe-your-own;
   autonomous → one status write + one handoff (button name + helper command);
   guided section (Mode B loop, no flags, CLI prompts pace, same
   `report-data.json`/generator contract); flags-refused note → run guided;
   described-flow skill lifecycle (save offer to `.claude/skills/<name>/SKILL.md`,
   detect-and-offer on re-entry), superseding the `flowFile` picker entry.
7. **Staging slice** — `specManager.js`: content-diff copy of the raw implement
   template + `build-implement-report.mjs` to
   `.frame/runtime/commands/claude-code/` and the helper to `.frame/bin/`, on
   `WATCH_SPECS` (project open) and implement staging.
8. **The helper** — `src/templates/bin/implement-launch.js` (arg parsing,
   status merge, permissions write, template resolution + interpolation, prompt
   staging, asset ensure, exec with flags; require-able pure functions with a
   main guard) **plus** `test/implementLaunch.test.js` covering those pure
   parts — the step is done only with its tests.
9. **Live-followable report** — `build-implement-report.mjs`: `--open` flag
   opens the written HTML cross-platform from `main()` (best-effort, never
   fails the build); `main()` reads `tasks.json` (repoRoot already resolved),
   filters `source spec:{slug}:*`, and passes a pure `{ total, completed,
   current }` object into `renderReport`, which renders a top banner —
   in-progress ("N/M done · next: T0x <title>" + reload note) vs complete
   ("M/M", no note), no banner when tasks.json is absent/empty. `spec.implement.md`
   "Producing the report" passes `--open` on the first generation only. Extend
   `test/implementReport.test.js` for the banner states. `renderReport` stays
   pure — all fs/clock work lives in `main()`.
