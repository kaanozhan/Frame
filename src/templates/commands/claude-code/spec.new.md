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

## Spec catalog (the project's existing specs)

```
{spec_catalog}
```

## Task

**First, evaluate relatedness.** Scan the catalog above and decide which
existing specs genuinely relate to this description — you are the semantic
matcher; the catalog guarantees recall, you provide precision. For each
related spec, read its chain as needed (`.frame/specs/<slug>/spec.md` →
`plan.md` → `digest.md`/`outcome.md`) and let what you find **shape the
spec you write**:

- A prior decision this spec must respect (or deliberately reverse) →
  record it under **Constraints**, naming the source spec.
- Work an existing spec already covers → **Out of Scope**, by name.
- A genuine unresolved fork with a prior spec → **Open Questions**.
- A spec this one replaces → declare it in `supersedes:`.

No related specs → skip silently; never force a connection.

Then write **exactly one file**: `.frame/specs/{slug}/spec.md`.

Open the file with a front-matter block (machine-read by the spec index —
keep the exact key names):

```
---
keywords: <3-8 comma-separated concepts a teammate would search for>
related: <comma-separated related slugs, or omit the line>
supersedes: <slug this spec replaces, or omit the line>
---
```

Then use this structure (sections in this order, exactly these headings):

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

After the five sections, append one more **only when it applies**:

- **Open Questions** — add an `## Open Questions` section **only when the
  description genuinely leaves unresolved forks that need a developer or
  business decision**. Each entry names the fork and lists 1–2 candidate
  options. No forks → no section; never invent questions to fill it. This
  section is the primary input to `/spec.plan`'s decision gate, where the
  forks get resolved with the user.

## After writing

Update `.frame/specs/{slug}/status.json`:
- `phase` → `"specified"`
- `updated_at` → current ISO timestamp
- `last_phase_at` → current ISO timestamp

### status.json — the required shape

Frame creates this file for you here, so you are only editing fields. If you
ever write one from scratch (creating a spec folder without `/spec.new`),
every field below marked required must be present, or Frame cannot read the
folder as a spec:

```json
{
  "slug": "{slug}",                  // required — must equal the folder name
  "title": "Human readable title",   // required
  "phase": "specified",              // required — draft | specified | planned |
                                     //            tasks_generated | implementing | done
  "generated_task_ids": [],          // required — [] until /spec.tasks fills it
  "ai_tool": "claude-code",          // optional
  "created_at": "ISO-8601",          // optional
  "updated_at": "ISO-8601",          // optional
  "last_phase_at": "ISO-8601"        // optional
}
```

Frame repairs a missing `slug` or `generated_task_ids` from the folder itself,
but anything else missing leaves the spec listed as "needs attention" until a
human fixes it.

Do **not** generate plan.md or tasks.md — those come from `/spec.plan` and `/spec.tasks`.

## Style

- Be concise. The spec should be readable in under 90 seconds.
- No filler, no marketing tone, no "this exciting feature".
- If the user's description is too vague to write a real spec, ask one focused clarifying question before writing.
