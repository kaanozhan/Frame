# Outcome — Reliability, crash recovery & observability

## T01 — fsSafe.js + workspace.js adoption

Added `src/main/fsSafe.js` (`writeFileAtomic` tmp+fsync+rename with non-empty-only `.bak`, `readJsonWithRecovery` that moves corrupt files to `.corrupt-<ts>` and restores from `.bak`, `safeWatch` with error handler) and switched `workspace.js` load/save onto it — the corrupt-then-mutate flow now restores the last good project list instead of wiping it. Divergence from plan: also added the repo's first test infrastructure (`test/` + `npm test` via node's built-in runner, zero deps) with 10 fsSafe tests including the mid-write-kill scenario, verified end-to-end against the real workspace module with a sandboxed home dir. `safeWatch` logs via `console.error` until `logger.js` lands in T03.

_Captured: 2026-07-06 · 4 file change(s)_

---
## T02 — fsSafe adoption in remaining state writers

Switched `tasksManager`, `userSettings`, `aiToolManager` config, `specManager` status.json (read+write), and the orchestration bus state.json onto `fsSafe`. `loadTasks` now restores from `.bak` or — when unrecoverable — preserves the corrupt copy, writes a fresh file immediately (test caught that without this, the moved-aside file read as "no tasks.json" and CRUD died again), returns `{ tasks: [], corrupt: true }`, and emits a new `TASKS_FILE_ERROR` channel; the in-memory `corrupt` flag is stripped on save. Added 4 tasksManager corruption tests (suite now 14).

_Captured: 2026-07-06 · 7 file change(s)_

---
## T03 — logger.js + promptLogger redaction/cap

Added `electron-log@5` and `src/main/logger.js`: lazy-required backend (redact() stays usable from plain node), a hooks-level redaction pass on every message (sk-/ghp-/github_pat/AKIA/xox/JWT/Bearer/keyed password=… patterns), 5 MB file cap with a custom 3-archive rotation, `info/warn/error(scope, …)` API with console fallback pre-init, wired first in `index.js#init()`. `promptLogger` now redacts every line before append and truncates the history file to its newest half past 1 MB. 17 new tests (10 secret shapes scrubbed, 5 clean lines untouched, prompt-log redaction + cap on the real module); suite 31.

_Captured: 2026-07-06 · 5 file change(s)_

---
## T04 — swallowed-catch sweep

Routed 24 empty catches through `logger.warn` with per-site context (orchestrationManager 17, gitBranchesManager 4, aiToolManager 2 + import, ptyManager destroy paths) via an exact-match codemod. Deviations: ptyManager's four `which <shell>` probe catches stay silent deliberately (expected-absence, would be launch noise, not failures); `pty.kill()` in destroy/destroyAll gained the missing try/catch — it was unprotected and a kill throw during window close would have crashed main.

_Captured: 2026-07-06 · 4 file change(s)_

---
## T05 — crashGuard + healthNotice

Added `src/main/crashGuard.js` (uncaughtException/unhandledRejection log-and-notify instead of dying, render-process-gone reload dialog, child-process-gone/unresponsive logging, local-only `crashReporter.start({uploadToServer:false})` gated by a new `crashDumpsEnabled` setting) wired into `index.js` right after userSettings; new `MAIN_PROCESS_ERROR`/`STATE_FILE_RECOVERED` channels; new `src/renderer/healthNotice.js` + `health-notice.css` dismissible banner (dedupes repeat messages) listening to those plus `TASKS_FILE_ERROR`; workspace bak-restore now notifies the banner; "Keep local crash dumps" toggle added to index.html + settingsModal (next-launch semantics — the reporter can't be stopped once started). Renderer bundle builds clean.

_Captured: 2026-07-06 · 9 file change(s)_

---
## T06 — safeWatch on all six fs.watch call sites

Swapped `fs.watch` → `fsSafe.safeWatch` at all six sites (gitStatusManager worktree+.git, specManager specs-root+tasks.json, orchestrationManager bus dir, tasksManager project dir), each with an onError that clears the stale watcher reference so the manager degrades to its manual-refresh paths. Verified live that deleting a watched root at runtime leaves the process alive.

_Captured: 2026-07-06 · 4 file change(s)_

---
## T07 — confirm-on-quit

Added `confirmQuitWithLiveAgents()` in `src/main/index.js`: `before-quit` (Cmd-Q/menu) and window `close` (Cmd-W/red button) both prompt when `ptyManager` has live terminals, with a `quitConfirmed` flag preventing double prompts — on Win/Linux the confirmed close flows into quit unprompted; on macOS a later Cmd-Q prompts independently.

_Captured: 2026-07-06 · 1 file change(s)_

---

## T08 — reload reconcile + dead-ID session restore removal

Added `RECONCILE_TERMINALS` (renderer invokes at every boot with the terminal ids it holds — none after Cmd-R), `ptyManager.destroyExcept(knownIds)` killing orphans plus `pty.killPTY()` for the legacy singleton, and logging of what was reaped. `terminalManager.restoreProjectSession` now treats viewMode/gridLayout as the only restart-surviving state and prunes dead-id terminalNames/activeTerminalId entries from localStorage. Divergence from plan: the reconcile is renderer-initiated at boot rather than main-initiated on did-finish-load — same outcome, no race with renderer readiness.

_Captured: 2026-07-06 · 5 file change(s)_

---
## T09 — distinguishable dependency failures

`updateChecker.checkForUpdate` now resolves `{status: 'update-available'|'up-to-date'|'error', reason}` (network/timeout/parse) and `GET_UPDATE_STATUS` carries `lastStatus`/`lastErrorReason`; settingsModal renders "Update check failed (…) — you may not be on the latest version" distinctly from "You're up to date", on both manual checks and hydrate. `claudeUsageManager` gains a darwin-only keychain guard (other platforms get one `available:false, reason:'keychain-unsupported'` push and no polling), pauses polling after 3 consecutive token misses, and a manual widget refresh re-arms it; terminalTabBar hides the usage widget on unsupported platforms and shows the sign-in guidance in the tooltip otherwise. `aiToolManager.isCommandAvailable` resolves `{found, reason: 'not-found'|'timeout'|'spawn-error'}` with probe failures logged; the availability IPC propagates `reason` and agentDispatch's failure toast says which of the three happened.

_Captured: 2026-07-06 · 6 file change(s)_

---
## T10 — git/gh availability degradation

Startup probe in `index.js` (after did-finish-load): `git --version` / `gh --version` failures log and push a warning-severity `MAIN_PROCESS_ERROR` health notice naming what's unavailable; healthNotice now renders warning vs error styles by payload severity. Per-call short-circuits: `gitStatusManager`/`gitDiffManager` latch on `execFile` ENOENT (verified signature), `gitBranchesManager.execGit` latches on shell exit 127/"command not found" (verified) and rejects fast with "git is not installed or not on PATH". Divergence: `githubManager` itself is untouched — its existing in-panel "gh CLI not installed" stays, and the banner comes from the startup probe instead (avoids double-signaling from two code paths).

_Captured: 2026-07-06 · 5 file change(s)_

---
## T11 — orchestration rehydrate correctness

Rehydrated un-merged workers now get `status: 'recovered'` (not `'idle'`), the footprint conflict guard skips any `detached` worker, and `baseSha`/`detached` are serialized into the bus snapshot and restored on rehydrate. Added a Resume path — new `ORCH_RESUME_WORKER` IPC + `resumeWorker()` that relaunches an agent lane in the worker's EXISTING worktree (deliberately not via dispatch: `createOrchWorktree` recreates the worktree and force-deletes the branch, which would destroy the recovered work). Board renders Recovered as a dashed amber card/chip in the off-track row with Resume enabled and Approve allowed on recovered work.

_Captured: 2026-07-06 · 4 file change(s)_

---
## T12 — observability docs + Open Logs Folder

PRIVACY.md gains "Local logging" (location via Settings → About, 5 MB × 3 rotation, redaction list, prompt-history note) and "Crash dumps (local only)" (uploadToServer disabled, Settings toggle, future upload = separate opt-in — honoring the old "it will be opt-in" promise). Added `GET_LOG_INFO` IPC (logPath/logsDir/crashDumpsDir) and a Diagnostics row in Settings → About with "Open Logs Folder" (shell.showItemInFolder on the live log file).

_Captured: 2026-07-06 · 5 file change(s)_

---
