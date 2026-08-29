You are authoring a new spec for the Frame spec-driven workflow.

**No spec folder exists yet.** You create it. There is no slug, no title and no
`status.json` until you write them — deriving all three from the description
below is the first half of this job.

## Context

- Project root: `{project_path}`
- User's description (the seed for this spec):

```
{description}
```

## Spec catalog (the project's existing specs)

```
{spec_catalog}
```

## Task

### 1. Derive the slug and the title

The title is a short human-readable name for the work — a noun phrase, not a
sentence, and not a restatement of the whole description.

The slug is the folder name, derived from the title:

- lowercase, `[a-z0-9-]` only — every other character becomes a `-`
- collapse runs of `-`, trim leading and trailing ones
- at most 48 characters, trimmed again after truncation

**Then check it against the catalog above.** The catalog is the complete list
of existing specs, so it is also the uniqueness check: if your slug is already
taken, append `-2`, then `-3`, until it is free. A collision is not a reason to
pick a different title.

### 2. Evaluate relatedness

Scan the catalog and decide which existing specs genuinely relate to this
description — you are the semantic matcher; the catalog guarantees recall, you
provide precision. For each related spec, read its chain as needed
(`.frame/specs/<slug>/spec.md` → `plan.md` → `digest.md`/`outcome.md`) and let
what you find **shape the spec you write**:

- A prior decision this spec must respect (or deliberately reverse) →
  record it under **Constraints**, naming the source spec.
- Work an existing spec already covers → **Out of Scope**, by name.
- A genuine unresolved fork with a prior spec → **Open Questions**.
- A spec this one replaces → declare it in `supersedes:`.

No related specs → skip silently; never force a connection.

### 3. Create the folder and write both files

Create `.frame/specs/<slug>/` and write exactly two files into it:
`status.json` and `spec.md`. Nothing else — `plan.md` and `tasks.md` come from
`/spec.plan` and `/spec.tasks`.

#### `status.json` — the required shape

You are writing this from scratch, so every field marked required must be
present, or Frame cannot read the folder as a spec:

```json
{
  "slug": "<slug>",                  // required — must equal the folder name
  "title": "Human readable title",   // required
  "phase": "specified",              // required — draft | specified | planned |
                                     //            tasks_generated | implementing | done
  "generated_task_ids": [],          // required — [] until /spec.tasks fills it
  "ai_tool": "claude-code",          // optional
  "created_at": "ISO-8601",          // optional — now
  "updated_at": "ISO-8601",          // optional — now
  "last_phase_at": "ISO-8601"        // optional — now
}
```

`phase` is `"specified"` from the start: you write `spec.md` in the same turn,
so the spec is never a draft. (`draft` remains the phase for a folder created
outside this flow whose `spec.md` has not been written yet — Frame offers
"Write the Spec" there.)

Frame repairs a missing `slug` or `generated_task_ids` from the folder itself,
but anything else missing leaves the spec listed as "needs attention" until a
human fixes it.

#### `spec.md`

Open the file with a front-matter block (machine-read by the spec index —
keep the exact key names):

```
---
keywords: <3-8 comma-separated concepts a teammate would search for>
related: <comma-separated related slugs, or omit the line>
supersedes: <slug this spec replaces, or omit the line>
---
```

Then use this structure (sections in this order, exactly these headings, with
the title you derived as the `#` heading):

```
# <title>

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

Say which slug you created, in one line, so the user can find it in the panel.
Frame's watcher picks the new folder up on its own — there is nothing to
refresh and no status to advance beyond the `"specified"` you already wrote.

## Style

- Be concise. The spec should be readable in under 90 seconds.
- No filler, no marketing tone, no "this exciting feature".
- If the user's description is too vague to write a real spec, ask one focused
  clarifying question **before creating anything** — a half-answered spec is
  worse than no folder at all.
