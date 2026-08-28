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
