# A spec is never silently hidden

> **What we're building:** A spec folder whose `status.json` is missing
> derivable fields is repaired instead of dropped, and anything still
> unusable is shown with its reason instead of vanishing. The required shape
> is written down where the agents that create specs can read it.

## Reported as (issue #122, StreamlinedStartup)

> The spec panel does not show a spec when its status.json has no slug field.
> The panel skips the spec and shows no error. In this case, the specs came
> from Frame's own orchestration flow: the conductor agent … converted
> existing project tasks into spec folders. Frame's UI then hid all five
> specs.

The reporter's point is the sharp one: this is not a third-party tool
guessing at Frame's format. Frame launched the conductor, handed it
`CONDUCTOR.md` and the staged spec templates, and those templates name the
fields to *update* (`phase`, `updated_at`, `last_phase_at`) without ever
stating the required shape. Half of Frame then accepted the result — the
task watcher imported `tasks.md` and wrote `generated_task_ids` back into
that same file, and `spec-index.js` indexed it — while the panel hid it.

## Reproduced

Running the real `specManager` against a conductor-shaped `status.json`
(`title`, `phase`, timestamps):

```
validator: "missing slug"     listSpecs: []
```

**Beyond the report:** deriving the slug alone is not enough. The validator's
next required field is also absent, so the spec stays hidden:

```
slug filled in → "generated_task_ids must be an array"
slug + generated_task_ids → valid
```

Both fields are derivable — the slug is the folder's name, and a spec that
has generated no tasks has an empty list.

Also affected: `updateSpecStatus` runs the same validator, so a spec in this
state cannot have its phase advanced through the API either.

## Goal / Acceptance

- A spec folder with a readable `status.json` missing `slug` and/or
  `generated_task_ids` is listed, and the file is repaired once on disk so
  the rest of Frame agrees with the panel.
- An existing `slug` is **never** overwritten. Folder and slug disagreeing
  is a rename question, not a repair one, and rewriting it would silently
  cut every `source: spec:<slug>:T##` link in tasks.json.
- What cannot be derived (unreadable JSON, unknown phase, missing title) is
  listed as a malformed entry carrying the validator's reason, not skipped.
  Directories with no spec file at all stay ignored — they are not specs.
- Malformed entries are inert in the panel: no phase actions, no agent
  dispatch; they exist to be seen and fixed.
- Every repair and every malformed entry is logged with its reason.
- The required `status.json` shape is documented in the spec command
  templates and in `CONDUCTOR.md` — in `src/templates/`, the source Frame
  stages from, not the generated copy under `.frame/runtime/`.
- Specs that are valid today are unaffected: same validator result, same
  listing, no writes.
