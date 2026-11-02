---
keywords: implement modes, guided mode, implement mode modal, implement-launch.js, launch flags, next-action button, run-liveness lock, implementation report
related: implement-modes, cli-spec-command-parity, spec-close-step
supersedes: implement-modes
---
Moved the implement-mode choice out of the session: the implement button's modal records `implement_mode` before staging so autonomous flags ride the first launch, a flag-free `guided` mode fills the middle, and the CLI hands autonomous off to `.frame/bin/implement-launch.js`.

- Why: v1's in-session picker could only answer "autonomous" in a bare session with "re-dispatch please", and Continue re-entered the same unflagged session. Rejected: `autonomous-permission-lifecycle`, a mid-session grant merged into `.claude/settings.local.json` with manifest, refcounts, idle-strip and sweep, built on its own branch and dropped before merge (user-owned, repo-scoped file leaking into every lane; Edit/Read prompts remained). Its spec was deleted in 4c530e4; the rationale lives in PROJECT_NOTES [2026-07-22].
- Ladder: step by step (v1 Mode A, unchanged); guided (v1 Mode B's loop in a normal-permission session, paced only by the CLI's own prompts, same `report-data.json` and report); autonomous (launch path only, never offered or upgraded to mid-session); describe your own (fourth modal slot; the agent offers once to save the flow as `.claude/skills/<name>/SKILL.md`, replacing v1's `implement-flow.md`/`flowFile`).
- Modal (`implementModeModal.js`, a dynamic `spec-modal-overlay`): mode plus a destination section only for a live lane; absorbs `_askContinueOrNew` for implement only. Autonomous may Continue only into a lane in the new `launchedAutonomousLanes` map (the spec's `launchedAutonomousBySlug` did not exist). Order: modal → `UPDATE_SPEC_STATUS` → stage → dispatch; cancel writes nothing; `getSpec` exposes `implementHint`.
- Flags refused on an explicit autonomous pick → the run continues guided, and the recorded mode stays `autonomous`.
- Button: one shared `specNextAction.js` replaced three drifting copies. Guided/autonomous lock on run-liveness (live lane ∧ pending tasks, "Running — X/Y tasks", "Waiting for permission"); step-by-step/custom stay turn-scoped. Deviation after T05 (8be3645): the idle label is always "Implement Tasks…" and the mode only preselects, because the per-mode label table left a stale "Run Custom Flow" on abandoned specs.
- Helper: `implement-launch.js` is self-contained (its own allow/deny and test → lint → build copies) and works with Frame closed, from templates staged to `.frame/runtime/commands/claude-code/` on project open; it execs `claude --settings … --permission-mode auto` with the prompt as launch argument. Agents print the helper command and never compose the line. No external-run adoption marker.
- T09 (follow-up): report `--open` on first generation only plus a progress banner computed from `tasks.json`. Manual reload chosen over meta-refresh, which resets scroll and collapses open diffs.
- Result: 9 tasks; `test/implementLaunch.test.js` 14 tests, `implementReport` 35, suite 133/133; renderer and template prose untested per posture.
- Rule: no Frame code path reads or writes `.claude/settings.local.json`; the only permission carriers are the launch line and the user's own in-session decisions.

Chain: spec.md → plan.md → tasks.md → outcome.md
