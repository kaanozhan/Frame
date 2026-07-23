# Implement modes v2 — the mode is chosen before the session, never inside it

## Problem

Three findings from running implement-modes (v1) in anger, converging on one
root cause: the mode picker lives **inside** the session, after launch, while
the autonomous mode's permissions can only travel **on** the launch line.

1. **The re-dispatch dead end.** Flags are read once at CLI start, so choosing
   autonomous in a session launched without them can only end in "re-dispatch
   please" — and the continue-or-new modal's "Continue" injects into the same
   unflagged session, where the picker asks again. The loop is structural, not
   a bug in the copy.
2. **The rejected fix.** The `autonomous-permission-lifecycle` spec tried a
   mid-session upgrade: merge Frame's rules into `.claude/settings.local.json`
   (hot-reloaded), track them in a manifest, refcount holders, strip on idle,
   sweep on open. Implemented on its own branch and rejected before merge:
   it uses a user-owned file (where "don't ask again" grants live) as Frame's
   ephemeral state; the file is repo-scoped, so a live grant leaks into every
   other session and worktree lane in the repo; and prompts still aren't
   silenced, because `Edit`/`Read` are deliberately left to a permission mode
   only the user can switch. The sheer care of the manifest/sweep machinery is
   itself the tell that the state lives in the wrong place.
3. **The button contradicts the modes.** The next-action button is labeled
   "Implement Next Task — one per click": step-by-step phrasing hardcoded for
   every mode. Worse, its busy lock is **turn**-scoped (`renderNextActionBar`:
   "unlocks when the agent finishes its turn"), so in a continuous mode the
   button would unlock in any idle gap mid-run and invite a double dispatch.

There is also a gap in the mode ladder itself: nothing exists between "pause
for approval every task" and "flags + full autonomy". A user who wants the
run to flow but wants to stay the permission gate has no mode.

## Goal

### 1. The mode ladder

- **Step by step** — unchanged from v1 Mode A: implement the task, report
  what changed and why, ask one question; commit on approval, then the next
  task. (The commit-after-approval close-out v1 already ships is exactly the
  intended behavior — this spec does not touch Mode A.)
- **Guided** *(new)* — v1 Mode B's per-task loop (implement → verify →
  report entry → outcome entry → atomic commit → amend the real hash) with
  the flag requirement removed: it runs in a normal-permission session, and
  the CLI's own permission prompts are what pace the run. Between tasks there
  is no check-in — the next task starts on its own. Produces the same
  `report-data.json` / `implement-report.html` as autonomous. New
  `implement_mode` value: `guided`.
- **Autonomous + report** — v1 Mode B, now **launch-path only**. It is never
  offered, attempted, or upgraded-to inside a running session. No mid-session
  path to it exists at all.
- **Describe your own** (v1 Mode C) stays available; see Open Questions for
  where it surfaces.

### 2. UI path: one unified modal, before anything runs

- The implement button opens a single modal: mode selection (remembered mode
  preselected) plus — only when the spec's assigned lane is alive — a
  destination section ("Continue in *<Frame>*" / "Open a new Frame"). This
  absorbs today's `_askContinueOrNew`; two stacked dialogs never appear.
- Mode × destination coupling: step-by-step and guided allow both
  destinations. Autonomous allows "Continue" **only** when the lane itself
  was launched with the autonomous flags (`launchedAutonomousBySlug` already
  tracks this); otherwise the option is disabled with the reason stated and
  the destination is forced to a new Frame. The old lane is unassigned, not
  closed — existing behavior.
- **Ordering flips.** Today: stage (flags guessed from the hint) → ask.
  New: modal → write `implement_mode` to `status.json` → stage (flags derive
  from the recorded choice) → dispatch. The launch hint's only remaining job
  is the modal's preselection; the "wrong guess costs a re-dispatch" caveat
  disappears because there is no longer a guess.
- Cancel writes nothing and dispatches nothing.

### 3. CLI path: record, then hand off

- A conversational `spec.implement` (cli-spec-command-parity flow) offers
  step-by-step and guided as directly runnable. If the resolved hint — or the
  user's answer — is autonomous, the agent (a) writes
  `implement_mode: autonomous` to `status.json` **first**, then (b) hands
  off in one message: use the spec's implement button in Frame, or run
  `node .frame/bin/implement-launch.js <slug>` in a fresh terminal. Either
  path finds the recorded mode and never re-asks. No re-dispatch request, no
  second picker, no settings writes.
- **`.frame/bin/implement-launch.js <slug>`** is the single source of the
  flagged launch line. It writes the implement permission file, interpolates
  and stages the implement prompt from the staged templates (so it works with
  the Frame app closed), and execs the CLI with
  `--settings <perms> --permission-mode auto` plus the initial prompt as the
  launch argument — the new session reaches its first task with zero typed
  input. Agents never hand-compose this command; they print the helper
  invocation only.

### 4. Button state machine

- Label follows the resolved mode: no mode yet → "Implement Tasks…";
  step-by-step → "Implement Next Task"; guided → "Start Guided Run";
  autonomous → "Start Autonomous Run".
- Lock scope follows the mode. Step-by-step keeps the turn-scoped lock —
  between tasks the agent idles for approval and the unlocked button's
  meaning ("next task") is genuinely correct. Guided and autonomous lock for
  **run**-liveness: mode is continuous ∧ lane alive ∧ tasks remain → locked,
  showing progress ("Running — 3/7 tasks") and, for guided, the existing
  `agent-approval` state ("Waiting for permission"). A dead agent or closed
  Frame drops the lane info and the lock self-releases, as today.

### 5. Nothing ever writes `.claude/settings.local.json`

This spec supersedes `autonomous-permission-lifecycle` wholesale. The grant /
manifest / idle-strip / sweep machinery from that branch is never merged; the
only permission carriers are the launch line (`--settings`,
`--permission-mode`) and the user's own in-session decisions.

## Constraints

- `status.json` stays additive: `implement_mode` gains the value `guided`,
  no schema change.
- v1's "template-first, no renderer work" constraint is **explicitly lifted**
  for this spec: the modal and button are renderer changes.
  `_askContinueOrNew` is absorbed, reusing the same overlay idiom.
- The shared core accounting from v1 (task selection, scope authority, task
  state, outcome entries, never push, never touch `main`) is untouched and
  binds guided exactly as it binds the other modes.
- The report machinery is reused as-is by guided: same `report-data.json`
  contract, same staged generator, no new assets.
- Flags apply only to dispatches that start a CLI (unchanged); the bin helper
  is the only producer of flagged launches outside Frame's dispatch path.
- cli-spec-command-parity's staged templates are the helper's raw material.
  That spec's "record-choice-then-request-re-dispatch is the ceiling"
  constraint is retired here, and its "autonomous handoff wording" open
  question resolves to: name the Frame button and print the helper command.
- Template override precedence and orchestration are untouched; the worker
  honoring `implement_mode` remains a later spec, not foreclosed.

## Success Criteria

- Clicking implement with no remembered mode opens the modal; with
  step-by-step remembered the button reads "Implement Next Task" and behaves
  as today.
- During a guided or autonomous run the button stays locked with live
  progress across agent turn boundaries, and unlocks on its own when the
  agent dies or the last task completes — never mid-run.
- In the modal, autonomous + a live unflagged lane disables "Continue" with
  the reason shown; the same lane launched flagged allows it.
- The recorded mode is written **before** staging, so a fresh autonomous
  dispatch from the modal carries its flags on the first launch — the
  re-dispatch flow is unreachable from the UI.
- In a conversational CLI session, asking for autonomous results in exactly:
  one `status.json` write, one handoff message naming the button and the
  helper command — and running that helper in a fresh terminal starts
  implementing with no further typed instruction.
- A guided run completes a multi-task spec in one session with one commit per
  task and a report identical in shape to an autonomous run's; its only
  pauses are the CLI's own permission prompts.
- No code path in Frame reads or writes `.claude/settings.local.json`.
- A step-by-step run started after any guided/autonomous run gets its normal
  permission prompts — nothing is parked in any settings file.

## Out of Scope

- The watcher-based CLI → UI modal bridge (request file, heartbeat, response
  file) — V2 polish; the design is recorded in PROJECT_NOTES.
- Notifications / project badges for requests from a non-active project, and
  the "pending autonomous launch" prompt on project open.
- Lane/assignment tracking for helper-launched external runs (Frame still
  reflects their file-level progress via the specs watcher; the "Working in
  <Frame>" affordance is simply absent).
- Any change to the IMPLEMENT_ALLOW/DENY rule sets, orchestration, or the
  conductor.

## Open Questions

- **flagsDropped on an explicit choice** — v1 silently fell back to
  step-by-step when the CLI refused the flags. Now that autonomous is an
  explicit modal choice, is the right reaction a visible failure state in the
  UI, or a stated fallback to guided (the closest mode that needs no flags)?
- **Mode C placement** — does "describe your own" earn a slot in the modal,
  or does it stay a CLI-conversation option only?
- **Final name for the middle mode** — `guided` vs `supervised`; the string
  is both UI copy and the persisted `implement_mode` value, so it must be
  settled before the first task.
- **External-run adoption** — should `implement-launch.js` leave a marker
  that lets Frame later adopt the external session as a lane, or is
  file-level progress enough?
