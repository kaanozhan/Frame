You are running the implementation loop for an existing Frame spec. The mode
was chosen **before** this session — read the inputs, resolve which mode is in
force, and ship the spec's pending work in that mode, capturing what you
actually did so the next session has context.

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

## Which mode is in force — resolve it, don't ask for it

Frame v2 chooses the mode in the UI (or the launch helper) and records it
**before** this session starts. So the first thing you do is read
`implement_mode` from `.frame/specs/{slug}/status.json`:

- **It names a mode** (`step-by-step`, `guided`, `autonomous`, `custom`) →
  that is the mode. Run its loop directly. **Do not show a picker** — the user
  already picked, and re-asking here is exactly the mid-session picker v2
  removed. Jump to that mode's section below.
- **It is empty or absent** → you were started conversationally, not from the
  modal. See **Conversational entry** below.

There is one override, checked first: **if a Frame note in this prompt says the
CLI refused the autonomous permission flags**, then the autonomous mode cannot
run in this session however `implement_mode` reads. Run the **guided** loop
instead — the same task-by-task loop, report and commits, paced by the CLI's
own permission prompts — and say so once. Leave `implement_mode: autonomous`
untouched: it is the user's real choice, and the next flagged launch should
honor it.

### Conversational entry (no recorded mode)

You got here by a plain "implement the tasks", not the modal. First, **check
for a saved described-flow skill** (see *Describe your own* → *Saved flows are
skills*). If one exists, offer to run it as one option.

Then offer the modes that this session can actually run to completion:

- **Step by step** — you implement one task, report what changed and why, and
  wait for a go-ahead before committing and moving on.
- **Guided** — you run every task in order with no check-ins between them (the
  CLI's own permission prompts pace it), one commit per task, producing the
  HTML report — openable from the **View Implementation Report** button on the
  spec's Tasks tab in Frame or directly from the spec folder, refreshed as
  each task lands.
- **Describe your own** — you tell me how to run it and I run it that way.

Ask with your structured-question tool (`AskUserQuestion` in Claude Code); with
none, print a numbered list and **wait** — an unanswered picker is a hard stop.

**Autonomous is not runnable from here.** A conversational session was not
launched with the permission flags that mode needs, and this file never routes
around a permission decision. If the user wants autonomous, do exactly two
things and then stop:

1. Write `implement_mode: "autonomous"` into `.frame/specs/{slug}/status.json`
   (merge; leave every other key untouched).
2. Hand off in one message: *"Autonomous needs a flagged launch. Click the
   implement button on this spec's page in Frame and pick Autonomous, or run
   `node .frame/bin/implement-launch.js {slug}` in a fresh terminal — either
   one starts implementing with no further input."*

No re-dispatch negotiation, no second picker, no settings-file writes.

Once the user picks a runnable mode, record it in `status.json`
(`implement_mode`) so the next dispatch resolves without asking, then run it.

## Pre-flight — the tree and the branch, before anything else

Runs once, in **every mode — autonomous included** — after the mode is
resolved and before anything the run produces: no report, no task claim, no
edit until this clears. The autonomous flags remove permission prompts, not
this question; the unattended part of the run begins after pre-flight passes.

**The working tree.** Check `git status`. Clean → pass without a word. Dirty →
classify what's there before asking, so the question you ask is the right one:

- **Plan-phase artifacts** — changes confined to `.frame/specs/{slug}/`
  (spec.md, plan.md, tasks.md, status.json) and this spec's entries in the
  root `tasks.json`. That is the planning session's output that never got
  committed. Offer the natural move: *commit these as a plan commit before
  implementation starts* (a `docs`/`plan`-style commit naming the spec), with
  "leave them, start anyway" as the alternative.
- **Foreign changes** — anything else, including another spec's files. Name
  the files and ask what to do: commit them, stash them, or start on top of
  them. Do not guess; work you didn't produce is not yours to file away.

A mixed tree gets both classifications in the same question, not two
interruptions.

**The branch.** No file records a spec↔branch mapping; judge by convention:

- On `main`/`master` → always ask. Offer to create and switch to
  `feat/{slug}` — the shared core forbids touching main, so a run that starts
  there has nowhere to commit.
- On a branch whose name has nothing to do with `{slug}` — it reads like
  another spec's or another piece of work's branch → ask: *switch (or create
  `feat/{slug}`) and start there, or continue here on purpose?*
- On a branch that plausibly belongs to this spec → pass.

**Ask in the normal message flow, not with the structured-question tool.**
Pre-flight is a judgment call, not a picker: form a recommendation from your
classification and lead with it — what you found, what you'd do, one
question. *"Uncommitted changes in spec.md / plan.md / tasks.md look like
this spec's plan output — I'd commit them as a plan commit and start. OK?"*
A plain question lets the user answer with nuance a picker would flatten
("commit those, but stash the other two"). Tree and branch findings travel
in the same message when both apply: one interruption, not two. Then
**wait** — an unanswered pre-flight is a hard stop, same as the mode picker.

Whatever the user answers — commit, stash, switch, or "continue as is" —
carry it out, say in one line what state the run starts from, and start.
Pre-flight happens once per session and never resurfaces mid-run.

## The shared core — every mode obeys this

Binding on all modes, **including a flow the user describes**. A described flow
may change the loop, the commit policy, the verification and the reporting. It
may not drop the accounting below — that is what separates describing a flow
from replacing this file wholesale.

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

## Mode · Step by step

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

## Mode · Guided, and Mode · Autonomous + report

These two modes run the **same loop**. The only difference is the permission
posture:

- **Autonomous** was launched with the permission flags, so edits and commands
  never stop on a prompt — the run is genuinely unattended.
- **Guided** runs in a normal-permission session, so the CLI's own permission
  prompts pace it. You still take every task in order without check-ins; the
  pauses are the CLI asking to allow a command, not you asking whether to
  continue.

In both, you turn the loop and the user watches the report. Take the pending
tasks in order and keep going until none remain — no confirmation between
tasks, no "shall I continue". A confirmation between tasks turns either mode
back into step-by-step, which is not what the user picked.

Pre-flight has already cleared by the time this loop starts — the empty
report below is the run's first output, never something that lands on a dirty
tree or the wrong branch.

Before the first task, **create the empty report and open it** (see *Producing
the report* below): write `.frame/specs/{slug}/report-data.json` with the spec's
`slug` and `title` and an empty `tasks` array, then run the generator with
`--open`. This opens the report in its empty state — a page that names what will
appear as the run turns — so the user sees it waiting before any code lands, and
makes the **View Implementation Report** button appear in Frame from the start.

Then tell the user — once, as a statement, not a question — where to watch: the
report opens from the **View Implementation Report** button on the spec's Tasks
tab in Frame, or directly at `.frame/specs/{slug}/implement-report.html` when no
Frame window is open, and it is regenerated after every task, so refreshing the
opened page follows the run live. Then start; do not wait for a reply.

Per task, in this order:

1. Mark the task `in_progress`.
2. Implement it.
3. **Verify** — run the project's check from `.frame/config.json`
   `project.commands`, taking the first of `test`, `lint`, `build` that holds a
   command, and record the result. That order is also the one Frame allowed in
   this session's permissions. If none of them holds a command, see below.
4. Append the task's entry to `.frame/specs/{slug}/report-data.json` with
   `"commit": ""` — the hash does not exist yet. The file already exists (you
   created it empty before the first task); append to its `tasks` array, using
   the shape documented at the top of the generator.
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

Quote `$FRAME_NODE` — when Frame launched this session it injects its own
executable there, and the packaged path contains spaces. In a session Frame did
not launch, `$FRAME_NODE` is unset — use `node` from `PATH` instead (the
missing-runtime order below). It writes `implement-report.html` next to the
data file, openable as each task completes.

**Add `--open` only on the very first generation** — the empty-report
generation you run before the first task (above) — so the report opens in the
browser once, at the start of the run:

```
ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" {report_generator_path} --open \
  .frame/specs/{slug}/report-data.json
```

This matters most for a terminal-launched autonomous run, where there's no
Frame window to click the **View Implementation Report** button. Pass `--open`
**only on that first, empty generation** — every task afterwards regenerates the
same file, and the reader follows the run by reloading the tab they already have
open, so re-passing it would spawn a new tab per task. Opening is best-effort: on
a box with no browser opener it silently does nothing and the run is unaffected.
The report itself carries a live status banner (how many tasks are done, which
is next, and a reload hint) plus, before the first task, an empty state naming
what will appear — so the reader always knows whether the page in front of them
is waiting, mid-run, or final.

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
  was already made — surface it, do not route around it. (In guided this is a
  hard deny, not the routine allow-this-command prompt, which you simply
  answer and continue.)

Everything else you decide yourself and report at the end. When you stop, say
which task, why, and what state the tree is in.

### Closing summary

When no tasks remain: the spec phase goes to `"done"`, and you state what
shipped, which tasks are unverified, and the report's path.

## Mode · Describe your own

The user says how they want this run to go, and you run it that way.

**If a saved flow skill was chosen** (or you detected one on conversational
entry and the user said to use it), read that skill and run it. Don't ask them
to describe it again.

**Otherwise ask for the description in one question**, then run it. If what
comes back is too thin to act on — "be careful", "go fast" — ask one follow-up
naming exactly what is unclear (how often to commit? verify or not? report or
not?). One follow-up, not an interview.

### A description governs, the core does not bend

The description decides the loop, the commit policy, the verification and the
reporting. Those four are its whole territory. Everything in **The shared
core** holds regardless: which task is next, `plan.md` as scope authority, task
state, spec phase, one outcome entry per task, never push, never touch `main`.

If a description contradicts the core — "push when the spec is done", "skip the
outcome entries, they slow you down" — follow the core, say in one line which
part you did not honour and why, and carry on. Don't stop the run over it and
don't quietly do it anyway.

Anything the description leaves unsaid falls back to step-by-step behaviour:
hand control back rather than assume more autonomy than you were given.

### Saved flows are skills

v2 saves a described flow as a real Claude Code **project skill**, not the old
`.frame/implement-flow.md` file — a skill is committable and shows up wherever
the user works, and no Frame code path writes under `.claude/`, so you (the CLI
agent) are the only writer.

**Detecting one.** A saved implement flow lives at
`.claude/skills/<name>/SKILL.md` and its front-matter `description` marks it as
a Frame implement flow (it will say so — a previous run wrote it). On
conversational entry, scan `.claude/skills/*/SKILL.md` for one and, if found,
offer it as a runnable option.

**Offering to save.** After a described run reaches its end, offer **once** to
save the flow so it's a one-click option next time. On yes:

- Write `.claude/skills/<name>/SKILL.md`. Pick a short kebab-case `<name>`; the
  front-matter `name` and a `description` that begins "Frame implement flow —"
  so future detection finds it. The body is the description in the user's own
  words, tidied but not rewritten, followed by a one-line pointer that it drives
  `/spec.implement` for this project.
- If such a skill already exists, say what it is called and ask before
  replacing it. Overwriting someone's saved flow silently is not a save, it is
  a loss.

The offer is once per run and never repeats after a no. A described flow the
user doesn't want to keep is a perfectly good outcome.

## If this was the spec's LAST pending task — write the digest

When the task you just completed leaves no pending tasks for this spec, the
spec is effectively done. In this same turn, write
`.frame/specs/{slug}/digest.md` — the distilled, agent-facing memory of the
whole spec (the spec index and edit-time hints are built from it). Shape:

```
---
keywords: <3-8 comma-separated concepts, reuse spec.md's line if present>
related: <comma-separated slugs, or omit>
supersedes: <slug, or omit>
---
<≤15 lines: what was done · why this path won (name the rejected
alternatives) · the result · rules established for future work>

Chain: spec.md → plan.md → tasks.md → outcome.md
```

Write it from `outcome.md`'s actuals, not `plan.md`'s intent — deviations
are exactly what the digest must carry. Then suggest marking the spec
`"done"` in `status.json` as usual.

## Stop conditions

These bind every mode too — a mode may add its own, none may drop these.

- Task is ambiguous → ask one focused clarifying question, do nothing else.
- Plan is materially out of date (file paths gone, approach contradicts current code)
  → flag it, do nothing else, do not implement.
- No pending tasks remain → say the spec is fully implemented, and set the spec
  phase to `"done"`.
