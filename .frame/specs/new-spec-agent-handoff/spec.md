---
keywords: new spec modal, spec.new, agent dispatch, spec creation, prompt staging, lane naming
related: cli-spec-command-parity, spec-status-repair, agent-dispatch, spec-knowledge-layer
---

# New Spec hands off to the agent

## Problem

The New Spec modal is the only entry point that produces a `spec.md` without
ever reading the `spec.new` template. It fails in two different directions:

- **Description filled in → the agent is bypassed.** `createSpec`
  (`src/main/specManager.js:981`) writes `# {title}\n\n{description}` itself
  and sets `phase: 'specified'`. That phase makes `nextActionForPhase`
  (`src/renderer/specNextAction.js:43`) skip `spec.new` and offer "Generate
  Plan", so the agent never authors the spec: no front matter
  (`keywords` / `related` / `supersedes`), none of the five required
  sections, and no relatedness pass over the spec catalog. `/spec.plan` then
  plans on top of raw prose.
- **Description left empty → it is swallowed.** The phase is `draft`, so
  `spec.new` does run, but the text never reaches it: `getCommandPrompt`
  hardcodes `description: ''` (`src/main/specManager.js:537`) behind a
  comment claiming `spec.new` reads the seeded `spec.md` — which on the draft
  path was never written. `AGENTS.md` documents `{description}` as "the
  user's description"; in practice it is always empty.

Meanwhile every other route already works: with spec-driven development
enabled, an agent mid-conversation offers to turn a description into a spec,
and "write me a spec for X" produces the correct artifact — because both
resolve to the staged template.

`cli-spec-command-parity` established the governing principle: every entry
point runs the same current-generation flow from the staged template, never
improvised. The CLI was brought into line; the modal was left behind.

## Goal

**Create** in the New Spec modal stops producing a spec. It takes the user's
free-form text, opens an agent lane named **Spec Creator**, and hands that
text to the standard `spec.new` flow. The agent derives the slug, creates
`.frame/specs/<slug>/`, writes `status.json` and authors `spec.md` from the
staged template — byte-for-byte the same artifact a conversational spec
request produces today.

No spec folder exists until the agent creates one. The `draft` phase stops
being reachable from the modal.

## Constraints

- **The template is the single source of the flow** (`cli-spec-command-parity`).
  The modal becomes a launcher; no spec content is authored in
  `specManager.js` or the renderer.
- **The modal collapses to one free-form text field.** Title and description
  as separate inputs are removed — the slug and title become the agent's
  output, not the user's input. Slug uniqueness moves from `uniqueSlug` to
  the agent, which already receives the full spec catalog via
  `{spec_catalog}`.
- **Prompt staging must work without a slug.** `getCommandPrompt`
  (`src/main/specManager.js:526`) returns `spec not found` when
  `readStatus` misses, so `spec.new` needs a slug-less staging variant that
  interpolates the user's real text into `{description}` and omits
  `{slug}` / `{title}`.
- **Agent-created spec folders are already supported** and must stay so:
  `spec.new.md` documents the full required `status.json` shape, and
  `repairSpecStatus` (`spec-status-repair`, issue #122) derives a missing
  `slug` / `generated_task_ids` from the folder. Do not weaken either.
- **The user's text must survive a failed or abandoned run.** The staged
  prompt already persists under `.frame/runtime/prompts/`; that is the
  recovery surface. Do not invent a separate draft store.
- **Dispatch goes through the existing choke point** (`agent-dispatch`).
  The Spec Creator lane is an ordinary agent lane, not a new mechanism.
- **The `draft` phase and its "Write the Spec" action stay in the code** as
  the recovery path for specs created outside the modal (CLI, conductor).
- **`spec_created` telemetry must not disappear** — it currently fires inside
  `createSpec`, which this flow no longer calls.
- **`spec_created` must record how the spec was started**, so the button path
  and the agent path can be told apart in the analytics. Frame's telemetry
  registry allows fixed enum values only, and adding one requires the matching
  `PRIVACY.md` row in the same change (`src/main/telemetryEvents.js`, header
  comment). Attribution is never guessed: when Frame cannot tell, the event is
  sent without the property.

## Success Criteria

- When the user types into New Spec and clicks Create, then no directory
  appears under `.frame/specs/` until the agent writes one.
- When Create is clicked, then a lane named "Spec Creator" opens, an agent
  starts in it, and the user's text arrives as the `spec.new` prompt.
- When the agent finishes, then the resulting `spec.md` carries the
  front-matter block and the five required sections in template order, and
  the spec appears in the panel without a manual refresh (via `WATCH_SPECS`).
- When `spec.new` is dispatched from the modal, then `{description}` contains
  the user's text verbatim — not an empty string.
- When the agent's run fails or its terminal is closed before it writes
  anything, then no partial spec is left behind and the user's text is still
  readable under `.frame/runtime/prompts/`.
- When a spec is created this way, then `spec_created` is tracked exactly once.
- When the title the agent derives collides with an existing slug, then the
  new spec still gets a unique folder name.
- When a spec is created from the New Spec launcher, then `spec_created`
  carries the origin `button`; when it is created by asking an agent directly,
  `agent`; when it comes out of an orchestration run, `conductor`. When the
  origin is ambiguous, then the event is sent with no origin at all — never
  with a guessed one.
- When the origin enum changes, then `PRIVACY.md`'s event table changes in the
  same commit.

## Out of Scope

- The `spec.plan` / `spec.tasks` / `spec.implement` flows and their templates.
- Rename, delete, and the specs dashboard beyond what the new creation path
  requires.
- Multi-tool support beyond `claude-code`; the codex template dir stays a
  placeholder.
- Persisting spec lane assignments across restarts (`agent-dispatch` scoped
  `specLanes` to the session deliberately).

## Open Questions

- **How does the Spec Creator lane become the spec's lane?** `specLanes` in
  `agentDispatch.js` is keyed by slug, and at dispatch time there is no slug.
  Left unbound, the next action ("Generate Plan") will not recognise the lane
  and will open a second Frame, breaking the flow's continuity.
  Options: (a) the specs watcher binds the newly appeared slug to the lane
  that is currently labelled Spec Creator; (b) the lane stays unbound and
  `spec.plan` opens a new Frame as it does for any first run.
- **What names the lane after the spec exists?** Options: (a) it keeps
  "Spec Creator" for the session; (b) it relabels to `spec: <slug>` once the
  agent writes `status.json`, matching every other spec lane's assignment
  chip.
