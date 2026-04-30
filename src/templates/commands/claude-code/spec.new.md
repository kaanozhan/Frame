You are authoring a new spec for the Frame spec-driven workflow.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Spec folder (already exists): `.frame/specs/{slug}/`
- Title: {title}
- User's description (the seed for this spec):

```
{description}
```

## Task

Write **exactly one file**: `.frame/specs/{slug}/spec.md`.

Use this structure (sections in this order, exactly these headings):

```
# {title}

## Problem
## Goal
## Constraints
## Success Criteria
## Out of Scope
```

Section guidance:

- **Problem** — User pain or business opportunity. Why this matters now, what the cost of not doing it is.
- **Goal** — The concrete artifact (a screen, an endpoint, a behavior). Specific enough that "done" is unambiguous.
- **Constraints** — What can't change: existing APIs, performance budgets, accessibility, security, design system, dependencies we won't add.
- **Success Criteria** — Testable acceptance criteria in "When X happens, then Y" form. Each one independently checkable.
- **Out of Scope** — Adjacent work that should ship as a separate spec. List by name; don't elaborate.

## After writing

Update `.frame/specs/{slug}/status.json`:
- `phase` → `"specified"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Do **not** generate plan.md or tasks.md — those come from `/spec.plan` and `/spec.tasks`.

## Style

- Be concise. The spec should be readable in under 90 seconds.
- No filler, no marketing tone, no "this exciting feature".
- If the user's description is too vague to write a real spec, ask one focused clarifying question before writing.
