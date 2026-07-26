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

## T06 — Watchers, phase reconciliation and index refresh

Instrumented all six watchers plus the two consequences nobody sees:
`reconcilePhase` now records slug + from → to (the path that once walked 18
specs backwards from `done` off a conflicted tasks.json), and
`scheduleIndexRefresh` distinguishes a real rebuild from `ensureFresh`'s
no-op by comparing the index mtime across the call. Every watcher reports at
debounce-flush time with the raw fire count in `collapsed`, and each
self-write guard records the suppression instead of returning silently.

Deviation from plan.md: `gitStatusManager`'s two watchers share one debounce,
so rather than invent per-watcher timers the burst is attributed to whichever
fired more in the window; `scheduleRefresh` took a watcher argument to make
that possible.

_Captured: 2026-07-26 · 4 file change(s)_

---

## T07 — Recovery and poll suppression

`fsSafe.readJsonWithRecovery` now records both halves of its silent
self-healing — the corrupt copy being preserved and the `.bak` restore (or
the failure to find one) — with the path reduced to a basename so no home
directory lands in the record. `pollGate` records a suppression each time a
gate pauses on a hidden window, which finally puts evidence behind the
"hidden window means zero timer wakeups" claim; identical pauses collapse
into one row carrying the count.

Deviation from plan.md: `pollGate` does not know which caller owns each
gate, and teaching it would mean editing four modules outside this spec's
footprint, so `poller` stays optional and the label falls back to a generic
sentence. Two tests added to `test/fsSafe.test.js` — which the plan's Files
and Footprint sections omitted, so those lists are one path short.

_Captured: 2026-07-26 · 4 file change(s)_

---

## T08 — The pre-commit host appears in the record

`update-structure.js` and `check-freshness.js` now append a `script.ran`
record at each of their exit paths, so a git commit — a process Frame never
sees — leaves a trace. The host is read from `GIT_INDEX_FILE`, which git
sets for hook processes, so a developer running either script by hand is
recorded as `cli` instead. Both requires are guarded and both writes are
wrapped: a commit must never fail over bookkeeping.

_Captured: 2026-07-26 · 2 file change(s)_

---

## T09 — IPC and the panel

Added `GET_ACTIVITY` / `ACTIVITY_DATA`, the coalesced 200ms push and the
foreign-append watcher in `src/main/activityLog.js`, and
`src/renderer/activityPanel.js` with its markup. The watcher is guarded by
the self-write stamp — we append to the file we watch, so without it every
one of our own records would return as a foreign one. Records written from
`.frame/bin/` are built by hand out there, so the registry validates them on
the way in rather than on the way out. The backlog is read from disk, not
the ring, so events written while the app was closed are there on open.
`setProject` re-points the watcher so the panel follows the active project.

Deviation from plan.md: `components/activity.css` was created here rather
than in T10 — the panel is unreadable without it — and T10 extends the same
file for the rail.

_Captured: 2026-07-26 · 6 file change(s)_

---
