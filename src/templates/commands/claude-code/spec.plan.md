You are generating an implementation plan for an existing Frame spec.

## Context

- Project root: `{project_path}`
- Spec slug: `{slug}`
- Spec file (read this first): `.frame/specs/{slug}/spec.md`

## Task

Read `spec.md` carefully. Then write **exactly one file**: `.frame/specs/{slug}/plan.md`.

Use this structure:

```
# Plan — {title}

## Architecture
## Files
## Dependencies
## Sequencing
```

Section guidance:

- **Architecture** — Design decisions. Data shapes. Key components and how they fit together. Stay narrow — describe only what this spec needs, not the whole system.
- **Files** — Concrete file paths. Mark each as **New**, **Modified**, or **Deleted**. One-line purpose per file. Use the project's existing structure — don't invent directories that don't exist.
- **Dependencies** — Packages or services to add (with one-line rationale each), or `None`. If a dep already exists in `package.json`, don't re-list it.
- **Sequencing** — Numbered steps in implementation order. Each step is small, end-to-end shippable. Do not bundle unrelated work into one step.

## After writing

Update `.frame/specs/{slug}/status.json`:
- `phase` → `"planned"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

Do **not** generate tasks.md.

## Style

- Match the codebase's existing patterns. Don't introduce new concepts that aren't already in the project.
- If the spec is missing critical info you need to plan (e.g., where the data lives), ask one focused clarifying question before writing.
