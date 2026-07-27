# Plan — Activity Monitor — record and surface the work Frame does on its own

## Architecture

### Resolved plan-time decisions

**Business gate**

- **Retention — size rotation *and* a time sweep.** `activity.jsonl` rotates at
  2 MB to `activity.jsonl.1` (one generation), and files older than 7 days are
  swept. Rationale: rotation alone leaves months-old noise in a quiet project; a
  time window alone leaves disk unbounded on a busy day. 7 days reuses
  `spec-hint.js`'s existing `STATE_TTL_MS` (`scripts/spec-hint.js:37`) rather
  than introducing a second retention constant.
- **Suppressions are visible but muted.** Guard events render in the default
  (labelled) view with a dimmed treatment rather than hiding behind the detail
  toggle. Rationale: the suppressions *are* the evidence that guards work —
  without them the default view cannot distinguish "alive and nothing needed"
  from "dead".
- **The rail is present in every view mode, at the app's outer edge.**
  `#terminal-container` hosts three modes (`board`, `detail`, terminal —
  `src/renderer/multiTerminalUI.js:6`) and the board renders its own
  `.lane-rail.board-rail` *inside* that container. The activity rail sits
  outside it as the last flex child of `#main-content`, separated by the
  terminal container's card margin. Rationale: a landmark that moves or
  disappears stops being a landmark.

**Technical gate**

- **The record lives in user scope: `~/.frame/activity/<key>/`.** Decisive
  reason: Frame does not edit a project's `.gitignore`, so `.frame/runtime/`
  is *not* ignored in a user's repository — an in-repo record would dirty their
  `git status` on every watcher fire. Precedent: `promptLogger` already writes
  under `path.join(app.getPath('home'), '.frame', 'prompts')`
  (`src/main/promptLogger.js:34`). Cost accepted: the out-of-process scripts
  resolve the home directory and derive the project key themselves.
- **Test posture: pure logic and data transforms.** Matches the convention in
  `PROJECT_NOTES.md` § Testing — target the pure module, skip the
  Electron-coupled wrapper. Re-verified the record's **Not covered** line for
  `src/renderer/`: `jsdom`, `playwright`, `@testing-library/dom`, `puppeteer`,
  `vitest` and `jest` are all absent from `package.json`, so the panel and rail
  genuinely have no test path today.

**Decided silently (no user fork)**

- **Redaction is shared, not duplicated.** `redact()` currently lives in
  `src/main/logger.js` and is documented there as usable from plain node, but
  `.frame/bin/` scripts cannot reach `src/main/`. Extract it to
  `scripts/redact.js`; `logger.js` requires and re-exports it (public API
  unchanged), and `activity-log.js` requires it as a sibling. Cross-requires
  between `.frame/bin/` scripts are an established pattern
  (`scripts/spec-context.js:22` → `./spec-index`,
  `scripts/update-structure.js:92` → `./lang/*`).
- **No free-form strings in the record.** Fields are enum reason codes, counts,
  durations and project-relative paths — the same discipline
  `telemetryEvents.js` enforces for what leaves the machine, applied here to
  what lands on disk. `redact()` then runs as belt-and-braces on the app side,
  never as the only defence.
- **The panel learns about foreign appends through a self-write-stamped
  watcher.** The app appends to the same file it watches, so an unguarded
  watcher would retrigger on its own writes — the exact loop class
  `audit-q3-performance-resources` T04 solved with self-write stamps in
  `specManager.js`. Same pattern reused here.
- **Lines stay well under 4 KB** so a single `O_APPEND` write from a concurrent
  process (app + git hook + Claude hook at once) is atomic on POSIX. Windows
  offers no such guarantee; noted for `audit-q3-cross-platform`, not solved here.
- **Suppression bursts aggregate, they do not stream.** A debounce that
  collapses 12 watcher fires writes one record carrying `collapsed: 12`, not 12
  records. This is what keeps the "visible but muted" decision compatible with
  the per-source rate cap.
- **With no project open the rail and panel still work**, showing the `app`
  bucket only.

### Collision with an in-flight spec

`audit-q3-performance-resources` is `implementing` and its Footprint overlaps
**nine** files this plan touches: `pollGate.js`, `specManager.js`,
`tasksManager.js`, `orchestrationManager.js`, `structureBootstrap.js`,
`frameProject.js`, `index.js`, `index.html`, `package.json`.

All ten of its tasks have recorded outcomes; only **T10** remains, and it is a
*measurement* task, not a code task — its outcome notes it could not run because
the user's Frame instance was live. So the practical collision risk is low, but
the orchestrator's footprint guard will flag it. Sequencing answer: this plan
does not restructure any of those files — every edit is an additive
`activityLog.record(...)` call at an existing decision point. `perfMonitor.js`
is untouched. T10 should close before implementation starts; this layer's own
instrumentation is what finally makes T10's runtime claims observable.

### Data flow

```
in-app producers                      out-of-process producers
specManager · tasksManager            .frame/bin/spec-hint.js
gitStatusManager · orchestration      .frame/bin/update-structure.js
fsSafe · pollGate                     .frame/bin/check-freshness.js
        │                                       │
        │ activityLog.record(name, fields)      │ append(root, bucket, rec)
        ▼                                       │
 src/main/activityLog.js                        │
   · validate via shared/activityEvents.js      │
   · redact() belt-and-braces                   │
   · per-source rate cap + burst aggregation    │
   · in-memory ring (2000 events)               │
   · self-write stamp                           │
        │                                       │
        └───────────────┬───────────────────────┘
                        ▼
            scripts/activity-log.js
                        │
                        ▼
      ~/.frame/activity/<key>/activity.jsonl
        (+ .1 rotation at 2 MB, 7-day sweep)
                        │
        foreign-append watcher (self-write stamped)
                        │  coalesced IPC push
                        ▼
   src/renderer/activityPanel.js ◄── src/renderer/activityRail.js
```

`<key>` is derived from the **absolute** project path, never `path.basename` —
the collision `promptLogger` has today (`src/main/promptLogger.js:46`).

### Event registry

`src/shared/activityEvents.js` mirrors `telemetryEvents.js`: a literal registry
is the single source of truth for what may be recorded. Each entry declares its
`kind` (`action` | `suppression`), its allowed fields with enum values, and
whether it carries a human-readable label. Unregistered events are dropped;
out-of-enum values are stripped. Adding a source means adding a registry entry —
the mechanism that stops the drift `perfMonitor`'s eight scattered call sites
demonstrate.

Tier 1 sources: the six `fsSafe.safeWatch` watchers
(`specManager.js:1001,1020`, `tasksManager.js:320`,
`gitStatusManager.js:76,97`, `orchestrationManager.js:280`),
`reconcilePhase` (`specManager.js:296`), `scheduleIndexRefresh` /
`ensureFresh` (`specManager.js:168,172`), `readJsonWithRecovery`
(`fsSafe.js:64`), `pollGate` hidden-window skips, and `spec-hint.js`'s decision
on every invocation.

### spec-hint decision coverage

The spec said "nine silent return points in `preEdit`"; the code has **six**
(`scripts/spec-hint.js:145,148,151,152,155,160`), plus four in `promptMode`
(`187,190,216,222`) and one in `emit` (`119`) — **eleven** quiet paths in all.
Every one gets a distinct reason code, so "ran and stayed quiet" is
distinguishable from "never fired" and from each other sibling reason.

## Files

**New**

- `scripts/redact.js` — secret-redaction patterns extracted from `logger.js`, so
  the app and `.frame/bin/` share one copy.
- `scripts/activity-log.js` — the append contract: `append`, `readRecent`,
  `projectKey`, `rotate`, `prune`, `resolveDir`. Dependency-free, best-effort,
  never throws.
- `src/shared/activityEvents.js` — pure registry: event names, kinds, field
  enums, label formatters, `validateEvent`.
- `src/main/activityLog.js` — Electron wrapper: ring buffer, redaction pass,
  rate cap, burst aggregation, self-write stamp, foreign-append watcher,
  coalesced renderer push, bucket switching on project select.
- `src/renderer/activityPanel.js` — the side panel: labelled/detail toggle,
  source filter, live stream.
- `src/renderer/activityRail.js` — fixed right-edge icon rail.
- `src/renderer/styles/components/activity.css` — rail and panel styles.
- `test/activityLog.test.js` — key derivation (including the basename
  collision), rotation, prune, append-never-throws, malformed input.
- `test/activityEvents.test.js` — registry validation, enum stripping, label
  formatting, action/suppression classification.

**Modified**

- `src/main/logger.js` — `redact` moves to `scripts/redact.js`; required and
  re-exported so `module.exports` is unchanged.
- `src/main/specManager.js` — records for both watchers, `reconcilePhase` phase
  changes, index refresh, and the `ensureFresh` no-op suppression.
- `src/main/tasksManager.js` — watcher fire record.
- `src/main/gitStatusManager.js` — two watcher fire records plus the debounce
  collapse count.
- `src/main/orchestrationManager.js` — bus watcher fire record.
- `src/main/fsSafe.js` — recovery outcome record from `readJsonWithRecovery`.
- `src/main/pollGate.js` — hidden-window skip suppression record.
- `src/main/index.js` — `activityLog.init()` and IPC wiring.
- `src/main/frameProject.js` — set the active project bucket on open/init.
- `src/main/structureBootstrap.js` — `PARSER_FILES` gains `redact.js` and
  `activity-log.js`.
- `scripts/spec-hint.js` — emit a decision record on all eleven paths.
- `scripts/update-structure.js` — emit a run record (pre-commit host).
- `scripts/check-freshness.js` — emit a run record (pre-commit host).
- `src/shared/ipcChannels.js` — activity channels.
- `index.html` — rail container and panel markup.
- `src/renderer/index.js` — wire the panel and rail.
- `src/renderer/styles/main.css` — `@import 'components/activity.css'`.
- `package.json` — `build.files` gains the two new scripts.
- `test/logger.test.js` — cover `redact` through its new home.
- `test/spec-hint.test.js` — reason-code coverage plus the never-break set.
- `PRIVACY.md` — document the local record: location, contents, never
  transmitted.
- `.frame/docs/REFERENCE.md` — an "Activity Monitor" section.

## Footprint

- scripts/redact.js
- scripts/activity-log.js
- scripts/spec-hint.js
- scripts/update-structure.js
- scripts/check-freshness.js
- src/shared/activityEvents.js
- src/shared/ipcChannels.js
- src/main/activityLog.js
- src/main/logger.js
- src/main/specManager.js
- src/main/tasksManager.js
- src/main/gitStatusManager.js
- src/main/orchestrationManager.js
- src/main/fsSafe.js
- src/main/pollGate.js
- src/main/index.js
- src/main/frameProject.js
- src/main/structureBootstrap.js
- src/renderer/activityPanel.js
- src/renderer/activityRail.js
- src/renderer/index.js
- src/renderer/styles/components/activity.css
- src/renderer/styles/main.css
- index.html
- package.json
- test/activityLog.test.js
- test/activityEvents.test.js
- test/logger.test.js
- test/spec-hint.test.js
- PRIVACY.md
- .frame/docs/REFERENCE.md

## Dependencies

None. Icons come from `lucide`, already a dependency and already used by the
rail modules this one sits beside.

## Sequencing

1. **The append contract.** Extract `scripts/redact.js` from `logger.js` and
   re-export it there. Write `scripts/activity-log.js`: `projectKey` from the
   absolute path, `append` (best-effort, sub-4 KB lines, never throws),
   `readRecent`, `rotate` at 2 MB to one generation, `prune` at 7 days. Add both
   to `PARSER_FILES` in `structureBootstrap.js` and to `build.files` in
   `package.json` — the whitelist has fallen behind twice before, and a missing
   entry crashes the packaged app at require time. Ships with
   `test/activityLog.test.js` and the `redact` coverage moved into
   `test/logger.test.js`.

2. **The event registry.** Write `src/shared/activityEvents.js` with the Tier 1
   sources, their kinds, field enums and label formatters. Ships with
   `test/activityEvents.test.js`.

3. **The main-process wrapper.** Write `src/main/activityLog.js`: ring buffer,
   redaction pass, per-source rate cap, burst aggregation, self-write stamp,
   bucket switching. Wire `init()` in `index.js` and the project bucket in
   `frameProject.js`. No producers yet — this step ends with a working sink.

4. **spec-hint decisions.** Instrument all eleven paths in `scripts/spec-hint.js`
   with distinct reason codes, preserving the never-block contract exactly
   (no stdout, no non-zero exit, silent on any failure). Extends
   `test/spec-hint.test.js`. Highest-value source; first producer on purpose.

5. **Watchers, reconcile and index refresh.** Add records to `specManager.js`
   (both watchers, `reconcilePhase`, `scheduleIndexRefresh`, `ensureFresh`
   no-op), `tasksManager.js`, `gitStatusManager.js` (both watchers plus debounce
   collapse) and `orchestrationManager.js`. Additive call sites only.

6. **Recovery and poll suppression.** Record the `readJsonWithRecovery` outcome
   in `fsSafe.js` and the hidden-window skip in `pollGate.js`.

7. **Pre-commit sources.** Emit run records from `update-structure.js` and
   `check-freshness.js` so the git-hook host appears in the record even though
   Frame's process is never involved.

8. **IPC and the panel.** Add the activity channels, the coalesced push in
   `activityLog.js`, and `src/renderer/activityPanel.js` with its markup in
   `index.html`: labelled view by default with muted suppression rows, a detail
   toggle for the raw stream, and a source filter. On open the panel reads the
   file so events written while the app was closed appear.

9. **The rail.** Add `src/renderer/activityRail.js` and its container as the
   last flex child of `#main-content`, styled in
   `components/activity.css` against the existing `.lane-rail-strip-btn`
   treatment, wired in `src/renderer/index.js`. Present in every view mode,
   fixed at the outer edge, with Activity as its only item.

10. **Docs.** `PRIVACY.md` gains the record's location, its contents and the
    explicit statement that it is never transmitted; `.frame/docs/REFERENCE.md`
    gains an "Activity Monitor" section covering the registry, the reason codes
    and the retention rules.
