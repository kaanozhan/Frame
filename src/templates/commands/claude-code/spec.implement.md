You are running the implementation loop for an existing Frame spec. Read the
inputs, ask which mode to run in, then ship the spec's pending work in that
mode — capturing what you actually did so the next session has context.

How much you do in one turn is the mode's call, not this file's: one task and
back to the user, or the whole spec unattended.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Inputs (read these first, in order):
  - `.frame/specs/{slug}/spec.md` — what we're building (intent, constraints)
  - `.frame/specs/{slug}/plan.md` — the architecture and approach
  - `.frame/specs/{slug}/tasks.md` — the canonical task list
  - `.frame/specs/{slug}/outcome.md` — what previous tasks actually shipped (read this if it exists; it tells you why the codebase may differ from the plan)
  - `tasks.json` — find the next task where `source` starts with `spec:{slug}:` AND `status === "pending"` (lowest T-number first)

## Mode — asked at every dispatch, before any work

Read the inputs above. Then show the picker and **wait**. Do not edit a file,
mark a task, or write a line of code before the answer lands: a task executed
before the mode is chosen obeys no mode — uncommitted, absent from any report —
and repairing that afterwards costs far more than asking cost.

Before you write anything, note the **existing** `implement_mode` in
`status.json` and `implement.defaultMode` in `.frame/config.json`. That pair is
the launch hint Frame already used, and you need its pre-answer value below.

### Composing the picker

In this order:

- **A · Step by step** — always present.
- **B · Autonomous + report** — always present.
- **C · <the saved flow's name>** — only when `.frame/config.json` names an
  implement flow file; read it for the description.
- **Last · Describe your own** — always last, lettered C when no flow is saved
  and D when one is.

Describe each entry by **what the user gets**, never by its name. For B in
particular, say that it produces an HTML report, openable as each task
completes, showing that task's real diff, a what-changed / why-changed summary
and its test result. Naming a mode is not describing it.

When `.frame/config.json` has an `implement.defaultMode`, move that entry to
the **top** and mark it `(default)`, so confirming it is a single keypress. A
saved default does not silence the question — asking every time is what makes
switching modes mid-spec free: run the first tasks step by step, hand the rest
to the autonomous mode once it has earned the trust.

### How to ask

Use your structured-question tool when you have one — in Claude Code that is
`AskUserQuestion`. When you have none, print the entries as a numbered list and
**stop there**. Wait for the answer to arrive as a new message.

An unanswered picker is a hard stop, not a soft one. Do not choose on the
user's behalf, do not fall through to a default, do not start "while waiting".

### After the answer

1. **Record the choice** in `.frame/specs/{slug}/status.json` as
   `"implement_mode"`, one of `"step-by-step"`, `"autonomous"`, `"custom"`.
   Merge into the existing object; leave every other key untouched. This is the
   *last choice*, not a resolved setting — the next dispatch uses it as its
   launch hint and still asks.
2. **Offer to save a project default** — once, and only when
   `.frame/config.json` has no `implement.defaultMode`. On yes, write
   `"implement": { "defaultMode": "<the choice>" }`. Once a default exists the
   offer never repeats; changing it later is an explicit ask or a config edit.
3. **Check the session can deliver the mode**, below.

### When the session cannot deliver the chosen mode

The autonomous mode needs permission flags that can only be set as the CLI
launches — and Frame launches before it can ask you anything, so it guesses
from the launch hint you noted above.

So: the session has those flags exactly when that **pre-answer** hint was
`autonomous`. If the user picks the autonomous mode and it wasn't, the session
cannot keep that mode's promise — every edit would stop on a permission prompt,
the precise thing the mode exists to avoid.

In that case: record the choice anyway (step 1 — that is what makes the *next*
launch correct), tell the user in one line that this mode needs one
re-dispatch, and stop. One re-dispatch, not a negotiation.

Picking a **less** autonomous mode than the flags allow is harmless — proceed.
Step by step's control point is your own question between tasks, not the
permission layer.

If a Frame note in this prompt says the CLI refused the flags, that settles it:
the autonomous mode is unavailable in this session however it was launched.
Say so once and continue with the mode the user picked instead.

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
