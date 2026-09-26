# Plan — STR-02 — Structure Lifecycle

## Architecture

### Resolved plan-time decisions

- **D1 · Sequence (business, carried from the series; re-verified 2026-09-26).** STR-01 is implemented and merged (#161). This plan builds on its real interfaces: `structure-discovery.discover()`/`evaluatePaths()`, `structure-generation.buildFull()`/`buildDelta()`/`serializeStructure()`/`checkView()`, `structure-state.runAttempt()`/`reconcileAttempt()`/`snapshot()`, runtime records under `.frame/runtime/structure/`, and `structureBootstrap.stageParserScripts()`. The previous revision of this plan (2026-09-25) treated them as absent prerequisites; it is replaced, not amended.
- **D2 · Split (business, asked 2026-09-26: "Böl").** This spec is the working-tree lifecycle and the read/freshness contract. Generating and publishing the commit's map from Git's index (staged-snapshot generation, index compare-and-publish, hook upgrades, hook-path resolution) moves to a follow-up spec, to be created with `spec.new` after this plan. Until it lands, the pre-commit hook keeps STR-01 behavior (`--changed`, then `git add` of the owned map); the documented limitation is that a commit's map describes the working tree. Spec items owned by the follow-up: S3, the commit-integration half of S7, and the staged/unstaged half of S8.
- **D3 · Refresh availability (business, carried).** Maintenance starts after a successful Frame initialization/open. A shipped foreground `--watch` command covers use with Frame closed; no hidden system daemon. Closed or suspended maintenance cannot promise freshness: readers expose the last observation and its expiring lease. Reopen/resume reconciles before claiming fresh.
- **D4 · Scheduling (technical, carried).** One coordinator per canonical checkout, one writer per view, coalesced events, work in a child process. Notifications are hints, never proof that nothing changed. The main process stays responsive and periodic work uses the existing `pollGate` visibility gate.
- **D5 · Revision identity (technical, silent — revised).** `revision` is the SHA-256 of STR-01's canonical `checkView` payload, stored as `generation.revision` (the audit block `checkView` excludes, so there is no self-reference). Input identities — per-file content hashes, policy/config and curation digests — live in the runtime receipt, not in the tracked map; putting them in the map would rewrite a committed file on every edit that changes no fact. A no-change reconciliation renews the runtime lease and never rewrites the map or its revision.
- **D6 · Incremental strategy (technical, silent — replaces candidate-path deltas).** A settled burst runs a full STR-01 discovery walk with stat-gated hashing (unchanged `size/mtime/ctime/ino` reuses the recorded hash) and content-keyed cached extraction; the periodic reconciliation hashes every eligible file. Every worker publication is therefore a full build with `inventory.coverage` from discovery — incremental and full results converge by construction (S6) and no second eligibility path exists. STR-01's `buildDelta` stays for `--changed`/explicit files only. If the 10,000-file measurement misses the documented bound, candidate-path deltas become a follow-up rather than a silent scope change.
- **D7 · No new source interface (technical, silent — from drift).** STR-01 discovery and extraction already read through an injected `fs`; the working-tree view uses the real filesystem. An index-backed adapter belongs to the follow-up spec.
- **D8 · `--changed` unchanged (technical, silent).** It remains the hook's contract (staged + unstaged names, no untracked). Untracked files and new roots reach the map through lifecycle reconciliation, not by repurposing `--changed` — which would feed untracked content into commits until the follow-up spec lands.
- **D9 · Storage seam (technical, silent).** `frameStore.getStructure`/`resolvePath` stay the app's seam and are not rerouted through a script. `structure-read.js` mirrors the same ownership rule for scripts; STR-01's parity tests keep them equal.
- **D10 · Overturned STR-01 decisions (explicit).** (a) STR-01 D17/A6 "ordinary open never scans, no watcher": an open now asks the supervisor to reconcile after tools are refreshed. `openProjectLayout` itself still performs no scan and the blocked-layout guard still writes nothing; the `frameProjectOpen` test "an open refreshes tools only" is rewritten to assert exactly that. (b) STR-01 D13/T06 reader mirrors: `find-module`, `check-freshness` and `module-hint` import `structure-read.js` (built-ins only) instead of carrying copies. `module-hint`'s allowed sibling imports grow by `./structure-read`; its bans on builder/state code and `child_process` stay, and the pinning test is updated accordingly.
- **D11 · Test posture (technical, carried from the user's answer).** Everything testable: pure scheduler tests with an injected clock, real temporary repositories/worktrees, child-process execution, fault injection, and lifecycle integration through existing stubs. No DOM harness, paid calls or dependency installation.
- **D12 · Collisions (technical, verified 2026-09-26).** `audit-q3-performance-resources` has only T10 (a measurement pass, no code) open, so its footprint on `index.js`/`frameProject.js`/`structureBootstrap.js` is not a live collision. `audit-q3-cross-platform` is `planned` and not started; STR-03/STR-04 follow this spec. Implement sequentially and rebase if any of them starts first.

### A1. Revision and snapshot manifest

`scripts/structure-generation.js` gains two narrow additions: `generation.revision` (D5), computed at serialization so it always matches the bytes written; and an optional `extract(record)` injection in `buildFull` (default: STR-01 `extractFacts`) so callers can supply cached extraction without changing annotation merging.

Add `scripts/structure-snapshot.js`. For a discovery result it builds a manifest `{ path → { size, mtimeMs, ctimeMs, ino, sha256 } }`: stat-equal entries reuse the recorded hash unless a full-hash pass is requested; others are streamed through SHA-256 within STR-01's `maxParseBytes`/time limits. Working-tree enumeration is not atomic, so each run re-stats every hashed file after hashing and compares against the pre-read stat; a changed file marks the observation mixed, keeps the dirty epoch, and schedules one bounded retry. A mixed or incomplete observation is never published as fresh.

It also provides the content-keyed extraction cache: `.frame/runtime/structure/extract/<sha256>.json` holding `{ facts, extraction }`, bounded to 128 MiB with least-recently-used eviction by access time. Losing it costs recomputation only. The manifest is stored at `.frame/runtime/structure/manifest.json`.

`scripts/structure-state.js` gains a `precondition()` option on `runAttempt`, evaluated under the writer lock immediately before publication: a job whose epoch is no longer current, or whose captured inputs changed, aborts with `reason: 'superseded'` and publishes nothing (S5).

### A2. The lifecycle worker

Add `scripts/structure-lifecycle.js`: a library plus foreground commands `node .frame/bin/structure-lifecycle.js --once --json` and `--watch`, and a `--supervised` mode for the app. No search hook invokes it.

Runtime state `.frame/runtime/structure/lifecycle.json`: checkout identity (resolved real path), owner token and lease heartbeat, requested/applied epoch, dirty reasons, last receipt `{ view: 'working-tree', revision, artifactDigest, artifactStat, sourceDigest, policyDigest, curationDigest, observedAt, coverage, extraction }`. A checkout owner lease prevents the app worker and a foreground watcher from coordinating the same checkout twice; STR-01's writer lock stays authoritative for publication. A stale owner is reclaimed by the same demonstrably-gone rule STR-01 uses for locks.

Notifications: `fs.watch` with `recursive: true` where the running Node supports it, otherwise per-directory watchers capped at 2,048 directories (beyond the cap, periodic reconciliation carries correctness). Directory creation/move, null filenames, overflow, watcher errors, any `.gitignore`, `.frame/config.json`, `.frame/bin/intent-map.json`, and Git control-state changes (`HEAD`, refs, index — resolved by reading `.git`/`gitdir:` files, with no Git process) schedule a full-hash reconciliation. Writes to the owned map, runtime and tool directories are ignored to prevent loops. Project code is never executed.

Scheduling (pure, clock-injected module inside the worker): ordinary events coalesce for 300 ms and flush by 2 s during continuous bursts; jobs are serialized; events during a run produce exactly one follow-up epoch. A full-hash reconciliation runs on first attach, every 60 s while active, after resume/reopen, after watcher failure and after control-state changes. Published results go through `runAttempt` with the epoch precondition.

Bounds, documented and reported: an observed settled edit starts processing within 2 s and completes within the configured scan budget (default 30 s); missed events converge within 60 s plus that budget while active. The reader lease is 60 s plus the scan budget; recorded dirty input invalidates it immediately. Timeouts, repeated mixed observations or paused maintenance report a missed bound instead of success. Filesystem maintenance needs no Git.

In `--supervised` mode the child has no timer of its own: the supervisor sends reconciliation ticks and pause/resume over IPC. The foreground `--watch` owns its timer until stopped.

### A3. The read contract

Add `scripts/structure-read.js` (Node built-ins only, never writes, never spawns):

- `readStructure(root)` → `{ map, path, view, revision, coverage, extraction, freshness, observedAt, reasons }`.
- `readDescriptor(root)` → the same status without parsing the map: lifecycle receipt plus the current artifact `lstat` signature.
- `freshness` is `fresh | dirty | stale | unknown`: **unknown** without a lifecycle receipt (clone, Frame closed, legacy map) or when the artifact's signature/digest differs from the receipt (changed by checkout or by hand); **dirty** with a pending epoch or recorded dirty reasons; **stale** when the lease expired or coverage is not complete; **fresh** only with a working-tree receipt, matching signature, no pending epoch, complete coverage and an unexpired lease. Never inferred from `lastUpdated`.
- Ownership resolution is the STR-01 rule (overlay first; root only when `config.files` names it).

STR-03 consumes `readDescriptor` to invalidate compiled indexes cheaply.

### A4. App supervisor and integration

Add `src/main/structureLifecycle.js`: `attach(projectPath)`, `detach(projectPath)`, `requestReconcile(projectPath)`, `disposeAll()`. It spawns one `--supervised` child per attached checkout (deduplicated by real path), sends ticks through `pollGate.gatedInterval` (60 s; paused while every window is hidden, with a reconcile on show), forwards results to the activity log, and never blocks the main process. Children are stopped on `detach`, workspace removal (`REMOVE_PROJECT_FROM_WORKSPACE`), Remove Frame (before files are deleted), and app shutdown (`before-quit`, after the existing live-agent confirmation).

Attach points in `frameProject.js`: after `runProjectInit`'s bootstrap has finished (the initial scan's accepted result seeds the first observation; the two never run concurrently), and after `openProjectLayout` returns a non-blocked layout with tools refreshed. A blocked layout attaches nothing and writes nothing. Re-init keeps STR-01's preservation rules. `src/main/index.js` wires `disposeAll` into shutdown.

Delivery: `structure-snapshot.js` and `structure-read.js` join the helper set and `structure-lifecycle.js` the entry set in `structureBootstrap`; the lifecycle entry is activated only when every helper it requires staged successfully, like `update-structure.js`. All three join `build.files` (the existing packaging test enforces it). Generated REFERENCE guidance gains freshness meanings, the `--watch`/`--once` commands and the commit-map limitation of D2; existing user documents are not rewritten.

### A5. Consumers and activity

`find-module` prints view and freshness when a receipt exists and falls back to its existing date/`--check` banner when freshness is unknown. `check-freshness` reports `structure-freshness` findings (dirty, stale, missed bound, unknown-after-receipt-mismatch) from the contract and keeps the date heuristic only for unknown; its other checks and its warn-only/`--strict` exit contract are unchanged. `module-hint` suppresses its injection while the working-tree map is known dirty and records the suppression; matching, limits, session dedup and quiet failure are unchanged. Lookup ranking is unchanged (STR-03).

`activityEvents` gains `structure.reconciled` (action: `reason`, `ms`, `changes`, `coverage`) and `structure.lifecycle` (action: `state` in attached/detached/paused/resumed/missed-bound) plus a suppression reason for `module-hint`; fields are enums and counts only, never paths or source text. `PRIVACY.md` documents them in the same change.

### Acceptance ownership

`structureSnapshots` proves same-size/same-mtime edits are caught by full hashing, mixed observations are never fresh, cache eviction bounds, and revision stability across no-op runs. `structureLifecycle` covers fake-clock debounce/max-wait, one follow-up per burst, missed events converging to the full-scan map, untracked files and new roots, renamed directories, policy/config/curation changes adding and removing entries while curation survives, branch switches, overlapping jobs (`superseded`), crashed workers, lease expiry, pause/resume, owner-lease exclusion, and teardown; it replays 1,000 events over 100 files (at most one main job and one follow-up per settled burst, excluding scheduled reconciliations) and records scan counts and p50/p95 refresh times on a generated 10,000-file fixture. `structureRead` pins unknown/dirty/stale/fresh, signature mismatch, legacy maps and read-only behavior. Init/open tests cover attach ordering, the blocked guard, one worker per checkout and disposal; worktree tests prove each checkout's state stays isolated.

## Files

- `scripts/structure-snapshot.js` — **New** — content manifest with stat-gated hashing, mixed-observation detection, extraction cache.
- `scripts/structure-read.js` — **New** — read-only ownership, revision and freshness contract; `readDescriptor`.
- `scripts/structure-lifecycle.js` — **New** — worker: scheduler, notifications, reconciliation, owner lease, once/watch/supervised commands.
- `scripts/structure-generation.js` — **Modified** — `generation.revision` and injectable extraction in `buildFull`.
- `scripts/structure-state.js` — **Modified** — `precondition()` check under the writer lock before publication.
- `scripts/find-module.js` — **Modified** — freshness from the contract; existing banner only for unknown.
- `scripts/check-freshness.js` — **Modified** — `structure-freshness` findings; date heuristic only for unknown.
- `scripts/module-hint.js` — **Modified** — ownership via `structure-read`; suppress while dirty.
- `src/main/structureLifecycle.js` — **New** — supervisor: per-checkout child, gated ticks, activity, disposal.
- `src/main/structureBootstrap.js` — **Modified** — ship the new helpers and gated lifecycle entry.
- `src/main/frameProject.js` — **Modified** — attach after init/open, detach on Remove Frame, blocked-layout guard.
- `src/main/workspace.js` — **Modified** — detach on workspace removal.
- `src/main/index.js` — **Modified** — dispose workers on shutdown.
- `src/shared/frameTemplates.js` — **Modified** — freshness and maintenance guidance in generated REFERENCE.
- `src/shared/activityEvents.js` — **Modified** — lifecycle events and the hint suppression reason.
- `PRIVACY.md` — **Modified** — document the new local event fields.
- `package.json` — **Modified** — add the three scripts to `build.files`.
- `test/structureSnapshots.test.js` — **New** — manifest, hashing, mixed observations, cache bounds, revision stability.
- `test/structureLifecycle.test.js` — **New** — scheduler, reconciliation, convergence, leases, supervisor, measurements.
- `test/structureRead.test.js` — **New** — freshness states, signatures, legacy maps, read-only behavior.
- `test/structureGeneration.test.js` — **Modified** — revision and injected extraction.
- `test/structureState.test.js` — **Modified** — superseded publication.
- `test/structureBootstrap.test.js` — **Modified** — lifecycle asset closure and gated activation.
- `test/activityEvents.test.js` — **Modified** — lifecycle event validation and privacy-safe fields.
- `test/frameProjectInit.test.js` — **Modified** — attach after bootstrap, no concurrent scans.
- `test/frameProjectOpen.test.js` — **Modified** — reconcile request on open, blocked guard, one worker, rewritten tools-only test.
- `test/scriptsProjectRoot.test.js` — **Modified** — readers through the contract, worktree isolation.
- `test/module-hint.test.js` — **Modified** — dirty suppression, updated import pin.
- `test/projectAgnostic.test.js` — **Modified** — generated REFERENCE lifecycle guidance.

## Footprint

- scripts/structure-snapshot.js
- scripts/structure-read.js
- scripts/structure-lifecycle.js
- scripts/structure-generation.js
- scripts/structure-state.js
- scripts/find-module.js
- scripts/check-freshness.js
- scripts/module-hint.js
- src/main/structureLifecycle.js
- src/main/structureBootstrap.js
- src/main/frameProject.js
- src/main/workspace.js
- src/main/index.js
- src/shared/frameTemplates.js
- src/shared/activityEvents.js
- PRIVACY.md
- package.json
- test/structureSnapshots.test.js
- test/structureLifecycle.test.js
- test/structureRead.test.js
- test/structureGeneration.test.js
- test/structureState.test.js
- test/structureBootstrap.test.js
- test/activityEvents.test.js
- test/frameProjectInit.test.js
- test/frameProjectOpen.test.js
- test/scriptsProjectRoot.test.js
- test/module-hint.test.js
- test/projectAgnostic.test.js

## Dependencies

None. No new package or remote service. Git is not required for working-tree maintenance. Native watch behavior is feature-detected with per-directory and periodic fallbacks ([Node `fs.watch` caveats](https://nodejs.org/api/fs.html#caveats)); the app's Electron 28 ships Node 18, where recursive watching is unavailable on Linux.

## Sequencing

1. **Revision and read contract.** Add `generation.revision` and injectable extraction to `structure-generation.js`; add `structure-read.js` with `readStructure`/`readDescriptor` and the freshness rules. Author `structureRead` and extend `structureGeneration` tests.
2. **Snapshot manifest and safe publication.** Add `structure-snapshot.js` (stat-gated hashing, mixed-observation detection, extraction cache with LRU bound) and the `precondition()` check in `structure-state.js`. Author `structureSnapshots` and extend `structureState` tests.
3. **Lifecycle worker.** Add `structure-lifecycle.js`: clock-injected scheduler, notifications with fallback, reconciliation triggers, owner lease, `lifecycle.json` receipts, `--once`/`--watch`/`--supervised`. Author `structureLifecycle` worker tests including convergence, burst counts and the 10,000-file measurements.
4. **Delivery.** Stage the new helpers and the gated lifecycle entry in `structureBootstrap`, add them to `build.files`, and add freshness/maintenance guidance to the generated REFERENCE. Extend `structureBootstrap` and `projectAgnostic` tests.
5. **App supervisor.** Add `src/main/structureLifecycle.js` and wire attach/detach in `frameProject.js` (init, open, Remove Frame), `workspace.js` (removal) and `index.js` (shutdown), with `pollGate` ticks. Extend `structureLifecycle`, `frameProjectInit` and `frameProjectOpen` tests for ordering, the blocked guard, one worker per checkout and disposal.
6. **Readers on the contract.** Move `find-module`, `check-freshness` and `module-hint` to `structure-read`, add freshness findings and dirty suppression. Extend `scriptsProjectRoot` and `module-hint` tests, including the updated import pin and worktree isolation.
7. **Activity and privacy.** Register the lifecycle events and suppression reason in `activityEvents`, record them from the supervisor and `module-hint`, and document them in `PRIVACY.md`. Extend `activityEvents` tests.
