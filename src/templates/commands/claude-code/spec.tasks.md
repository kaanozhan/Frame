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

- IDs are zero-padded: T01, T02, ..., T09, T10. Numbered in implementation order.
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

## Stage 3 — Write

Write **exactly one file**: `.frame/specs/{slug}/tasks.md`.

Format — a flat markdown bullet list, no nesting:

```
# Tasks — {title}

- T01 · <imperative one-line description>
- T02 · <imperative one-line description>
- T03 · ...
```

Then update `.frame/specs/{slug}/status.json`:
- `phase` → `"tasks_generated"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Frame's watcher will auto-import these tasks into `tasks.json` with the marker `source: "spec:{slug}:T<n>"`. Don't duplicate them into `tasks.json` yourself.

## Style

- Imperative voice ("Add ShareButton", not "Adds ShareButton" or "We will add ShareButton").
- No filler words ("simply", "just", "basically").
