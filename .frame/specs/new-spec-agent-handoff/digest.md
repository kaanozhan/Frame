---
keywords: new spec modal, spec.new, agent dispatch, spec creation, prompt staging, lane naming, telemetry origin
related: cli-spec-command-parity, spec-status-repair, agent-dispatch, spec-knowledge-layer, audit-q3-product-analytics
---
The New Spec modal stopped producing specs and became a launcher: one free-form
textarea whose Create stages a slug-less `spec.new` prompt and dispatches it into
a lane named "Spec Creator". The agent derives the title and slug, disambiguates
against the embedded catalog, and creates `.frame/specs/<slug>/` with both files.

Why this path: `cli-spec-command-parity`'s rule — the staged template is the only
flow — finally applied to the button. `createSpec` was deleted rather than left
as a second authoring path (with `uniqueSlug`, `generateSlug` and `CREATE_SPEC`);
slug uniqueness moved to the agent because the catalog it already receives is the
complete list. Rejected: keeping the lane unbound (breaks continuity into
"Generate Plan"), and a second staging IPC channel (`agent-dispatch` is the one door).

Rules established:
- `getCommandPrompt` accepts `slug: null` for `spec.new` only; `{slug}`/`{title}`
  are omitted, not blanked. Prompt files are `spec.new__<ts>.md` so each run's
  text survives as its own recovery surface.
- The lane binds only when exactly one slug appeared and exactly one Spec Creator
  lane is waiting; anything else stays unbound rather than guessing.
- `spec_created` fires from the specs watcher when a slug's `spec.md` first
  exists — never from a folder or a `status.json` — which corrected the old
  fire-before-write miscount. `origin` is `button` only when Frame staged the
  prompt (markers expire after 30 min), and any enum change moves `PRIVACY.md`
  in the same commit.
- `draft` and its "Write the Spec" action stay as the recovery path for spec
  folders created outside Frame.
- `panels.css` was NOT changed, against plan.md: the title-field classes are
  shared with the rename modal.
- A dispatch that cold-starts a CLI must never be awaited by a modal: hand off
  once the lane exists and let the lane be the progress surface (T08, found in
  real use — the overlay sat over the terminal for the whole 15s ready wait).

Chain: spec.md → plan.md → tasks.md → outcome.md
