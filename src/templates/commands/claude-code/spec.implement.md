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

## The shared core — every mode obeys this

Binding on all three modes, **including a flow the user describes**. A
described flow may change the loop, the commit policy, the verification and the
reporting. It may not drop the accounting below — that is what separates
describing a flow from replacing this file wholesale.

**Which task.** The lowest-numbered task in `tasks.json` whose `source` is
`spec:{slug}:T<n>` and whose `status` is `pending`. One task at a time, in
order; never bundle two into one unit of work.

**Scope authority.** `plan.md`'s **Files** and **Sequencing** sections decide
what a task is allowed to touch. Work the plan did not predict — a missed
constraint, a refactor that wants its own task, a dependency you have to add —
is not yours to do silently. Every mode surfaces it; the modes differ only in
whether they stop for an answer.

**Task state.** `status: "in_progress"` when you start it, `status:
"completed"` plus `completedAt` and `updatedAt` (ISO 8601) when it is done.
Edit `tasks.json` directly.

**Spec phase.** `.frame/specs/{slug}/status.json` goes to `"implementing"` when
work starts, and to `"done"` once no pending task remains. Merge into the
existing object — other keys, `implement_mode` among them, must survive.

**One outcome entry per completed task**, in the format below. Not one per
session, not one per commit: per task.

**Never push. Never touch `main`.** Commits are local, on the branch you are
already on. A branch is cheap to throw away; a push is not.

### The outcome entry

Append to `.frame/specs/{slug}/outcome.md`, creating the file if it doesn't
exist. Each entry uses this exact shape:

```
## T<n> — <task title>

<2–3 sentence summary. What you actually did. Any deviation from plan.md.
Files touched. No filler. No "I successfully implemented...". Just the facts.>

_Captured: <ISO date> · <N> file change(s)_

---
```

The trailing `---` keeps multiple entries readable.

Style:

- Imperative voice, past tense actions ("Wired the…", "Replaced X with Y because…").
- If the implementation diverged from `plan.md`, **name the divergence**. That's the
  whole point of capturing this.
- If you noticed followup work that should become its own task or spec, add a
  one-liner: `Followup: <one sentence>`.
- Hard cap: 4 sentences. Be ruthless. The reader 6 months from now should learn
  the story without reading the diff.

## Stop conditions

These bind every mode too — a mode may add its own, none may drop these.

- Task is ambiguous → ask one focused clarifying question, do nothing else.
- Plan is materially out of date (file paths gone, approach contradicts current code)
  → flag it, do nothing else, do not implement.
- No pending tasks remain → say the spec is fully implemented, and set the spec
  phase to `"done"`.
