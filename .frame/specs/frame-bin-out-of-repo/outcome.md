# Outcome — Frame's own scripts stay out of the user's repo

## T01 — Reclassify `bin/` as runtime and reduce `FRAME_TRACKED_DERIVED` to `STRUCTURE.json`

Moved `'bin/'` from `FRAME_FILE_CLASSES.derived` to `FRAME_FILE_CLASSES.runtime`
in `src/shared/frameConstants.js` and cut `FRAME_TRACKED_DERIVED` down to
`['STRUCTURE.json']`. Placed `bin/` after `migration-backup/` so the runtime
directories stay grouped ahead of the file and glob entries. `npm test` is
transiently red here — `test/gitSharing.test.js:100` still asserts the
pre-reversal behaviour, which T03 inverts.

_Captured: 2026-08-28 · 1 file change_

---

## T02 — Record the T15 reversal in the tracked-derived comment

Rewrote the `FRAME_TRACKED_DERIVED` comment in `src/shared/frameConstants.js` so
it explains `STRUCTURE.json` on its own terms, then names T15 of
`non-invasive-overlay` as reversed with its three lapsed rationales and points at
this spec. Added a closing line that `copyParserScripts` still writes the scripts
into every checkout, since the comment's neighbourhood is where a reader would
otherwise conclude the scripts stopped shipping. Comment only; no behaviour.

_Captured: 2026-08-28 · 1 file change_

---
