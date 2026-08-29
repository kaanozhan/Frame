## T01 — Slug-less `spec.new` staging in the main process

Gave `getCommandPrompt` / `buildSpecCommandFile` a `description` parameter and a
slug-less branch for `spec.new`: the `readStatus` guard is skipped, the caller's
text replaces the hardcoded `description: ''`, `{spec_catalog}` still embeds, and
`{slug}`/`{title}` are omitted from the interpolation set rather than blanked.
Prompt files on that path are `spec.new__<ts>.md`, disambiguated on collision, so
each run's text survives as its own recovery surface. Beyond the plan: `readStatus`
threw a TypeError on a null slug, so the guard now short-circuits and returns the
plain `spec not found` — files: `src/main/specManager.js`, `test/specNewStaging.test.js` (new).

_Captured: 2026-08-29 · 2 file change(s)_

---
## T02 — `spec.new` authors the folder it used to be handed

Rewrote `src/templates/commands/claude-code/spec.new.md` for a folder that does
not exist yet: derive the title and slug, disambiguate against the embedded
catalog, create `.frame/specs/<slug>/` and write both `status.json` (phase
`"specified"`, never `draft`) and `spec.md`; the `{slug}`/`{title}` tokens are
gone. Aligned the placeholder table and the resolve-the-spec step in
`src/shared/frameTemplates.js`. Beyond the plan: bumped `SPEC_SECTION_VERSION`
2 → 3, without which projects stamped at 2 keep the contradicted table.
`spec-status-repair`'s required-shape block is preserved and restated as
written-from-scratch rather than field-editing.

_Captured: 2026-08-29 · 2 file change(s)_

---
## T03 — The modal becomes a launcher

Collapsed `showNewSpecPrompt` to a single textarea whose Create calls the new
`agentDispatch.dispatchSpecNew(text)`: it stages the slug-less `spec.new` prompt,
creates a lane, renames it "Spec Creator" and injects — writing no spec folder
anywhere. The lane is created directly rather than via `dispatch({createNew:true})`
so the name lands before the CLI cold start, since T04 binds the new slug by that
label. Divergence from plan.md: `panels.css` is untouched — the title-field and
dual-label classes it expected to become dead are still used by the rename modal
in the same file. Files: `src/renderer/specPanel.js`, `src/renderer/agentDispatch.js`.

_Captured: 2026-08-29 · 2 file change(s)_

---
## T04 — The lane binds itself once the spec appears

Subscribed `agentDispatch` to `SPEC_DATA` and diffed the slugs against the
previous push; on a single new slug with a single waiting Spec Creator lane it
sets `specLanes`, restores the lane's default name and applies the standard
`spec: <slug>` assignment. Waiting lanes come from a launch-time marker map
(`specCreatorLanes`) rather than a name search, so a hand-named lane can never be
bound; the name is still checked, since a user rename means the lane was
repurposed. The snapshot is keyed by project so switching projects reseeds rather
than binding. File: `src/renderer/agentDispatch.js`.

_Captured: 2026-08-29 · 1 file change(s)_

---
## T05 — `spec_created` moves onto the watcher

Dropped the `telemetry.track('spec_created')` call from `createSpec` and added
`trackNewlyAuthoredSpecs` to `pushSpecData`: it diffs the slugs whose `spec.md`
exists against the previous push and fires once per newly authored one, seeding
from disk on the first push and resetting in `stopWatching` so a project switch
reseeds. Keyed on `spec.md`, not the folder — which corrects the old
fire-before-write ordering that counted every empty-description creation as a
spec with no `spec.md` at all. The check runs before the skip-unchanged gate.
File: `src/main/specManager.js`.

_Captured: 2026-08-29 · 1 file change(s)_

---
