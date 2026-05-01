You are running the implementation loop for an existing Frame spec. Take the
NEXT pending task on this spec and ship it end-to-end in this single turn —
then capture what you actually did so the next session has context.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Inputs (read these first, in order):
  - `.frame/specs/{slug}/spec.md` — what we're building (intent, constraints)
  - `.frame/specs/{slug}/plan.md` — the architecture and approach
  - `.frame/specs/{slug}/tasks.md` — the canonical task list
  - `.frame/specs/{slug}/outcome.md` — what previous tasks actually shipped (read this if it exists; it tells you why the codebase may differ from the plan)
  - `tasks.json` — find the next task where `source` starts with `spec:{slug}:` AND `status === "pending"` (lowest T-number first)

## What "implement" means

Pick exactly ONE pending task. Don't bundle. You'll be invoked again per task.
Within this single turn:

1. Decide on the smallest concrete change that satisfies the task
2. Edit the relevant files (use the Edit / Write tools as needed)
3. If the change requires anything the plan didn't predict — a missed constraint,
   a refactor that should be its own task, a dependency you have to add — STOP and
   surface it to the user before continuing. Don't silently expand scope.

## When the change is in place

**Mark the task completed** by editing `tasks.json` directly:
- Find the task object whose `source === "spec:{slug}:T<n>"`
- Set `status: "completed"`
- Set `completedAt` and `updatedAt` to the current ISO timestamp

**Capture what shipped** by appending to `.frame/specs/{slug}/outcome.md`. Create
the file if it doesn't exist; otherwise append to the end. Each entry uses this
exact shape:

```
## T<n> — <task title>

<2–3 sentence summary. What you actually did. Any deviation from plan.md.
Files touched. No filler. No "I successfully implemented...". Just the facts.>

_Captured: <ISO date> · <N> file change(s)_

---
```

The trailing `---` keeps multiple entries readable.

## Style for the outcome entry

- Imperative voice, past tense actions ("Wired the…", "Replaced X with Y because…").
- If the implementation diverged from `plan.md`, **name the divergence**. That's the
  whole point of capturing this.
- If you noticed followup work that should become its own task or spec, add a
  one-liner: `Followup: <one sentence>`.
- Hard cap: 4 sentences. Be ruthless. The reader 6 months from now should learn
  the story without reading the diff.

## Stop conditions

- Task is ambiguous → ask one focused clarifying question, do nothing else.
- Plan is materially out of date (file paths gone, approach contradicts current code)
  → flag it, do nothing else, do not implement.
- No pending tasks remain → tell the user the spec is fully implemented and suggest
  marking phase `"done"` in `status.json`.
