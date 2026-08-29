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
