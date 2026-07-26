# Outcome — Activity Monitor

## T01 — Extract redact() into scripts/redact.js

Moved `redact()`/`redactValue()` out of `src/main/logger.js` into a new
dependency-free `scripts/redact.js`, which `logger.js` now requires and
re-exports so its public API is untouched. The extraction exists because
`.frame/bin/` scripts run in their own processes and cannot reach
`src/main/`; a second copy of a security-relevant regex set would drift.
Redaction coverage in `test/logger.test.js` now exercises the new home and
adds a re-export assertion pinning `logger`'s exported key set.

_Captured: 2026-07-26 · 3 file change(s)_

---

## T02 — The append contract

Added `scripts/activity-log.js`: `projectKey` (sha1 of the absolute path
behind a readable basename prefix), a pure `buildLine` that redacts, drops
nested values and bounds the line under the 4 KB atomic-append threshold,
`appendSync` for the short-lived out-of-process hosts and an async `append`
for the main process, 2 MB single-generation rotation, 7-day `prune`, and
`readRecent` reaching into the archive. Registered in `PARSER_FILES` and
`build.files` in the same task rather than as a trailing chore — that
whitelist has fallen behind twice and a miss crashes the packaged app at
require time. `FRAME_ACTIVITY_HOME` redirects the root so tests never touch
the real record.

_Captured: 2026-07-26 · 4 file change(s)_

---
