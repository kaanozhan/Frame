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

## T03 — The event registry

Added `src/shared/activityEvents.js`: ten Tier 1 events declared with their
kind (`action`/`suppression`), narrow field types (enums, counts, ms, and
the two bounded string shapes — path and slug) and a label formatter. There
is deliberately no free-form text field, so no call site can introduce one.
`validateEvent` drops unregistered events and strips out-of-enum values the
way `telemetryEvents.js` does for what leaves the machine; presence of a
label is what makes an event visible in the panel's default view. All eleven
spec-hint quiet paths have distinct reason codes, asserted to read
differently from one another.

_Captured: 2026-07-26 · 2 file change(s)_

---

## T04 — The main-process wrapper

Added `src/main/activityLog.js` (ring buffer of 2000, per-event rate cap,
suppression burst aggregation, self-write stamp, project/app bucket
switching) and wired `init()` into `src/main/index.js` after logger and
perfMonitor — the ordering `audit-q3-reliability-recovery` T07 established —
plus `setProject` on the project-switch callback and in `frameProject.js`
so init's own work lands in the right bucket.

Deviation from plan.md: this task also amended `src/shared/activityEvents.js`
(T03's file). A smoke run showed aggregated bursts reporting as a single
fire, because suppressions declared no counter field, and reusing
`collapsed` would have conflated two different facts — a debounce folding N
filesystem events versus the layer aggregating N identical records. Added a
distinct `repeats` field to every suppression, suffixed centrally in
`formatLabel`, with two tests.

_Captured: 2026-07-26 · 5 file change(s)_

---

## T05 — spec-hint records every decision

Instrumented all eleven quiet returns in `scripts/spec-hint.js` with
distinct reason codes plus both injection points, behind a guarded
`require('./activity-log')` so a `.frame/bin/` generation that predates the
helper degrades to exactly today's behavior. Verified live against this
repo: four hook invocations that were previously indistinguishable now read
as inject / session-dedup / meta-path / no-match.

Deviation from plan.md: records written from `.frame/bin/` cannot pass
through `src/shared/activityEvents.js` (out-of-process scripts cannot reach
`src/`), so the script builds registry-shaped records by hand and validation
moves to the read side, which T09 owns. Six tests added, including that a
blocked record path leaves the injection payload and exit code untouched.

_Captured: 2026-07-26 · 2 file change(s)_

---
