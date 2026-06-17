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
## Footprint
## Dependencies
## Sequencing
```

Section guidance:

- **Architecture** — Design decisions. Data shapes. Key components and how they fit together. Stay narrow — describe only what this spec needs, not the whole system.
- **Files** — Concrete file paths. Mark each as **New**, **Modified**, or **Deleted**. One-line purpose per file. Use the project's existing structure — don't invent directories that don't exist.
- **Footprint** — A flat, machine-readable list of the source files this spec will create or modify, **one path per line as a plain `- ` bullet, nothing else on the line** (a path or a glob, e.g. `- src/main/foo.js` or `- src/renderer/styles/**`). This is parsed by the orchestrator to detect collisions between specs running in parallel, so keep it literal and accurate — it should mirror the New/Modified entries in **Files**. **Exclude Frame meta files** (`tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `AGENTS.md`/`CLAUDE.md`): they are reconciled separately and would otherwise mark every spec as conflicting.
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
