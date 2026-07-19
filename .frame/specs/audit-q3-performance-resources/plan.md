# Plan — Performance & resource usage

## Architecture

### Resolved plan-time decisions

- **Reload PTY policy (business, asked)** — Destroy-and-recreate: on main-frame
  navigation start (which covers menu Reload), destroy all PTYs exactly as
  window close does today. Rationale: simplest, leak-free, matches existing
  close semantics; persist-and-re-attach would need a re-attach handshake and
  scrollback replay protocol — too much risk inside a perf-only spec.
- **Incremental IPC protocol (technical, asked)** — Parse-once + skip-unchanged
  at the source. Existing `TASKS_DATA` / `SPEC_DATA` channels and payload
  shapes stay untouched; the fix is one shared parse per change, content-hash
  comparison, and broadcasting only when the data actually changed. Rationale:
  zero renderer changes, zero contract risk (C2/C3); at 237 tasks the wire
  size is not the cost — the ~29 redundant parses and rewrites are.
- **Profiling approach (technical, asked)** — Lightweight in-app
  instrumentation: a small `perfMonitor` module with an event-loop-lag sampler
  in main, `performance.mark` startup phases, and per-operation timers,
  dev-gated. Rationale: reproducible on every run, cheap to keep, sufficient
  to verify each success criterion with before/after numbers; a full tracing
  harness outlives this spec's needs.
- **Worker vs async (technical, silent)** — No worker_threads. The structure
  bootstrap parser already runs in a child process (`spawnSync('node',
  [parserPath])` at `structureBootstrap.js:290`); converting `spawnSync` →
  async `spawn` removes the 30s block with no new architecture. All other hot
  paths convert to `fs.promises` / promisified `child_process`.
- **Budgets (technical, silent)** — Startup time-to-interactive ≤ 1.5s cold
  (measured by perfMonitor marks); max tolerated main-thread block per
  operation 50ms; PTY coalescing flush window 16ms; prompt log cap 5MB with a
  single `.1` rotation; D3 node cap 1500 and tick budget ~300 (raised
  `alphaMin`); saved terminal sessions capped at 20 most-recent projects.
- **Focus-gating semantics (business, silent)** — When all windows are hidden,
  polls pause entirely; on show, an immediate refresh fires and the interval
  resumes. While visible, behavior is byte-identical to today (C3-safe: the
  user never sees staler data than now while looking at the app).
- **D3 vendoring (technical, silent)** — Add `d3` as an npm dependency and load
  `node_modules/d3/dist/d3.min.js` via a local script tag — the exact pattern
  `index.html:6` already uses for `node_modules/xterm/css/xterm.css`. No
  bundler changes.
- **localStorage pruning (technical, silent)** — Wire the existing dead
  `clearProjectSession` (`terminalManager.js:755`) into project removal, and
  prune saved sessions to the 20 most-recently-used projects on every
  `saveProjectSession`. Records are small, so a count cap is sufficient.

### Key components

**perfMonitor (New, `src/main/perfMonitor.js`).** Three primitives:
an event-loop-lag sampler (a 500ms `setInterval` measuring timer drift —
sustained drift > 50ms means something blocked the loop), `opStart(name)` /
`opEnd(name)` wrappers for hot operations (project init, bootstrap, push,
usage poll), and startup marks (`app-ready`, `window-created`,
`first-ipc-served`) recorded from `index.js`. Dev-gated logging through the
existing `electron-log` dependency. This ships first so every later step has
before/after numbers.

**Async conversion.** Hot-path handlers become `async` (Electron's
`ipcMain.handle` already awaits): `frameProject` init path, `structureBootstrap`
(`spawnSync` → `spawn` with the same 30s timeout, `execSync git config` →
async `exec`), `pluginsManager` clone/pull (async `spawn`, output captured),
`claudeUsageManager` Keychain read (async `exec`), and `fileTree` (recursive
`fs.promises.readdir`). Cold paths (one-shot config reads at boot) may stay
sync — the constraint is hot paths that run while windows are live.

**Data-change gate.** `tasksManager.loadTasks` gains an mtime+size-keyed cache
so repeated reads within one push parse once. `specManager.pushSpecData` is
restructured to: load tasks once → pass the shared object through
`syncAllSpecTasks` / `reconcilePhase` / `listSpecs` → hash the outgoing
`SPEC_DATA` payload and send only when the hash changed. `writeStatus` becomes
write-if-changed and stamps a specManager-local `lastSelfWriteAt`; both the
recursive specs watcher and the `tasks.json` watcher (which today has **no**
guard, `specManager.js:760`) check that stamp before scheduling a push —
breaking both feedback loops.

**PTY flow control.** In `ptyManager`, `onData` appends to a per-terminal
buffer flushed on a 16ms timer as one coalesced `TERMINAL_OUTPUT_ID` send;
if a buffer exceeds a 1MB high-water mark, `ptyProcess.pause()` until the
flush drains it (`resume()`). `pty.js` (legacy path) gets the same coalescing.
In the renderer, `laneStatus._onOutput` stops resetting a timer per chunk:
it records `lastOutputAt` and a single existing periodic check (the
`FLAVOR_CHECK_MS` cadence) compares timestamps to detect quiet — same 1800ms
semantics, zero per-chunk timer churn.

**Poll gating (New, `src/main/pollGate.js`).** A small utility in the spirit
of `fsSafe.js`: `gatedInterval(fn, ms)` wires `browser-window` `hide`/`show`
(and `isVisible()` at start) to pause/resume an interval with an immediate
run on show, plus `ttlCache(fn, ttlMs)` for the usage/Keychain result.
Consumers: `claudeUsageManager` (5min poll + TTL cache), `updateChecker`
(6h recheck), `orchestrationManager` (5s status poll), and `ptyManager`'s
per-PTY 2500ms `processPoll`.

**Lifecycle & bounds.** `index.js` hooks
`webContents.on('did-start-navigation')` (main-frame, not same-document) to
call `ptyManager.destroyAll()` — reload now tears PTYs down like close does;
idempotent on first load. `promptLogger` switches to async append and rotates
the log to `<name>.log.1` when it crosses 5MB (`getHistory` stays whole-file
but is now bounded by the cap). Renderer modules that register IPC/DOM
listeners in init (`laneRail`, `laneBoard`, `laneStatus`, `terminalManager`,
`appLoader`) get explicit init-once guards so a future re-init cannot stack
handlers.

**Structure map.** `index.html` loads vendored D3; `structureMap` drives the
simulation manually — `simulation.stop()`, then a `requestAnimationFrame`
loop calling `simulation.tick()` with a ~300-tick budget and raised
`alphaMin`, applying DOM writes once per frame instead of per tick. Graphs
above 1500 modules render the 1500 highest-degree nodes (cap logged, not
silent).

## Files

- **New** — `src/main/perfMonitor.js`: event-loop-lag sampler, op timers, startup marks (dev-gated).
- **New** — `src/main/pollGate.js`: visibility-gated intervals + TTL cache helper.
- **Modified** — `src/main/index.js`: perfMonitor init + startup marks; `did-start-navigation` → PTY teardown.
- **Modified** — `src/main/frameProject.js`: project-init hot path sync → async.
- **Modified** — `src/main/structureBootstrap.js`: `spawnSync` → async `spawn`; `execSync git config` → async.
- **Modified** — `src/main/pluginsManager.js`: git clone/pull → async spawn.
- **Modified** — `src/main/claudeUsageManager.js`: async Keychain read, TTL cache, gated poll.
- **Modified** — `src/main/fileTree.js`: recursive walk → `fs.promises`.
- **Modified** — `src/main/tasksManager.js`: mtime+size parse cache; shared-load API for specManager.
- **Modified** — `src/main/specManager.js`: parse-once `pushSpecData`, payload-hash skip-unchanged, write-if-changed `writeStatus`, self-write guards on both watchers.
- **Modified** — `src/main/ptyManager.js`: 16ms output coalescing + pause/resume backpressure; gated `processPoll`; teardown API used on navigation.
- **Modified** — `src/main/pty.js`: same coalescing on the legacy output path.
- **Modified** — `src/main/promptLogger.js`: async append + 5MB rotation to `.log.1`.
- **Modified** — `src/main/updateChecker.js`: recheck interval via pollGate.
- **Modified** — `src/main/orchestrationManager.js`: status poll via pollGate.
- **Modified** — `src/renderer/laneStatus.js`: timestamp-based quiet detection (no per-chunk timers); init-once guard.
- **Modified** — `src/renderer/terminalManager.js`: session pruning (cap 20, wire `clearProjectSession`); init-once guard.
- **Modified** — `src/renderer/structureMap.js`: rAF-driven manual tick loop, tick budget, node cap.
- **Modified** — `src/renderer/laneRail.js`: init-once listener guard.
- **Modified** — `src/renderer/laneBoard.js`: init-once listener guard.
- **Modified** — `src/renderer/appLoader.js`: init-once listener guard.
- **Modified** — `index.html`: replace D3 CDN script with `node_modules/d3/dist/d3.min.js`.
- **Modified** — `package.json`: add `d3` dependency.

## Footprint

- src/main/perfMonitor.js
- src/main/pollGate.js
- src/main/index.js
- src/main/frameProject.js
- src/main/structureBootstrap.js
- src/main/pluginsManager.js
- src/main/claudeUsageManager.js
- src/main/fileTree.js
- src/main/tasksManager.js
- src/main/specManager.js
- src/main/ptyManager.js
- src/main/pty.js
- src/main/promptLogger.js
- src/main/updateChecker.js
- src/main/orchestrationManager.js
- src/renderer/laneStatus.js
- src/renderer/terminalManager.js
- src/renderer/structureMap.js
- src/renderer/laneRail.js
- src/renderer/laneBoard.js
- src/renderer/appLoader.js
- index.html
- package.json

## Dependencies

- `d3` — vendor the force-graph library locally so the structure map works
  offline; replaces the `https://d3js.org/d3.v7.min.js` CDN script tag.

## Sequencing

1. **Instrumentation baseline** — Add `src/main/perfMonitor.js` (event-loop-lag
   sampler, op timers, startup marks), wire marks into `index.js`, and record
   baseline numbers for startup TTI, bootstrap block time, push cost, and
   hidden-window CPU. Budgets from the Architecture section become the pass
   bar for later steps.
2. **Async structure bootstrap** — `structureBootstrap.js`: `spawnSync` →
   async `spawn` (same 30s timeout), `execSync git config` → async; make the
   `frameProject.js` init path (`bootstrapStructure` caller at `:338` and the
   surrounding sync fs cluster) async end-to-end. Verifies: the 30s scan no
   longer blocks the event loop.
3. **Async remaining hot paths** — `pluginsManager.js` clone/pull → async
   spawn; `fileTree.js` → `fs.promises` recursion; `claudeUsageManager.js`
   Keychain `execSync` → async `exec`. Completes the no-sync-on-hot-paths
   criterion.
4. **Parse-once + skip-unchanged + self-write guards** — `tasksManager.js`
   mtime+size parse cache and shared-load API; `specManager.js` restructured
   `pushSpecData` (single tasks load, payload hash, send-on-change),
   write-if-changed `writeStatus`, self-write guards on the recursive specs
   watcher and the `tasks.json` watcher. One file change now costs one parse.
5. **PTY flow control** — `ptyManager.js` 16ms coalescing + 1MB
   pause/resume backpressure; same coalescing in `pty.js`;
   `laneStatus.js` quiet detection switches to `lastOutputAt` timestamps
   checked on the existing periodic cadence.
6. **Reload lifecycle & listener hygiene** — `index.js`
   `did-start-navigation` hook → `ptyManager.destroyAll()`; init-once guards
   in `laneRail.js`, `laneBoard.js`, `laneStatus.js`, `terminalManager.js`,
   `appLoader.js`. Verifies: reload leaves zero orphaned PTYs or intervals.
7. **Bounded logs & sessions** — `promptLogger.js` async append + 5MB
   rotation to `.log.1`; `terminalManager.js` session cap (20 MRU) and
   `clearProjectSession` wired to project removal.
8. **Poll gating & TTL caching** — Add `src/main/pollGate.js`; migrate
   `claudeUsageManager.js` (poll + TTL cache), `updateChecker.js`,
   `orchestrationManager.js` status poll, and `ptyManager.js` `processPoll`
   to gated intervals. Verifies: hidden-window timer activity drops to zero.
9. **D3 vendoring & structure-map throttling** — Add `d3` to `package.json`,
   swap the CDN tag in `index.html` for the local script; `structureMap.js`
   rAF-driven tick loop with tick budget, raised `alphaMin`, and 1500-node
   cap with a logged notice.
10. **Measurement pass** — Re-run the step-1 measurements against the
    budgets; record before/after numbers (startup TTI, block times, parses
    per change, hidden-window activity) in the spec folder as the acceptance
    record.
