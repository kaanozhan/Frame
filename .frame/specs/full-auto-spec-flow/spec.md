---
keywords: full auto, autonomous, spec flow, plan, tasks, implement, flow mode, chaining
related: implement-modes-v2, implement-modes, deep-spec-plan, deep-spec-tasks, new-spec-agent-handoff, cli-spec-command-parity
---

# Full-auto spec flow

## Problem
After a spec is written, every next step waits for a human: Generate Plan,
Break into Tasks, then Implement Tasks… are separate button clicks, and each
starts a fresh question round. Implement already lets the user choose how
far the agent runs on its own (step-by-step / guided / autonomous), but the
plan and tasks phases before it have no such choice. A user who trusts the
spec has to babysit three hand-offs to get from `specified` to `done`.

## Goal
Right after `spec.new` writes the spec, the agent asks one Frame-defined
question: **how should the rest of this spec run?**

- **Step by step** — today's behavior: stop after the spec; the user drives
  plan, tasks and implement from the next-action button.
- **Full auto** — the rest runs start to finish with no user input:
  `spec.plan` → `spec.tasks` → `spec.implement`, ending with the outcome and
  the implementation report, the spec at `done`.

The choice is recorded in `status.json` (new key `flow_mode`), so any later
dispatch of that spec (button, CLI, Frame restart) resumes in the same mode
instead of asking again. In full auto:

- The plan decision gate does not ask: every fork is decided by the agent's
  recommended option and recorded as a plan-time decision with its
  rationale, marked as decided without the user.
- `spec.tasks` runs without a check-in.
- The whole rest of the run — plan, tasks, implement, outcome — happens in
  **one new session launched with the autonomous permission flags**, so no
  permission prompt or check-in interrupts it. Implement runs in the
  autonomous mode.
- **Entry points:**
  - *End of `spec.new`:* picking full auto records `flow_mode`, and the
    agent hands the rest to that flagged session (from Frame, Frame opens it
    in a new lane; from a bare CLI, the agent prints a launch-helper command
    in the style of `implement-launch.js`). The
    spec-writing session stops there.
  - *Generate Plan button:* gains the same choice (step by step / full
    auto), also for specs written before this feature. Full auto from the
    button starts the flagged session directly, with no hand-off.
- The spec board and next-action bar show the run as live ("Full auto ·
  planning / tasks / implementing 3/7") and lock the button the way
  continuous implement modes already do.

## Constraints
- implement-modes-v2: permission flags travel only on the launch line, and
  autonomous is never reached mid-session. Full auto must not upgrade a
  running session's permissions; it either stays within what the session
  was launched with or goes through `implement-launch.js` / the modal's
  flagged launch.
- implement-modes-v2: nothing reads or writes `.claude/settings.local.json`.
- The implement pre-flight (working tree + branch) still runs once; full auto
  removes check-ins, not that question. A dirty tree made only of this
  spec's own plan artifacts is committed as a plan commit without asking.
- deep-spec-plan: the evidence pass, convergence loop, `plan.md` format and
  plan report stay as they are; only the gate's *asking* is replaced.
- The staged templates remain the only flow (cli-spec-command-parity); full
  auto works the same from the button and from a CLI conversation.
- `status.json` stays additive: `flow_mode` is a new optional key; a spec
  without it behaves exactly as today.
- Codex gets the same flow; the question uses each tool's ask mechanism.

## Success Criteria
- When `spec.new` finishes writing a spec, then the agent asks step by step
  vs full auto once, and the answer is in `status.json` as `flow_mode`.
- When the user picks step by step, then the session stops after the spec,
  exactly as today.
- When the user picks full auto after `spec.new`, then one new flagged
  session starts and, without further user input, the spec
  reaches `planned`, `tasks_generated` and `done`, with `plan.md`, the plan
  report, `tasks.md`, one commit per task, `outcome.md` and the
  implementation report all written.
- When the plan gate meets a fork in full auto, then no question is shown and
  `plan.md`'s resolved decisions list it as auto-decided with a rationale.
- When a full-auto run stops (agent dies, Frame closes) and the user clicks
  the spec's button later, then it resumes in full auto from the current
  phase without asking for the mode again.
- When full auto hits something it cannot decide alone (failing verification
  it cannot fix, a foreign dirty tree, a branch on `main`), then it stops and
  asks, and the spec board shows that it is waiting.
- When the user picks full auto on the Generate Plan button, then the same
  run starts directly in a flagged session, with no permission prompts.
- When a spec has no `flow_mode`, then every surface behaves as today.

## Out of Scope
- Orchestrated full auto across parallel specs (conductor / workers)
- Choosing full auto in the New Spec modal before the spec is written
- Splitting the full-auto run across several sessions
- Notifications when a full-auto run finishes or needs the user
- Changes to the IMPLEMENT_ALLOW / DENY permission rule sets
