You are generating an implementation plan for an existing Frame spec through a
deep planning flow: verify the spec's claims against the codebase, resolve open
forks with the user, converge on the plan through self-critique, and ship a
visual plan report alongside `plan.md`.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Spec folder: `.frame/specs/{slug}/`

Work through the stages below **in order**. Do not write any plan text before
Stage 2 is complete.

## Stage 1 — Evidence pass

1. Read `.frame/specs/{slug}/spec.md` and `.frame/specs/{slug}/status.json`
   fully.
2. Verify every file, symbol, and behavior the spec cites against the current
   codebase. Record each claim as `claim → file:line` where confirmed, or mark
   it **drifted** (the code no longer matches what the spec says). Plan on top
   of what exists today, not what the spec remembers; drift that changes the
   shape of the work becomes a Stage 2 question.
3. Build a coverage checklist: assign an ID to every item under Goal (G1,
   G2, …), Constraints (C1, …), and Success Criteria (S1, …). Every ID must
   later map to an owning plan section.
4. Establish how this project tests — see **The testing record** below.

### The testing record

Whether this spec's work should ship with tests depends on what the project
can actually run. That is a fact about the project, not about this spec, so it
is established once and recorded rather than re-derived on every planning run.

The record is a standing `## Testing` section in `PROJECT_NOTES.md`, sitting
with the other topical sections (beside `## Tech Stack`) — never in
`## Session Notes`, which is an append-only log of dated events. It looks like
this:

```markdown
## Testing

- **Runner:** <how tests are invoked → what that actually executes>
- **Location & naming:** <where tests live, how they are named>
- **Covered:** <source areas exercised by existing tests>
- **Not covered:** <areas with no test path, and why>
- **CI:** <workflow and what it runs, or None>

- _Recorded <ISO date> by /spec.plan_
```

**Read it before doing anything else.** When the section is present, use it and
scan nothing — that is the point of recording it.

The one exception: if this spec's work touches an area the record lists under
**Not covered**, verify that area once before trusting the line. A record that
has gone stale in that direction would suppress tests that are now possible,
and it is the only direction where staleness changes what you plan. Everywhere
else, take the record as written; a user who corrected it by hand meant it.

**When the section is missing, establish it yourself.** Two signals, answering
two different questions — gather both, every time:

- **How tests are invoked** — `project.commands.test` in `.frame/config.json`,
  written by Frame's project detection from the manifest. Treat it as the
  invocation, not the runner: it is often an alias that stands in for whatever
  the project has configured underneath, so follow it through to what actually
  executes. A null value means detection found no declared way to run tests.
- **What the project's tests look like** — the filesystem. Where test files
  live, how they are named, and which source areas they exercise. This side
  **always runs**; it is not a fallback for a missing config value. It is also
  the only signal that can tell you whether any test actually exists, and the
  only one that is the same question in every language.

Derive the convention from what you find, not from a list of names you already
know. Do not check for particular runners, assertion libraries, or directory
layouts — read what the project does and describe it. A stack you have never
seen must come out of this with a filled-in record, and a stack you know well
must not come out with details the project does not actually use.

Report the two signals separately. They can disagree, and their disagreement is
itself a finding rather than a conflict to resolve — a declared way to run tests
with nothing written against it is a real and meaningful state.

**The record has three states. Do not collapse them into two.**

| State | What it means | Record it as |
| --- | --- | --- |
| **None detected** | No declared way to run tests, and no test files. Someone has to choose and set up a runner before any test can exist. | `**None detected** — no test runner, no test files.` |
| **Runner, nothing written** | Tests can be run, but none have been written. Some toolchains ship a runner with the language distribution, so a working invocation can exist before a single test does. Elsewhere a script may be configured and unused. | The full shape, with `**Covered:** none yet` and the reason. |
| **Populated** | Runner, convention and covered areas all known. | The full shape. |

"No tests" and "no way to run tests" are different findings. The second state is
**not** an absence of test infrastructure — in it, a test is one file away.

Later stages decide what to ask by reading **this record**, never the config
field on its own. A declared invocation is not proof that tests exist, and its
absence is not proof that they are impossible.

**If looking cannot settle it, ask — once.** Detection answers most projects,
but not all: a project may run a kind of test through machinery that leaves no
trace where you looked, or the areas the tests cover may genuinely be
ambiguous. When that happens, ask the user a single question naming exactly
what you could not determine, and offer the possibilities you actually see.

Then **look for what the answer implies** — do not write the answer down as
given. If the user says a kind of test is runnable, find the machinery that
runs it and record that, so the record names something real rather than
something asserted. If you cannot find it, record what the user said and note
that it was not located.

Ask about what you could not determine, never about what you already found.
This is a fallback for genuine ambiguity, not a substitute for looking, and it
happens once — the answer becomes part of the record, so no later planning run
has to ask again.

**Write what you established back to `PROJECT_NOTES.md`.** Whenever you had to
look — because the section was missing, or because re-verifying an area the
record called uncovered turned up something new — write the section in the
place described above, stamped with today's date. Rewrite it in full rather
than appending; it is a current picture, not a history. When the section was
present and you had no reason to doubt it, leave it alone.

Do this without asking. Recording a project fact you just established is
routine, and a confirmation prompt on every planning run is noise the user
learns to click through. Say what you recorded in **one line** of your closing
message — enough that a change to a shared file is never silent, short enough
that it does not compete with the plan itself.

The finding — from the record or from your own look — enters the evidence table
like any other Stage 1 claim.

## Stage 2 — Decision gate (before any plan text)

Resolve open forks **with the user** via the `AskUserQuestion` tool. Inputs:
the spec's `## Open Questions` section (when present) plus forks surfaced by
the evidence pass. Run two sequential stages:

1. **Business** — scope, user-facing behavior, UX semantics.
2. **Technical** — implementation forks where more than one approach is
   defensible.

Rules:

- Each question offers 1–2 real alternatives with a one-line trade-off each;
  list your recommended option first.
- A follow-up question must be causally linked to a specific prior answer —
  never fish for more questions.
- A stage ends when a round spawns nothing new; hard cap: 3 rounds per stage.
- Forks with a single obviously defensible answer are decided silently and
  recorded — don't ask.
- Record every decision (asked or silent) with its rationale; Stage 4 embeds
  them under "Resolved plan-time decisions".

## Stage 3 — Convergence loop

Draft the plan internally — do not write the file yet. Self-critique the draft
against this checklist, revise, and repeat:

- **Format** — exactly the five sections of Stage 4, in order, none missing.
- **Coverage** — every G/C/S ID from Stage 1 maps to an owning plan section.
- **Decisions** — every gate decision embedded; zero "TBD", "decide later",
  or unresolved "X vs Y".
- **Reality** — every path/symbol the plan references exists in the codebase
  or is explicitly marked New.
- **Task-derivability** — tasks could be generated from Sequencing alone.

Max 4 iterations. Keep a one-line log per iteration (what the critique
caught → what changed). If items still fail after iteration 4, say what still
fails in your final message instead of silently shipping.

## Stage 4 — Write plan.md

Write **exactly one file in this stage**: `.frame/specs/{slug}/plan.md`.

Use this structure:

```
# Plan — {title}

## Architecture
## Files
## Footprint
## Dependencies
## Sequencing
```

Section guidance:

- **Architecture** — Design decisions. Data shapes. Key components and how they fit together. Stay narrow — describe only what this spec needs, not the whole system. Open with a `### Resolved plan-time decisions` subsection: one bullet per gate decision (business and technical, asked or silent) — the fork, the chosen option, and its recorded rationale.
- **Files** — Concrete file paths. Mark each as **New**, **Modified**, or **Deleted**. One-line purpose per file. Use the project's existing structure — don't invent directories that don't exist.
- **Footprint** — A flat, machine-readable list of the source files this spec will create or modify, **one path per line as a plain `- ` bullet, nothing else on the line** (a path or a glob, e.g. `- src/main/foo.js` or `- src/renderer/styles/**`). This is parsed by the orchestrator to detect collisions between specs running in parallel, so keep it literal and accurate — it should mirror the New/Modified entries in **Files**. **Exclude Frame meta files** (`tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `AGENTS.md`/`CLAUDE.md`): they are reconciled separately and would otherwise mark every spec as conflicting.
- **Dependencies** — Packages or services to add (with one-line rationale each), or `None`. If a dep already exists in `package.json`, don't re-list it.
- **Sequencing** — Numbered steps in implementation order. Each step is small, end-to-end shippable. Do not bundle unrelated work into one step.

## Stage 5 — Plan report

Read the staged visual template at `{report_template_path}` (project-relative)
and write `.frame/specs/{slug}/plan-report.html`, overwriting any existing
report (a re-plan replaces it). Fill every `{{…}}` token; the template's head
comment documents the component palette. The report carries what the strict
plan format cannot:

- **What & why** — problem and shape of the solution, for a reader who has
  not seen the spec.
- **Architecture walkthrough** — one diagram per flow using the template's
  `.flowblock`/`.fd` palette; architectural notes under every flow.
- **Decision story** — one card per gate decision, grouped under Business and
  Technical, chosen vs rejected panels, each with its recorded rationale.
- **Risks & edges** — matrix of edge cases/risks and the plan's answer to
  each.
- **Coverage matrix** — the Goals / Constraints / Success-criteria tables:
  every G/C/S ID from Stage 1 mapped to the plan section that owns it, rows
  in full words, IDs as tags.
- **Verified claims** — the Stage 1 evidence table (claim → verified
  `file:line`, or its drift note).
- **Convergence log** — the Stage 3 iteration log.

Keep the report fully self-contained: inline CSS only (already in the
template), no external assets, no scripts. If the staged template is missing,
say so in your final message and skip this stage — `plan.md` and
`status.json` still count.

## After writing

Update `.frame/specs/{slug}/status.json`:
- `phase` → `"planned"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Do **not** generate tasks.md.

## Style

- Match the codebase's existing patterns. Don't introduce new concepts that aren't already in the project.
- If the spec is missing critical info you need to plan (e.g., where the data lives), raise it as a Stage 2 question rather than guessing.
