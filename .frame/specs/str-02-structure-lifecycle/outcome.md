# Outcome — STR-02 — Structure Lifecycle

## T01 — Add generation.revision and injectable extraction

Stamped `generation.revision` (SHA-256 of the `checkView` payload) in `serializeStructure`, so it always matches the written bytes, excludes itself and audit-only counts, and stays constant across no-op rebuilds; exported `revisionOf`. Added an optional `extract(record, { rootDir, fs, maxParseBytes })` to `buildFull` (default `extractFacts`) with annotation merging unchanged. The js-src-app golden gained only the revision line. Files touched: `scripts/structure-generation.js`, `test/structureGeneration.test.js`, `test/fixtures/js-src-app/STRUCTURE.json`.

_Captured: 2026-09-26 · 3 file change(s)_

---

## T02 — Add the structure-read freshness contract

Added `scripts/structure-read.js` (built-ins only, never writes or spawns) with `readDescriptor` (receipt plus artifact `lstat` signature, no parse) and `readStructure` (adds the map and a SHA-256 digest check), the STR-01 ownership rule, and freshness fresh/dirty/stale/unknown from `lifecycle.json`. The module header now defines the `lifecycle.json` receipt shape the T06 worker must write, including `leaseMs` (default 90 s = 60 s reconciliation + 30 s budget) and `coverage`/`extraction` as coverage strings. Files touched: `scripts/structure-read.js` (new), `test/structureRead.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T03 — Add the snapshot manifest and extraction cache

Added `scripts/structure-snapshot.js`: `observe()` builds the `manifest.json` identity map with stat-gated hash reuse (full-hash pass on request), streamed SHA-256, pre/post stat checks that report `mixed` paths (changed or vanished while observed), `changed`/`removed` lists and a `sourceDigest`; `createExtractionCache()` provides buildFull's `extract` with an LRU size-bounded store under `runtime/structure/extract/`. Beyond the plan: cache keys also include the extractor sources' digest and the parse limit (a Frame upgrade never reuses stale facts), cached entries are written only when the bytes actually parsed hash to the manifest value (an edit between hashing and parsing lands in `mixed` instead), files above `maxParseBytes` are identified by stat rather than hashed, and no-extractor files and transient read errors are never cached. Files touched: `scripts/structure-snapshot.js` (new), `test/structureSnapshots.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T04 — Add the superseded-job precondition

Added an optional `precondition()` to `runAttempt` in `scripts/structure-state.js`, evaluated once under the writer lock after the candidate validates and before any recovery archive, identical-bytes shortcut or publication; `false` ends the attempt with the new state `superseded` (artifact retained, nothing archived), and a throwing precondition fails as `precondition-error` without writing. A distinct `superseded` state (rather than `failed`) keeps an ordinary race from being reported as a failed scan. Files touched: `scripts/structure-state.js`, `test/structureState.test.js`.

_Captured: 2026-09-26 · 2 file change(s)_

---

## T05 — Add the clock-injected lifecycle scheduler

Added `createScheduler` in `scripts/structure-lifecycle.js`: 300 ms coalescing with a 2 s max wait, serialized jobs with exactly one follow-up for events during a run, coalesced full-hash requests (structural signals, attach/periodic/resume), bounded retries for mixed observations and a busy writer, missed-bound reports for failures, timeouts and over-budget jobs, pause/resume and `idle`/`dispose`. Interpretation of plan A2: a job's consistent result is published even when newer events arrived (the pending epoch keeps readers from calling it fresh) — superseding every job with newer events would publish nothing during continuous editing; only a job older than the applied epoch is superseded. Fake-clock tests include the 1,000-events-over-100-files replay (one job). Files touched: `scripts/structure-lifecycle.js` (new), `test/structureLifecycle.test.js` (new).

_Captured: 2026-09-26 · 2 file change(s)_

---

## T06 — Complete the lifecycle worker and commands

Added the worker to `scripts/structure-lifecycle.js`: `reconcile()` (discover, stat-gated or full-hash observe, cached-extraction `buildFull`, publish through `runAttempt` with a mixed-bytes precondition, then the `lifecycle.json` receipt), the checkout owner lease on STR-01's lock primitive (`lifecycle.owner`), notification classification that ignores Frame's own writes, Git control state read from `.git`/`gitdir:` files, `startWorker`, and `--once --json`/`--watch`/`--supervised` (JSON lines on stdin/stdout). Deviations: the Git `index` is not a trigger (`git status` rewrites it constantly and staging changes no file); native recursive watching is used only on macOS/Windows because Node's Linux implementation watches every subdirectory itself, so Linux uses the bounded per-directory mode; `.frame/` and `.frame/bin/` are watched explicitly in that mode. Fixed a scheduler ordering bug found here (the job report fired before the epoch was applied, so the worker overwrote a clean receipt with `dirty`). Measured on 10,000 files (macOS, this machine): cold 2.9 s, single-edit refresh p50 ≈ 0.85 s / p95 ≈ 0.9 s, full-hash reconciliation ≈ 1.1 s with 10,000 cache hits. Files touched: `scripts/structure-lifecycle.js`, `test/structureLifecycle.test.js`.

_Captured: 2026-09-26 · 2 file change(s)_

---

## T07 — Ship the lifecycle closure and document freshness

`structureBootstrap` now ships `structure-snapshot.js` and `structure-read.js` as helpers and `structure-lifecycle.js` as an entry; activation gating moved from a single `update-structure.js` check to a per-entry `ENTRY_REQUIRES` table (new `LIFECYCLE_REQUIRES` export), so a missing lifecycle helper withholds only the lifecycle entry while a missing parser helper withholds both. The three scripts joined `build.files`, and the packaged-tree test now also runs `structure-lifecycle.js --once` without `node_modules`. The generated REFERENCE gained a "Staying Current" subsection (background worker, `--watch`/`--once`, the four freshness states, the commit-map limitation of D2), phrased so docsHealth still names only `.frame/config.json`. Files touched: `src/main/structureBootstrap.js`, `package.json`, `src/shared/frameTemplates.js`, `test/structureBootstrap.test.js`, `test/projectAgnostic.test.js`.

_Captured: 2026-09-26 · 5 file change(s)_

---

## T08 — Add the app supervisor and shutdown wiring

Added `src/main/structureLifecycle.js` (`attach`, `detach`, `requestReconcile`, `disposeAll`, `list`, `configure`): one `--supervised` child per checkout keyed by real path, JSON-line reports forwarded to an `onReport` hook, one shared periodic ticker (pollGate's gated interval, lazily loaded so the module stays usable without Electron), SIGKILL after a 3 s stop grace, restart of an exited worker on the next reconcile request, and acceptance of a foreground watcher's ownership (`busy` → foreign owner). `index.js` disposes all workers on `will-quit`, which fires only after the existing live-agent quit confirmation. Deviations: children run on the app's own runtime (`process.execPath` + `ELECTRON_RUN_AS_NODE`) instead of `node` from PATH, so no system Node is needed; ticks gate only periodic reconciliation — change handling keeps running while windows are hidden, since agents edit then too. Files touched: `src/main/structureLifecycle.js` (new), `src/main/index.js`, `test/structureLifecycle.test.js`.

_Captured: 2026-09-26 · 3 file change(s)_

---
