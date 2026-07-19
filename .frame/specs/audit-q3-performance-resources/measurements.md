# Acceptance record — Performance & resource usage

Static measurements taken 2026-07-19 after T01–T09 landed. Runtime numbers
(startup TTI, event-loop lag) are produced by `perfMonitor` on the next dev
launch — see "Runtime pass" below.

## Budgets (from plan.md)

| Budget | Target | Status |
| --- | --- | --- |
| Startup time-to-interactive | ≤ 1500ms cold | instrumented (`did-finish-load` mark) — needs runtime pass |
| Main-thread block per op | ≤ 50ms | instrumented (lag sampler + op timers) — needs runtime pass |
| PTY flush window | 16ms | **met** — `ptyManager.js` / `pty.js` coalescing |
| Prompt log cap | 5MB + one `.log.1` | **met** — `promptLogger.appendAndRotate` |
| D3 node cap / tick budget | 1500 nodes / 300 ticks | **met** — `structureMap.js` `NODE_CAP` / `TICK_BUDGET` |
| Saved terminal sessions | 20 MRU | **met** — `terminalManager._pruneSessions` |

## Before → after (static)

| Metric | Audit (before) | Now (after) |
| --- | --- | --- |
| `execSync`/`spawnSync` on hot paths (bootstrap, plugins, usage, fileTree) | 7 call sites, incl. one 30s `spawnSync` | **0** (grep-verified; one comment mention remains) |
| `fs.readdirSync` whole-subtree walk in fileTree | 1 (recursive, depth 5) | **0** (`fs.promises` recursion) |
| tasks.json parses per spec push | ~29 (one per spec dir + listSpecs) | **1** — verified: 3× `loadTasks` → 1 disk parse, shared object |
| status.json rewrites per push | up to 28 | 0 when content unchanged (write-if-changed) |
| specManager tasks.json watcher self-write guard | none (feedback loop) | guarded via `tasksManager.getLastSelfWriteAt()` |
| specs-root recursive watcher self-write guard | none | guarded via specManager `lastSelfWriteAt` |
| SPEC_DATA sends with unchanged payload | every debounce fire | **0** (payload-equality gate) |
| `webContents.send` per PTY output chunk | 1 per chunk × 9 PTYs | 1 per 16ms frame per terminal, 1MB pause/resume backpressure |
| laneStatus timers per output chunk | 1 clearTimeout+setTimeout per chunk | 1 timer per 1800ms quiet window |
| Ungated `setInterval` in src/main | 4 loops (usage 5min, update 6h, orch 5s, per-PTY 2.5s) | **0** outside pollGate/perfMonitor (grep-verified); all visibility-gated |
| Keychain reads on show/load inside TTL | 1 blocking exec each | 0 (5min `ttlCache`) |
| Prompt log growth | 1MB truncate-half (post-audit interim) | 5MB live + 5MB `.log.1`, async queue |
| PTYs orphaned by reload | until renderer reconcile | destroyed at `did-start-navigation` (+ reconcile backstop) |
| D3 source | CDN (fails offline) | vendored `d3@7.9.0` via node_modules |

## Runtime pass (to complete T10)

1. Quit the running Frame instance.
2. Launch with instrumentation: `FRAME_PERF=1 npm start` (or `NODE_ENV=development`).
3. Read the `perf`-scoped lines in main.log (Settings → Open Logs Folder):
   - `mark did-finish-load @ <N>ms` → must be ≤ 1500.
   - No `event-loop lag <N>ms` warnings during project init / spec edits.
   - `op project-init` / `op spec-push` durations ≤ 50ms budget (bootstrap
     child runs longer but no longer blocks the loop — the lag sampler is
     the check).
4. Hide the window, confirm no `perf`/poll activity lands in the log while
   hidden; show it and confirm the immediate usage refresh.
5. Reload (⌘R) with terminals open: main.log shows the navigation teardown
   line; no orphaned PTY warnings from the reconcile sweep.
