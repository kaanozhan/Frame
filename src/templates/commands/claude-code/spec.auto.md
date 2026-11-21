You are running a Frame spec in **full auto**: everything left of this spec —
plan, tasks, implementation and outcome — runs to the end in this one session,
without asking the user anything. The user chose this when the spec was
written, or on the spec's Generate Plan / Resume Full Auto button, and
`flow_mode: "full-auto"` in `.frame/specs/{slug}/status.json` records it. This
session was launched with the autonomous permission flags for exactly this
reason: nothing should interrupt it.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Spec title: {title}
- Spec folder: `.frame/specs/{slug}/`
- Task file: `{tasks_path}`

## The phases, in order

Frame staged one prompt per phase. Read `.frame/specs/{slug}/status.json`,
find its `phase`, and start at the first phase that is not done yet:

| `phase` in status.json            | Start with                               |
| --------------------------------- | ---------------------------------------- |
| `specified`                       | 1 · Plan — `{plan_prompt_path}`          |
| `planned`                         | 2 · Tasks — `{tasks_prompt_path}`        |
| `tasks_generated`, `implementing` | 3 · Implement — `{implement_prompt_path}` |
| `done`                            | nothing — say the spec is already done, and stop |

For each phase: read its prompt file and follow it exactly, except where the
full-auto rules below say otherwise. When a phase has finished — its prompt
has advanced `phase` in status.json — go straight on to the next phase in the
same turn. Do not end your turn between phases, and do not stop to summarize:
one line naming the phase you are starting is enough.

## Full-auto rules — these override the phase prompts' questions

- **Plan.** The decision gate asks nothing. Every fork — business, technical
  and the test posture — takes the option you would have recommended first,
  and each is recorded under "Resolved plan-time decisions" (and as its card
  in the plan report) with its rationale and the marker
  `(auto-decided — full auto)`. Drift that changes the shape of the work is a
  fork like any other: decide it, record it, go on. The plan prompt carries
  the same rule.
- **Tasks.** No check-in; write `tasks.md` and continue.
- **Implement.** Frame recorded `implement_mode: "autonomous"` before this
  session started: run the autonomous loop. Pre-flight still runs once. A
  dirty tree made only of this spec's own plan-phase output — the files this
  run just wrote under `.frame/specs/{slug}/` and this spec's entries in
  `{tasks_path}` — is committed as a plan commit without asking. The implement
  prompt carries the same rule.

## When to stop and ask

Only when the work cannot go on without the user:

- the project's check fails and your fix does not make it pass;
- pre-flight finds changes that are not this spec's own, or the run is on
  `main` / `master`;
- a task is too ambiguous to implement, or the work would go outside
  `plan.md`'s Files and Sequencing (the implement prompt's stop conditions);
- a command is refused by the permission layer.

When you stop, say which phase and which task, why, and what state the tree is
in — then wait. Frame shows the spec as "Full auto · needs you" while you wait.
Everything else you decide yourself and report at the end.

## Closing

When the implement phase's closing summary is written and the spec is `done`,
add one last line: how many plan decisions were auto-decided and where to read
them (`plan.md` and the plan report), and the implementation report's path.

Never push. Never touch `main`.
