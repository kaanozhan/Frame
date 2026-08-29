# Plan — New Spec hands off to the agent

## Architecture

The New Spec modal stops being a spec *producer* and becomes a *launcher*.
Today two independent code paths can author a `spec.md`; after this spec there
is one, and it is the staged `spec.new` template — the principle
`cli-spec-command-parity` established for the CLI, finally applied to the
button.

The flow becomes:

```
modal (one textarea)
  → buildSpecCommandFile(projectPath, null, 'spec.new')   [main]
      writes .frame/runtime/prompts/spec.new__<ts>.md with {description} = user's text
  → agentDispatch: new lane, named "Spec Creator", prompt injected
  → agent derives slug, creates .frame/specs/<slug>/, status.json, spec.md
  → WATCH_SPECS sees the new folder → SPEC_DATA push
  → agentDispatch binds that slug to the Spec Creator lane and relabels it
```

Nothing in `specManager.js` or the renderer writes spec content at any point.

### Resolved plan-time decisions

**Business**

- **Lane binding after creation** — *bind*. When the new slug appears, it is
  attached to the lane that produced it, so "Generate Plan" continues in the
  same Frame instead of opening a second one. Leaving it unbound was the
  zero-code option but breaks the continuity that makes the launcher worth
  having.
- **Lane label after creation** — *relabel to `spec: <slug>`*. Once
  `status.json` exists the lane is an ordinary spec lane and gets the same
  navigable assignment chip as every other one. "Spec Creator" is a name for
  a transient state, not a permanent identity.

**Technical**

- **How the slug finds its lane** — *single-live-lane rule*. A newly appeared
  slug binds only when exactly one live lane is currently labelled Spec
  Creator; zero or several, and it stays unbound. This introduces no new
  state and cannot mis-bind. The cost is accepted: two concurrent spec
  creations both stay unbound, which degrades to the "unbound" option's
  behavior rather than to a wrong answer.
- **Test posture** — *pure logic and data transforms only*. The testing
  record's **Covered** line is `src/main/`, `src/shared/`, `scripts/`, and
  `src/renderer/` is **Not covered** with no DOM harness installed
  (re-verified this run: `@electron/rebuild`, `electron`, `electron-builder`,
  `esbuild` are the only devDependencies). Slug-less prompt building is pure
  and testable; the modal, the dispatch and the lane binding are not testable
  here without first choosing a harness, which is outside this spec.
- **`createSpec` is deleted, not left in place** *(silent)*. It has exactly
  one caller (`src/renderer/specPanel.js:615`). Leaving the bypass door open
  is precisely the inconsistency this spec closes. Fallout removed with it:
  `uniqueSlug`, `generateSlug` and its export, the `CREATE_SPEC` channel and
  handler, and the renderer's duplicated `deriveSlugPreview`.
- **Slug-less staging reuses `buildSpecCommandFile`** *(silent)*, called with
  `slug: null`, rather than a new IPC channel. `agent-dispatch` exists to be
  the single door; a second staging channel would be a second door.
- **Prompt filename for a slug-less run** *(silent)* — `spec.new__<ts>.md`.
  The current name is `${slug}__${command}.md`
  (`src/main/specManager.js:745`), which without a slug yields
  `null__spec.new.md` and makes every run overwrite the last. A timestamp
  keeps concurrent runs apart and preserves each run's text, which is what
  makes `.frame/runtime/prompts/` a real recovery surface (C5).
- **`spec_created` moves to the specs watcher and fires on `spec.md`, not on
  the folder** *(silent)*. `createSpec` was its only home and is gone. The
  trigger becomes "this slug's `spec.md` exists and did not before" —
  `fileExists(projectPath, slug, SPEC_FILE)` is already computed on the
  watcher's path (`derivePhase`, `specManager.js:419`), so the signal costs
  nothing new. Keyed on `spec.md` rather than on `status.json` deliberately:
  a spec whose folder was created but whose authoring failed is not a spec
  that was created.

  **This also fixes a live bug.** Today `telemetry.track('spec_created')`
  runs at `specManager.js:1007`, *before* the `if (hasDescription)` block
  that writes `spec.md` at `:1009` — and unconditionally. Every empty-
  description creation therefore counted a spec that had only a
  `status.json` and no `spec.md` at all. Porting the event as-is would carry
  that miscount forward, so it is corrected in the move rather than left for
  a later spec.

  Consequences accepted: the opening snapshot must be seeded with the slugs
  that already have a `spec.md`, so nothing is backfilled and a deleted-then-
  rewritten `spec.md` is not double-counted; and specs authored by the CLI or
  the conductor now count too — which matches what `PRIVACY.md:15` already
  documents ("a spec was created") and the activation question
  `audit-q3-product-analytics` set the event up to answer.
- **`spec_created` gains an `origin` property** *(silent — requested during
  plan review)*. Values: `button` (Frame's New Spec launcher), `agent` (the
  user asked an agent directly — a conversation or a CLI-typed command; Frame
  cannot distinguish those two and does not need to), `conductor` (the spec
  came out of an orchestration run). **Attribution rides on D3's signal, not a
  new one:** the button path is the only one where Frame itself staged a
  `spec.new` prompt and named the lane, so the outstanding-launch marker that
  binds the lane also attributes the event. `conductor` is read from Frame's
  own orchestration state, not inferred from the agent. Ambiguity resolves
  *downward* — to `agent`, or to no property at all — so `button` can
  undercount but never overcount. `validateEvent`
  (`src/main/telemetryEvents.js:69-79`) silently drops a value outside the
  enum and skips an absent one, so a failed attribution degrades to today's
  bare event rather than to a wrong one. Adding the enum requires the matching
  `PRIVACY.md:15` row in the same change, per the registry's own header rule.

- **The CLI hint's `spec.new` gap is left alone** *(decided with the author)*.
  `scripts/spec-command-hint.js:248-253` bails out of staging for `spec.new`
  and tells the agent to interpolate the template by hand — the same
  slug-shaped gap this spec closes for the button, in the CLI path. Sequencing
  1 makes closing it possible, but the agent-side flow works today and the
  author scoped this spec to the button. It stays a separate, now-unblocked
  piece of work.

- **In-flight collision** *(silent)* — `audit-q3-performance-resources` is
  `implementing` and its footprint lists `src/main/specManager.js` and
  `src/renderer/terminalManager.js`. Nine of its ten tasks are complete and
  the remaining T10 is a measurement pass that edits no source, so the two
  are planned as non-colliding. This spec does not modify
  `terminalManager.js` at all — it calls the existing `renameTerminal`.

## Files

- `src/main/specManager.js` — **Modified**. Slug-less `spec.new` branch in
  `getCommandPrompt` / `buildSpecCommandFile`; `createSpec`, `uniqueSlug`,
  `generateSlug` removed; `spec_created` relocated to the watcher's new-slug
  diff.
- `src/shared/ipcChannels.js` — **Modified**. `CREATE_SPEC` removed.
- `src/renderer/specPanel.js` — **Modified**. `showNewSpecPrompt` collapses to
  a single textarea and dispatches instead of invoking `CREATE_SPEC`;
  `deriveSlugPreview` removed.
- `src/renderer/agentDispatch.js` — **Modified**. New `dispatchSpecNew(text)`;
  `SPEC_DATA` subscription that binds a newly appeared slug to the single live
  Spec Creator lane and relabels it.
- `src/templates/commands/claude-code/spec.new.md` — **Modified**. Entry
  rewritten for "no folder exists yet": derive the slug, check it against the
  catalog for uniqueness, create the folder and write `status.json` in the
  shape the template already documents.
- `src/shared/frameTemplates.js` — **Modified**. Placeholder table and the
  `spec.new` line corrected — `{description}` now carries the user's text and
  `{slug}` is absent for `spec.new`.
- `src/renderer/styles/components/panels.css` — **Modified**. Modal drops the
  title-field and dual-label styling.
- `src/main/telemetryEvents.js` — **Modified**. `spec_created` gains
  `origin: ['button', 'agent', 'conductor']`.
- `PRIVACY.md` — **Modified**. The `spec_created` row gains the origin values,
  in the same change as the registry.
- `test/telemetry.test.js` — **Modified**. Origin enum accepted, unknown value
  dropped, absent property still valid.
- `test/specNewStaging.test.js` — **New**. Slug-less prompt building:
  `{description}` interpolation, absent `{slug}`/`{title}`, catalog embed,
  filename uniqueness across runs.

## Footprint

- src/main/specManager.js
- src/shared/ipcChannels.js
- src/renderer/specPanel.js
- src/renderer/agentDispatch.js
- src/templates/commands/claude-code/spec.new.md
- src/shared/frameTemplates.js
- src/renderer/styles/components/panels.css
- src/main/telemetryEvents.js
- PRIVACY.md
- test/telemetry.test.js
- test/specNewStaging.test.js

## Dependencies

None. The test uses Node's built-in runner, which the CI workflow requires
(it runs `npm test` with no `npm ci`, so nothing may reach `node_modules`).

## Sequencing

1. **Slug-less staging in the main process.** Branch `getCommandPrompt` so
   `spec.new` with `slug: null` skips the `readStatus` guard
   (`specManager.js:529-530`) and interpolates `{description}` with the
   caller's text and `{spec_catalog}` as today, emitting no `{slug}`/`{title}`.
   Give `buildSpecCommandFile` the `spec.new__<ts>.md` filename for that case.
   Ships with `test/specNewStaging.test.js` covering the interpolation, the
   absent tokens and filename uniqueness. *(C3, C5, S4, S5)*
2. **Rewrite the `spec.new` template for a folder that does not exist yet.**
   Replace "Spec folder (already exists)" and "Frame creates this file for
   you here" with: derive a kebab-case slug from the description, verify it
   against the catalog and disambiguate on collision, create
   `.frame/specs/<slug>/`, then write `status.json` in the documented required
   shape and `spec.md` in the existing five-section format. Update the
   placeholder table in `frameTemplates.js` to match. *(G2, C1, C2, C4, S3, S7)*
3. **Modal becomes a launcher.** `showNewSpecPrompt` collapses to one
   textarea; Create stages the prompt via step 1 and calls a new
   `agentDispatch.dispatchSpecNew(text)` that always opens a new lane, renames
   it "Spec Creator" via `terminalManager.renameTerminal`, and injects. CSS
   follows. No spec folder is created anywhere in this path. *(G1, G3, C2, C6,
   S1, S2)*
4. **Bind the lane once the spec appears.** `agentDispatch` subscribes to
   `SPEC_DATA`, diffs slugs against the previous push, and on a single new
   slug — when exactly one live lane is labelled Spec Creator — sets
   `specLanes` and replaces the label with the standard `spec: <slug>`
   assignment. *(business decisions B1/B2)*
5. **Remove the bypass.** Delete `createSpec`, `uniqueSlug`, `generateSlug`
   and its export, the `CREATE_SPEC` channel and handler, and
   `deriveSlugPreview`. Move `spec_created` onto the watcher's
   "`spec.md` newly exists" diff, seeding the opening snapshot from the slugs
   that already have one — correcting the current fire-before-write ordering
   rather than porting it. Leave
   the `draft` phase and its "Write the Spec" action
   (`specNextAction.js:43`) untouched — with the modal no longer producing
   drafts, it becomes the recovery path for specs created outside Frame.
   *(C7, C8, S1, S6)*
6. **Attribute the event.** Add `origin: ['button', 'agent', 'conductor']` to
   `spec_created` in the registry, update the `PRIVACY.md` event table in the
   same change, and tag the watcher's fire from the marker step 4 already
   maintains — `conductor` from Frame's orchestration state, `agent` as the
   fallback, no property when nothing can be established. Ships with the
   `test/telemetry.test.js` cases for the new enum. *(C9, S8, S9)*
