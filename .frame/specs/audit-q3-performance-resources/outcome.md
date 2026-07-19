# Outcome — Performance & resource usage

## T01 — perfMonitor + baseline instrumentation

Created `src/main/perfMonitor.js` (500ms event-loop-lag sampler warning past a 50ms budget, `opStart`/`opEnd` op timers, startup marks with a 1500ms TTI budget check, all dev-gated behind `NODE_ENV=development` / `FRAME_PERF=1`, logging via the existing `logger` under a `perf` scope). Wired `app-ready`, `window-created`, and `did-finish-load` marks into `src/main/index.js`. Deviation: baseline numbers could not be captured live because the user's Frame instance was running — they land in `main.log` on the next dev launch, and T10 owns the formal measurement pass.

_Captured: 2026-07-19 · 2 file change(s)_

---

## T02 — async structure bootstrap + frameProject init path

Converted `structureBootstrap.js` to async: `spawnSync` parser scan → async `spawn` (same 30s kill timeout, stderr capped at 4KB), `execSync git config` → async `exec` (5s timeout); `detectHookSetup`/`installPreCommitHook`/`bootstrapStructure` are now async. Made `frameProject.initializeFrameProject` async end-to-end (writes/reads/unlinks/mkdirs via `fs.promises`, awaited by the IPC handler) behind a per-project in-flight promise guard, wrapped in `perfMonitor` `project-init` op timing. Deviation: cheap `existsSync`/`lstatSync` existence stats stayed sync by design — the blocking cost was the child processes and file writes, not sub-ms stats; `copyParserScripts` (a dozen small bundled-file copies) also stayed sync as a cold, bounded step.

_Captured: 2026-07-19 · 2 file change(s)_

---
## T03 — async remaining hot paths

Replaced `execSync` git clone/pull/version in `pluginsManager.js` with an async `execFile` helper (`execGit`, stderr preserved for `classifyGitError`), which rippled `getMarketplacePlugins`/`getAllPlugins`/`ensureOfficialMarketplace`/`refreshMarketplace` to async (all callers are async `ipcMain.handle`s). Converted `fileTree.getFileTree` to an async `fs.promises.readdir` recursion with a destroyed-sender guard on the reply. Converted the Keychain read in `claudeUsageManager.js` from a 5s-blocking `execSync` to async `execFile` and made `getOAuthToken`/`fetchUsage` async end-to-end (credentials file via `fs.promises`).

_Captured: 2026-07-19 · 3 file change(s)_

---

## T04 — parse-once + skip-unchanged + self-write guards

Added an mtime+size-keyed load cache to `tasksManager.loadTasks` (refreshed by `saveTasks`, exported `getLastSelfWriteAt` for cross-module guard use) — one spec push now costs one tasks.json parse instead of ~29. In `specManager`: `writeStatus` became write-if-changed and stamps `lastSelfWriteAt`; the recursive specs watcher drops self-writes; the previously unguarded `tasks.json` watcher now drops events within 250ms of `tasksManager`'s own saves; `pushSpecData` sends `SPEC_DATA` only when the serialized payload changed (gate reset in `startWatching` so a fresh renderer always gets its first paint), timed via `perfMonitor` `spec-push`. Deviation: the "single shared tasks load" is realized through the cache rather than threading a tasksData parameter through `syncAllSpecTasks`/`listSpecs` — same effect, much smaller diff.

_Captured: 2026-07-19 · 2 file change(s)_

---
## T05 — PTY flow control + laneStatus timer churn

Added per-terminal output coalescing to `ptyManager.js`: chunks buffer and flush as one `TERMINAL_OUTPUT_ID` send per 16ms frame, with `pause()`/`resume()` backpressure at a 1MB high-water mark; trailing output flushes before `TERMINAL_DESTROYED`, and flush timers are cleared in every destroy path. Applied the same 16ms coalescing to the legacy `pty.js` single-terminal path (cleared in `killPTY`). Replaced `laneStatus.js`'s per-chunk `clearTimeout`/`setTimeout` with `_armQuietTimer`: one timer per activity burst that checks `lastActivityAt` and re-arms for the remainder — same 1800ms quiet semantics, one timer per QUIET_MS window instead of per chunk.

_Captured: 2026-07-19 · 3 file change(s)_

---
## T06 — reload lifecycle + init-once guards

Added a `did-start-navigation` hook in `src/main/index.js` (main-frame, non-same-document, dual legacy/structured event read for Electron 28) that kills the legacy PTY and `destroyAll()`s multi-terminals the moment a reload starts. Deviation from the audit's premise: the codebase had since grown a `RECONCILE_TERMINALS` sweep (renderer reports known ids on boot, orphans killed) — the hook complements it by tearing down immediately (stopping processPoll intervals too) rather than waiting for the fresh renderer, per the destroy-and-recreate gate decision. Added init-once listener guards to `laneStatus.init`, `appLoader.init`, `TerminalManager._setupIPC`, and `LaneBoard`'s constructor `GIT_STATUS_DATA` listener (`laneRail` already had one).

_Captured: 2026-07-19 · 5 file change(s)_

---
## T07 — bounded logs & sessions

Rewrote `promptLogger` persistence: sync `appendFileSync` + truncate-half cap (drift: a 1MB cap already existed, added after the audit) → serialized async append queue with 5MB rotation to `<name>.log.1` (single archive generation, Windows-safe rm-then-rename), async `getHistory` bounded by the live-file cap. Added a 20-record MRU cap to `terminalManager.saveProjectSession` (`savedAt` stamp, `_pruneSessions`; global + just-written keys never pruned) and wired the previously dead `clearProjectSession` into `projectListUI.removeProject`. Deviation: `projectListUI.js` was not in the plan's Footprint — it's the natural project-removal wiring point, one guarded call added.

_Captured: 2026-07-19 · 3 file change(s)_

---
## T08 — pollGate + focus-gated polling

Created `src/main/pollGate.js`: `gatedInterval(fn, ms, {refreshOnShow})` (pauses when no window is visible/unminimized, immediate run + resume on show, `dispose()` handle, windows auto-wired via `browser-window-created`) and `ttlCache(fn, ttlMs)` (in-flight sharing, errors uncached). Migrated: `claudeUsageManager` (gated 5min poll; poll/load/show all funnel through a 5min `ttlCache` so show-transitions cost zero Keychain hits; manual refresh bypasses), `updateChecker` (6h recheck, `refreshOnShow: false` — deviation from the blanket refresh-on-show semantics, deliberate to avoid a network check per show), `orchestrationManager` status poll, and `ptyManager`'s per-PTY 2500ms `processPoll` (all `clearInterval`s became `dispose()`).

_Captured: 2026-07-19 · 5 file change(s)_

---
## T09 — D3 vendoring + structure-map throttling

Added `d3@7.9.0` to `package.json` and swapped the CDN `<script>` in `index.html` for `node_modules/d3/dist/d3.min.js` (same mechanism as the xterm.css tag — works offline now). Reworked `structureMap.js`: the force simulation is created `.stop()`ed with `alphaMin` raised to 0.005, driven by a manual rAF loop (one `simulation.tick()` + one batched DOM write per frame, 300-tick budget); drag/resize resume the loop instead of `simulation.restart()` (whose internal timer nothing listens to anymore); graphs above 1500 modules render the 1500 highest-degree nodes with a logged notice (`capGraphByDegree`); hide/tree-view teardown cancels the rAF loop.

_Captured: 2026-07-19 · 3 file change(s)_

---
## T10 — measurement pass (partial: static done, runtime pending)

Wrote the acceptance record to `measurements.md`: every static budget verified (0 hot-path execSync/spawnSync, 0 ungated setIntervals in src/main, parse-once proven with a live micro-check — 3× loadTasks = 1 disk parse over the real 247-task tasks.json, PTY/log/session/D3 bounds in place). Deviation: the runtime half (TTI ≤ 1.5s, lag-sampler silence, hidden-window quiet) could not run because the user's Frame instance was live — a second instance would fight the same watchers and session state. Task left `in_progress`; measurements.md documents the exact `FRAME_PERF=1 npm start` steps to close it.

_Captured: 2026-07-19 · 1 file change(s)_

---
