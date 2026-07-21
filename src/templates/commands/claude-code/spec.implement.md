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
  implement flow file (`implement.flowFile`). Its `# heading` is the name;
  the rest of the file is the description you summarise for the entry.
- **Last · Describe your own** — always last, lettered C when no flow is saved
  and D when one is.

Describe each entry by **what the user gets**, never by its name. For B in
particular, say that it produces an HTML report, openable as each task
completes, showing that task's real diff, a what-changed / why-changed summary
and its test result — and that it is reachable from the spec page in Frame:
a **View Implementation Report** button on the spec's Tasks tab, appearing
once the first task lands. Naming a mode is not describing it.

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
2. **Check the session can deliver the mode**, below. If it can't, stop there —
   don't ask anything further of a run that is about to end.
3. **Offer to save a project default** — once, and only when
   `.frame/config.json` has no `implement.defaultMode`. On yes, write
   `"implement": { "defaultMode": "<the choice>" }`. Once a default exists the
   offer never repeats; changing it later is an explicit ask or a config edit.

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

## Mode A · Step by step

The user turns the loop. You do one task, show your work, and hand control
back.

Per task:

1. Take the next task per the shared core and mark it `in_progress`.
2. Make the smallest concrete change that satisfies it.
3. Write the outcome entry and mark the task `completed`.
4. **Close out** — two short paragraphs, in the reply, not in a file:
   - **What changed** — the actual edit, in terms of the code. Name the files.
   - **Why it changed that way** — the reasoning a reader could not recover
     from the diff: what you chose against, what constraint forced your hand,
     where you departed from `plan.md`.
5. Ask **exactly one** question: **commit and continue, or stop?**

Nothing else in that question. Not which commit message, not whether to run
the tests, not what to do next — one decision, one keypress.

- **Commit and continue** → commit the task's work, then start the next
  pending task in this same session. The mode was chosen for the session; do
  not show the picker again.
- **Stop** → leave the change in the working tree, uncommitted, and stop.
  Stopping is what the user does when they want to look at the work or adjust
  it before it becomes a commit; committing it for them defeats the purpose.

Verification is not part of this mode. If a check is worth running, the user
asks — the point of turning the loop by hand is that they decide what each
step is worth.

## Mode B · Autonomous + report

You turn the loop. The user watches the report. Take the pending tasks in
order and keep going until none remain — no confirmation between tasks, no
"shall I continue". Asking almost nothing is the mode's entire reason to
exist; a confirmation between tasks turns it back into Mode A.

Before the first task, tell the user — once, as a statement, not a question —
where to watch: the report opens from the **View Implementation Report**
button on the spec's Tasks tab in Frame (the button appears when the first
task lands), and it is regenerated after every task, so refreshing the opened
page follows the run live. Then start; do not wait for a reply.

Per task, in this order:

1. Mark the task `in_progress`.
2. Implement it.
3. **Verify** — run the project's check from `.frame/config.json`
   `project.commands`, taking the first of `test`, `lint`, `build` that holds a
   command, and record the result. That order is also the one Frame allowed in
   this session's permissions. If none of them holds a command, see below.
4. Append the task's entry to `.frame/specs/{slug}/report-data.json` with
   `"commit": ""` — the hash does not exist yet. Create the file on the first
   task, using the shape documented at the top of the generator.
5. Append the outcome entry.
6. Mark the task `completed`.
7. **One atomic commit** — code, outcome entry, report data and state files
   together. A task is one commit; a reader should never have to assemble it
   from three.
8. Read the new commit's short hash, write it into that task's report entry,
   regenerate the report, then `git commit --amend --no-edit` so the entry and
   its hash ride in the same commit they describe. The amend is safe precisely
   because nothing is pushed.

### When there is no check

`project.commands` may hold nothing usable — an empty block, or only commands
that start something rather than check it. Then the mode runs **without
verification**: implement, commit, and carry on exactly as above, recording
each task's verification as `"status": "none"` so the report shows it as *not
verified* rather than silently green.

**Never invent a command.** Not one guessed from the project's shape, not one
lifted from a README, not `npm test` because the directory looks like it might
have it. A command that was never configured is a command nobody promised
would pass, and a run that reports a check it made up is worse than a run that
reports none.

Say it plainly in the closing summary — that the project supplies no check, and
that every task therefore shipped unverified. Once, as a fact, not as an
apology repeated per task.

### Producing the report

The generator is staged at `{report_generator_path}` (project-relative). Run
it as:

```
ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" {report_generator_path} \
  .frame/specs/{slug}/report-data.json
```

Quote `$FRAME_NODE` — Frame injects its own executable there, and the packaged
path contains spaces. It writes `implement-report.html` next to the data file,
openable as each task completes.

Never transcribe a diff into the report yourself. The generator reads each
commit from git by hash; that is the one place an invented line would silently
corrupt the artifact, and the reason the report is generated rather than
written.

**If the runtime is missing**, in order: `$FRAME_NODE` → `node` on `PATH` →
skip the report, say so once, and keep writing `report-data.json` so a later
run can produce it. Never stop the work over a missing report — the code, the
commit and the outcome entry never depended on it.

### When to stop

Narrow, on purpose. Stop only when:

- a task is too ambiguous to implement, or `plan.md` is materially out of date
  (the shared stop conditions);
- the check fails and your fix does not make it pass. Do not loosen the check,
  do not skip the task, do not commit it red;
- the work would go outside `plan.md`'s Files and Sequencing;
- a command is refused by the permission layer. A deny rule is a decision that
  was already made — surface it, do not route around it.

Everything else you decide yourself and report at the end. When you stop, say
which task, why, and what state the tree is in.

### Closing summary

When no tasks remain: the spec phase goes to `"done"`, and you state what
shipped, which tasks are unverified, and the report's path.

## Mode C · Describe your own

The user says how they want this run to go, and you run it that way.

**If they picked the saved flow**, its description is `.frame/implement-flow.md`
— read it and run it. Don't ask them to describe it again.

**If they picked "describe your own"**, ask for the description in one
question, then run it. If what comes back is too thin to act on — "be careful",
"go fast" — ask one follow-up naming exactly what is unclear (how often to
commit? verify or not? report or not?). One follow-up, not an interview.

### A description governs, the core does not bend

The description decides the loop, the commit policy, the verification and the
reporting. Those four are its whole territory. Everything in **The shared
core** holds regardless: which task is next, `plan.md` as scope authority, task
state, spec phase, one outcome entry per task, never push, never touch `main`.

If a description contradicts the core — "push when the spec is done", "skip the
outcome entries, they slow you down" — follow the core, say in one line which
part you did not honour and why, and carry on. Don't stop the run over it and
don't quietly do it anyway.

Anything the description leaves unsaid falls back to Mode A's behaviour: hand
control back rather than assume more autonomy than you were given.

### Offering to save it

After a described run reaches its end, offer **once** to save the flow so it
becomes a picker entry next time. On yes:

- Write `.frame/implement-flow.md`. First line is `# <short name>` — that
  heading is what the picker shows as entry C — then the description in the
  user's own words, tidied but not rewritten.
- Add `"implement": { "flowFile": "implement-flow.md" }` to `.frame/config.json`,
  merging into whatever is already there.
- If a flow file already exists, say what it is called and ask before replacing
  it. Overwriting someone's saved flow silently is not a save, it is a loss.

The offer is once per run and never repeats after a no. A described flow that
the user doesn't want to keep is a perfectly good outcome.

## Stop conditions

These bind every mode too — a mode may add its own, none may drop these.

- Task is ambiguous → ask one focused clarifying question, do nothing else.
- Plan is materially out of date (file paths gone, approach contradicts current code)
  → flag it, do nothing else, do not implement.
- No pending tasks remain → say the spec is fully implemented, and set the spec
  phase to `"done"`.
