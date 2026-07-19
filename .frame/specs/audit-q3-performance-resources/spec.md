# Performance & resource usage

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study.

## Problem

Frame's main process is the IPC server for the whole app, yet it does most of its work synchronously and rebroadcasts full datasets on every change. Verified findings, grouped:

**Main-thread blocking (sync fs / child_process).** `grep -rn "Sync(" src/main/` returns **172** synchronous calls. Heaviest: `frameProject.js` (41 — e.g. existsSync/readFileSync/writeFileSync clustered through project init, lines 29-407), `structureBootstrap.js` (24), `specManager.js` (22), `orchestrationManager.js` (17), `pluginsManager.js` (13). Every one of these blocks all IPC and both windows while it runs. Worst single blockers:
- `structureBootstrap.js:263` — `spawnSync('node', [parserPath], { timeout: 30000 })` freezes the main event loop for up to **30s** during first-time Frame-project init (`frameProject.js:174/312/438`, guarded to first STRUCTURE.json creation, skipped when no `src/`).
- `pluginsManager.js:177` / `:205` — `execSync` `git clone` / `git pull` (network-bound, unbounded blocking).
- `claudeUsageManager.js:31` — `execSync security find-generic-password` (macOS Keychain read, 5s timeout) fired on every usage fetch.
- `structureBootstrap.js:102` — `execSync git config`.
- `fileTree.js:21` + `:44` — `fs.readdirSync` recursing synchronously to `maxDepth=5` (a blocking whole-subtree walk per invocation).

**Reparse / rebroadcast amplification (no diffing anywhere).** Neither tasks nor specs update incrementally:
- `tasksManager.js:267` — `fs.watch` on the project dir; any `tasks.json` change → 50ms debounce → `loadTasks` full `JSON.parse` (`:274`) → full `TASKS_DATA` rebroadcast (`:275`).
- `specManager.js:676` (recursive `fs.watch` over `.frame/specs/**`) and `:693` (`tasks.json` watch) both funnel into `pushSpecData` (`:726`), which calls `syncAllSpecTasks` + `listSpecs` + full `SPEC_DATA` send (`:730-732`).
- Fan-out arithmetic for this repo (17 specs / 166 tasks): `syncAllSpecTasks` loops all spec dirs (`:458`) and each `syncTasksFromMarkdown` does its own full `tasks.json` parse (`:374`) = 17, plus `listSpecs` parses once more (`:144`) = **~18 full tasks.json parses per single file change**. `reconcilePhase` (`:212-218`) rewrites each spec's `status.json` on any phase drift (up to **17**), and `syncTasksFromMarkdown:426` can rewrite up to 17 more.
- Feedback loop: the recursive watcher (`:676`) fires on `pushSpecData`'s own `writeStatus` calls; `activeTasksWatcher` (`:693`) has **no self-write guard** (unlike `tasksManager.js:269`), so specManager writing `tasks.json` re-triggers itself. Only the 250ms `WATCH_DEBOUNCE_MS` throttles it.

**PTY flooding (no flow control).** `ptyManager.js:204-210` — `onData` forwards every chunk via `webContents.send(TERMINAL_OUTPUT_ID)` with no batching, coalescing, or backpressure, for up to `MAX_TERMINALS = 9` (`ptyManager.js:14`) PTYs per project. In the renderer each chunk fans out to two consumers: `terminalManager` `term.write` (`:754-768`) and `laneStatus._onOutput` (`laneStatus.js:67`), which does a `clearTimeout`/`setTimeout` per chunk per terminal (`:233-234`, `QUIET_MS=1800`) — timer churn on every chunk even though the buffer scan itself is throttled to 600ms (`:223`). `pty.js:82-86` (legacy path) is the same fire-and-forget.

**Polling cost (battery/CPU, no focus-gating).** `claudeUsageManager.js:186` polls every **300000ms (5 min)**, each poll doing the sync Keychain `execSync`; `updateChecker.js:46` every **6h**; `orchestrationManager.js:562` status poll every **5000ms**; `ptyManager.js:231` per-PTY `processPoll` interval (~2500ms) for foreground-process name. None are gated on window focus/visibility.

**Memory / leaks.**
- Prompt logs are **unbounded**: `promptLogger.js:56` `fs.appendFileSync(~/.frame/prompts/{project}.log)` with no size cap, rotation, or truncation; `getHistory` reads the whole file into memory.
- Orphaned PTYs on reload: cleanup only runs on window `'closed'` (`index.js:62-66` → `ptyManager.destroyAll`). There is **no** `will-navigate`/`beforeunload` handler, so a menu reload (`menu.js:56` `role:'reload'`) tears down the renderer while main-process `ptyInstances` (and their ~2500ms `processPoll` intervals, `ptyManager.js:231-251`) survive, still streaming to a renderer with no matching terminal and no way to close them.
- localStorage sessions accumulate: `terminalManager.js:152` `saveProjectSession` adds one record per project path and `clearProjectSession` (`:731`) has **zero callers** repo-wide (dead code) — unbounded in count (records are small: viewMode/gridLayout/names only).
- Listener hygiene: many `ipcRenderer.on`/`addEventListener` registrations lack paired removal (`laneRail.js:79/84/94`, `laneBoard.js:110/418/423`, `laneStatus.js:67/73/86`, `terminalManager.js:93/94/754/772`, `appLoader.js:26`). Currently mitigated by singleton + guard-flag init (not stacking on project switch today), but fragile: `ipcMain.on`-heavy modules (`ptyManager`, `tasksManager`, `workspace`) would silently duplicate handlers if any init re-runs.

**Startup.** `index.js:11-34` synchronously `require`s ~24 modules, then `whenReady` runs `init()` + `createWindow()` + ~13 sequential `module.init(window)` (`:163-177`) synchronously before the window is interactive. Lightweight today, but any heavy work added here blocks first paint. The 30s `spawnSync` is on the project-init path, not boot.

**Scaling ceilings.** D3 structure map: `index.html:10` loads D3 from CDN (`https://d3js.org/d3.v7.min.js`) — hard runtime dependency, undefined and throws offline. `structureMap.js:393` runs `d3.forceSimulation` over the **full** STRUCTURE.json (every `data.modules` entry, no cap/sampling), and the `'tick'` handler (`:462-470`) does O(nodes+links) DOM writes per tick with no rAF batching, tick cap, or `alphaMin`/`alphaDecay` override (~300 default ticks). Combined with 9 PTYs × 10k-line scrollback and thousands of tasks, the full-rebuild/full-rebroadcast model degrades super-linearly on large repos.

## Goal

Move hot paths off synchronous blocking and full-dataset rebuilds toward incremental, flow-controlled, bounded behavior:
- Convert hot-path fs/child_process to async (`fs.promises`, async spawn) or move heavy scans to a worker/child so the IPC loop never blocks.
- Make task/spec updates **incremental**: parse once, diff, and send only changed records; add self-write guards to break watcher feedback loops.
- Add **PTY flow control**: coalesce/batch `onData` chunks (rAF or fixed-interval flush), apply backpressure, and stop per-chunk timer resets in `laneStatus`.
- **Bound** buffers/logs: keep scrollback bounded (already 10k), rotate/cap prompt logs, prune localStorage sessions (wire up `clearProjectSession`).
- Add **polling with TTL + focus-gating**: pause/slow intervals when the window is hidden; cache Keychain/usage/update results with a TTL.
- Clean up listeners and destroy PTYs on reload/navigation; re-attach or reap orphaned PTYs.
- Vendor D3 locally and throttle/cap the force simulation (tick budget, rAF batching, node cap for large graphs).

## Constraints

- The **main process is the IPC server** for both windows — any synchronous work there stalls all renderers; changes must not reintroduce blocking.
- Electron main/renderer split and existing IPC channel contracts must be preserved.
- **Keep behavior identical** — this is a performance/resource refactor, not a feature or UX change. Same data reaches the renderer, same terminal fidelity, same spec/task semantics.

## Success criteria

- No synchronous fs / `execSync` / `spawnSync` on hot paths (project init, watchers, usage poll, file tree, plugins); the 30s bootstrap scan no longer blocks the event loop.
- Task/spec changes produce incremental updates (parse-once + diff), not ~18 full `tasks.json` parses / up to 17 `status.json` rewrites per file change; watcher feedback loops broken by self-write guards.
- PTY output is flow-controlled (batched/coalesced with backpressure); no per-chunk timer churn in `laneStatus`.
- Scrollback stays bounded (10k), prompt logs are rotated/capped, localStorage sessions are pruned.
- Polling loops are focus-gated and TTL-cached; hidden-window CPU/battery cost drops measurably.
- No leaks across project switch / lane close / reload: no orphaned PTYs, no leaked intervals, no stacking listeners.
- A measured startup budget is established and met (time-to-interactive on cold launch).

## Out of scope

- Full rewrite / re-architecture of the main process or IPC layer.
- Web / browser mode.
- New features or UX changes; visual redesign of the structure map beyond throttling/vendoring.
- Changing terminal count limits or spec/task data model semantics.

## Open questions for /spec.plan

- Profiling approach: how do we measure main-thread block time, IPC latency, per-chunk cost, and startup time reproducibly (Electron tracing? `performance` marks? a synthetic 9-PTY + large-repo harness)?
- Acceptable budgets: target startup time-to-interactive, max tolerated main-thread block per operation, PTY flush interval / batch size, prompt-log cap + rotation policy, D3 tick budget / node cap.
- Incremental protocol: extend existing full-payload IPC channels with diff messages, or version new incremental channels alongside them?
- Worker vs async: which heavy scans (structure bootstrap, file tree) move to a worker/child process vs just becoming async on the main thread?
- Orphaned-PTY policy on reload: destroy-and-recreate, or persist and re-attach surviving PTYs to the fresh renderer?
