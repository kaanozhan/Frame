You are breaking a Frame spec into discrete implementation tasks through a
staged flow: derive the list from the plan, then write it.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Spec folder: `.frame/specs/{slug}/`

Work through the stages below **in order**. Do not write any file before the
write stage.

## Stage 1 — Plan pass

1. Read `.frame/specs/{slug}/spec.md` and `.frame/specs/{slug}/plan.md` fully.
2. Derive the complete task list. `plan.md` is the spine — its `## Sequencing`
   steps are the primary source, with `## Files` naming what each step touches.
   `spec.md` supplies the intent a step serves.

This pass alone must produce a shippable list. Nothing later in the flow may
weaken it.

Rules for the list:

- IDs are zero-padded: T01, T02, ..., T09, T10. The list is ordered by implementation order; see **Task IDs** below for how numbers are assigned.
- Each task is independently completable. Don't bundle "do X then Y" into one bullet.
- Each task is specific enough to act on without re-reading the plan. Reference file paths when relevant.
- Aim for 5–12 tasks. If the work is bigger, suggest splitting the spec rather than producing 30+ tasks.
- Tasks should map to commits. Roughly: one task ≈ one PR-worthy change.

## Stage 2 — Report pass

`/spec.plan` may have produced a visual plan report next to `plan.md`. It
carries what the strict plan format cannot: a risk and edge matrix, a coverage
matrix mapping every spec item to the plan section that owns it, the decision
story, the evidence pass's verified claims, and the convergence log.

If `.frame/specs/{slug}/plan-report.html` exists, read it **in full** before
going on, then reconcile the draft list against what it reveals.

Locate what you need **semantically** — "the table listing edge cases and risks
against the plan's answer to each", "the tables mapping each spec goal,
constraint and success criterion to its owning plan section". Do **not** match
on heading text or card number. The report template evolves independently of
this prompt, and a literal anchor fails *silently* the day a heading changes:
the pass would find nothing, alter nothing, and still report success.

Reconcile rule by rule:

- **Risks and edges** — a row becomes a new task **only** when the plan's
  answer names concrete behavior that no `## Sequencing` step describes. An
  answer that states what already holds ("the panel is already
  single-toast-at-a-time") or that cites a step outright ("Sequencing step 8 is
  a grep sweep") yields nothing. On a nine-row table this rule typically leaves
  one or two candidates; if it leaves eight, you are reading it too loosely.

- **Coverage matrix** — every goal, constraint and success-criterion ID is
  mapped there to the plan section that owns it. An ID whose owning section
  produced no task is a gap: close it with a new task, or fold it into an
  existing task where it genuinely belongs.

- **Verified claims** — where the evidence pass recorded drift, check whether
  any task rests on the claim that drifted. If one does, correct that task's
  description to match what the codebase actually contains.

- **Decision story** — **context only.** It explains why the plan looks the way
  it does. An option the report records as *rejected* must never become a task,
  and a task that contradicts a recorded decision is corrected to match the
  decision.

What this pass may and may not do:

- **Add and revise. Never delete.** No task the plan pass produced may be
  dropped here, however redundant the report makes it look.
- **`plan.md` wins every conflict.** The report denounces gaps; it is not a
  second source of truth. Where the two disagree about what the work is, the
  plan is right and the report is context.
- **The 5–12 ceiling still holds.** If closing the report's gaps would push the
  list past twelve, stop and recommend splitting the spec instead of shipping
  twenty tasks. A spec whose real work does not fit was already too big — the
  report has just made that visible. Raising the ceiling would hide it.

If the report does not exist, or a section of it cannot be located, this stage
changes nothing and the plan pass's list stands as written. Mention it **once**
in your closing message — a single line naming what was missing. Do not warn
per section, do not treat it as a failure, and do not ask the user to produce a
report. A spec planned before the report existed is normal, not broken.

## Task IDs

An ID is an identity, not a position. The list's *order* carries implementation
order; a task's *number* carries which work it is.

- **First generation** — number the list T01, T02, T03 … in implementation
  order.
- **Regeneration** — a `tasks.md` already exists. Read it first: every ID
  already bound to a piece of work keeps that work. New work takes the next
  unused number and is inserted at its correct position in the list.

**Never renumber an existing task** — not to tidy the sequence, not because a
number looks high, not for any task in any status. Frame keys tasks by
`spec:{slug}:T<n>` and preserves the status the user set. Moving a number
transplants that status onto different work: a task the user marked completed
would silently come to describe work nobody has done.

Two consequences follow, and both are correct output:

- A regenerated list may read `T01, T02, T05, T03, T04`. Ascending order is
  deliberately given up so that numbers stay bound to their work.
- Numbers are allocated and never reclaimed, so the highest number drifts above
  the task count — a nine-task list may legitimately end at `T14`. **The 5–12
  ceiling counts tasks, not numbers.** Never renumber to bring a high number
  "back into range".

## Stage 3 — Write

Write **exactly one file**: `.frame/specs/{slug}/tasks.md`.

Format — a flat markdown bullet list, no nesting:

```
# Tasks — {title}

- T01 · <imperative one-line description>
- T02 · <imperative one-line description>
- T03 · ...
```

Emit nothing beyond the heading and the bullets — no cross-check section, no
provenance annotations, no note about what the report changed. The
reconciliation is an internal step, not an artifact. (A stray `- T…` bullet
inside such a note would also be imported as a task.)

Then update `.frame/specs/{slug}/status.json`:
- `phase` → `"tasks_generated"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Frame's watcher will auto-import these tasks into `tasks.json` with the marker `source: "spec:{slug}:T<n>"`. Don't duplicate them into `tasks.json` yourself.

## Style

- Imperative voice ("Add ShareButton", not "Adds ShareButton" or "We will add ShareButton").
- No filler words ("simply", "just", "basically").
