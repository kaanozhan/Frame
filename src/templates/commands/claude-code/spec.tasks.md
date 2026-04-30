You are breaking a Frame spec into discrete implementation tasks.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Files to read first:
  - `.frame/specs/{slug}/spec.md`
  - `.frame/specs/{slug}/plan.md`

## Task

Read both files. Then write **exactly one file**: `.frame/specs/{slug}/tasks.md`.

Format — a flat markdown bullet list, no nesting:

```
# Tasks — {title}

- T01 · <imperative one-line description>
- T02 · <imperative one-line description>
- T03 · ...
```

## Rules

- IDs are zero-padded: T01, T02, ..., T09, T10. Numbered in implementation order.
- Each task is independently completable. Don't bundle "do X then Y" into one bullet.
- Each task is specific enough to act on without re-reading the plan. Reference file paths when relevant.
- Aim for 5–12 tasks. If the work is bigger, suggest splitting the spec rather than producing 30+ tasks.
- Tasks should map to commits. Roughly: one task ≈ one PR-worthy change.

## After writing

Update `.frame/specs/{slug}/status.json`:
- `phase` → `"tasks_generated"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Frame's watcher will auto-import these tasks into `tasks.json` with the marker `source: "spec:{slug}:T<n>"`. Don't duplicate them into `tasks.json` yourself.

## Style

- Imperative voice ("Add ShareButton", not "Adds ShareButton" or "We will add ShareButton").
- No filler words ("simply", "just", "basically").
