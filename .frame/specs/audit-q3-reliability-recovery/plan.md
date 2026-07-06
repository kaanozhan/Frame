# Plan — Reliability, crash recovery & observability

## Architecture

Five workstreams, each answering one section of the spec. Everything stays
inside the existing manager boundaries; the only new concepts are two small
main-process utility modules (`fsSafe`, `logger`) that the existing managers
call into, plus one `crashGuard` module wired from `index.js`.

### 1. Atomic, recoverable writes — `src/main/fsSafe.js` (new)

A small in-repo utility, not a library (the write path is ~30 lines, we avoid
a native dep, and `orchestrationManager.publishState` already half-implements
the pattern). Three exports:

- **`writeFileAtomic(filePath, data)`** — write to `<file>.tmp` in the *same
  directory*, `fsync` the fd, then `fs.renameSync` over the target. Before the
  rename, if the target exists and is non-empty, copy it to `<file>.bak`.
  Result: at every instant there is either a complete old file, a complete new
  file, or a complete `.bak` — never only a truncated file.
- **`readJsonWithRecovery(filePath)`** — returns
  `{ data, source: 'file' | 'bak' | null, error }`:
  1. Parse the file. Success → `{ data, source: 'file' }`.
  2. On parse failure, move the corrupt file aside to
     `<file>.corrupt-<timestamp>` (never delete it), then try `<file>.bak`.
     `.bak` parses → restore it as the live file, return
     `{ data, source: 'bak' }` so callers can tell the renderer a recovery
     happened.
  3. No usable `.bak` → `{ data: null, source: null, error }`. The corrupt
     original is already preserved aside, so a caller that falls back to a
     default can safely save without destroying recoverable data.
- **`safeWatch(target, options, listener)`** — wraps `fs.watch` and attaches
  an `error` handler on the returned watcher (log via `logger`, close the
  watcher, invoke an optional `onError` callback so call sites can re-arm or
  degrade). Fixes the unhandled-`error` → main-crash class at all six call
  sites in one shape.

Adopters (mechanical swap of `writeFileSync` → `writeFileAtomic`, `JSON.parse(readFileSync)` → `readJsonWithRecovery`):
`tasksManager` (tasks.json), `workspace` (workspaces.json), `userSettings`
(user-settings.json), `aiToolManager` (tool config), `specManager`
(status.json), `orchestrationManager` (bus state.json — keeps its tmp+rename
but gains fsync/bak via the helper).

Corrupt-file behavior changes:
- `tasksManager.loadTasks`: on unrecoverable corruption, return
  `{ tasks: [], corrupt: true }` instead of `null` and send a new
  `TASKS_FILE_ERROR` IPC event so the tasks panel/dashboard show one
  consistent "tasks.json is corrupt — recovered copy at …" state instead of
  silently no-op'ing CRUD.
- `workspace.loadWorkspace`: on unrecoverable corruption, only *then* fall
  back to `createDefaultWorkspace()` — the corrupt file has already been moved
  aside by `readJsonWithRecovery`, so the subsequent `saveWorkspace` no longer
  destroys the user's project list. Surface the recovery in the renderer via
  the health notice (below).

### 2. Crash handling — `src/main/crashGuard.js` (new)

One module, initialized first thing in `app.whenReady()` (before other
managers), owning:

- `process.on('uncaughtException')` / `process.on('unhandledRejection')` —
  log the full stack via `logger`, send a `MAIN_PROCESS_ERROR` IPC event to
  the renderer (non-fatal banner), and *do not* exit for recoverable errors.
- `app.on('render-process-gone')` / `app.on('child-process-gone')` and
  `webContents.on('unresponsive')` — log details; on renderer death offer
  reload via a native dialog.
- Electron's built-in `crashReporter.start({ uploadToServer: false })` —
  **minidump-only, local, nothing leaves the machine** (answers the spec's
  open question: no Sentry, no hosted backend — consistent with
  "lightweight" and privacy-first). To honor the spec's "optional,
  consent-gated" requirement and PRIVACY.md's existing "it will be opt-in"
  promise, dump collection is gated behind a Settings toggle (persisted via
  `userSettings`, surfaced in `settingsModal` next to the telemetry toggle);
  since no data is ever transmitted, local collection defaults on, and
  PRIVACY.md states explicitly that any future *upload* would be a separate
  opt-in.

Quit/reload lifecycle (in `index.js`):
- **Confirm-on-quit**: a `before-quit` handler checks
  `ptyManager.getTerminalCount() > 0` (or an active orchestration session);
  if so, `event.preventDefault()` + `dialog.showMessageBoxSync` confirm
  ("N agents are still running — quit anyway?"). Same guard on the window
  `close` event so Cmd-W/red-button gets it too.
- **Reload reconcile**: on `webContents.did-finish-load`, main sends the
  renderer the list of live PTY ids (`ptyManager.getTerminalIds()` exists).
  The renderer replies with the ids it actually has instances for; main
  destroys the orphans (new `ptyManager.destroyExcept(knownIds)`). A fresh
  renderer (reload) knows none, so orphaned agents are cleanly killed instead
  of running invisibly. The legacy single-PTY module (`pty.js`, killed today
  only on window `closed`) is included: the reconcile kills its singleton
  too, since a reloaded renderer re-creates it on project select.

### 3. Graceful degradation

- **`updateChecker`** — replace the everything-is-`null` contract with a
  discriminated result: `{ status: 'update-available', ... }`,
  `{ status: 'up-to-date', checkedAt }`,
  `{ status: 'error', reason: 'network' | 'timeout' | 'parse', checkedAt }`.
  `GET_UPDATE_STATUS` returns the last result; `settingsModal` renders
  "check failed" distinctly from "you're current".
- **`claudeUsageManager`** — guard the keychain path with
  `process.platform === 'darwin'`; on other platforms (or when `security`
  fails) return a degraded status object
  `{ available: false, reason: 'keychain-unsupported' | 'keychain-locked' }`
  once and stop the polling loop instead of silently polling forever. The
  usage widget (`terminalTabBar`) renders the reason as a tooltip/hidden
  state instead of pretending there's no data.
- **`aiToolManager`** — CLI detection resolves
  `{ found: false, reason: 'not-found' | 'timeout' | 'spawn-error' }` instead
  of bare `false`, and the failure is logged; the renderer keeps its current
  boolean behavior (`!!result.found`) but gains the reason for display in the
  tool selector.
- **git / gh missing** (explicitly named in the spec's goal and success
  criteria) — `githubManager` already probes `gh --version` and returns
  `'gh CLI not installed'`; that result additionally feeds the health notice
  instead of living only inside the GitHub panel. For git itself:
  `gitStatusManager`, `gitBranchesManager`, and `gitDiffManager` all
  `exec`/`execFile` the `git` binary and today fail silently per call on
  ENOENT. Each gets a distinguishable "git unavailable" result: a one-time
  probe on project init (same `--version` pattern as `githubManager`)
  publishes the degraded state to the health notice, and per-call ENOENT
  short-circuits quietly afterwards (no error spam, watchers stay off) so
  the Changes/Branches/GitHub surfaces show "git not available" instead of
  rendering empty or broken.

All degraded states funnel into one renderer surface: a new small
`healthNotice` banner module (same pattern as the existing
`telemetryNotice.js`) that listens for `MAIN_PROCESS_ERROR` /
`STATE_FILE_RECOVERED` events and shows a dismissible one-liner.

### 4. Rehydration correctness

- **Terminals (pragmatic target: clean clear + explicit state, not PTY
  reattach)** — true reattach isn't feasible (PTYs die with the main
  process; `node-pty` has no persistence). So: `terminalManager`'s
  `restoreProjectSession` stops restoring `activeTerminalId` /
  `terminalNames` keyed by dead ids — on load it keeps only `viewMode` /
  `gridLayout` (process-independent), and prunes dead-id entries from the
  saved session so localStorage doesn't accumulate garbage. Combined with the
  reload-reconcile in §2, restart is now honest: no cosmetic ghosts, no
  orphaned agents.
- **Orchestration** — `rehydrate()` gives recovered workers a distinct
  `status: 'recovered'` (instead of `idle`), and the footprint conflict guard
  in `dispatch` skips workers with `detached: true` — a stale recovered lane
  can no longer block dispatch of a new run for the same/overlapping spec.
  The board (`orchestrator.js`) renders `recovered` workers with an explicit
  "resume / remove" affordance instead of an idle lane that looks live.
  `publishState`'s bus snapshot additionally persists `baseSha` per worker so
  a future rehydrate can restore it rather than losing it.

### 5. Observability — `src/main/logger.js` (new)

- **`electron-log` (v5)** as the backend — the standard lightweight Electron
  choice: rotating file transport, works in packaged apps, no server. File
  location: Electron's default `app.getPath('logs')` (documented in
  PRIVACY.md). Rotation: 5 MB cap, keep 3 archives.
- The wrapper exports `log.info/warn/error(scope, ...args)` and applies a
  **redaction pass to every line before it hits any transport**: regexes for
  common secret shapes (`sk-…`, `ghp_…`/`gho_…`, `AKIA…`, `Bearer <token>`,
  `password=`/`token=`/`key=` values, long base64/hex runs) replaced with
  `[REDACTED]`. Redaction lives in the logger so no call site can forget it.
- **Swallowed catches**: the empty `catch (e) {}` blocks cited in the spec
  (`orchestrationManager`, `ptyManager`, `aiToolManager`,
  `gitBranchesManager`) become `catch (e) { log.warn(scope, e); }` — behavior
  unchanged (still non-fatal), but failures now leave a trace. Existing
  `console.error` calls in touched files route through the logger too.
- **`promptLogger` kept but fixed**: every line passes through the logger's
  `redact()` before `appendFileSync`, and the per-project log gets a size cap
  (on append past 1 MB, truncate to the newest half). No rotation machinery —
  it's a history feature, not a log.
- A "Open logs folder" affordance in `settingsModal` (shell.openPath on the
  logs dir) so a user filing a bug can find the file.

### New IPC channels (`src/shared/ipcChannels.js`)

- `MAIN_PROCESS_ERROR` (main → renderer) — crash-guard / degraded-dependency
  notices for the health banner.
- `STATE_FILE_RECOVERED` (main → renderer) — a state file was restored from
  `.bak` / moved aside as corrupt.
- `TASKS_FILE_ERROR` (main → renderer) — corrupt tasks.json state for the
  tasks panel + dashboard.
- `RECONCILE_TERMINALS` (round-trip) — reload orphan-PTY reconcile handshake.
- `GET_LOG_INFO` (renderer → main) — logs path for the settings modal.

## Files

- `src/main/fsSafe.js` — **New** — `writeFileAtomic` (tmp+fsync+rename+`.bak`), `readJsonWithRecovery`, `safeWatch`.
- `src/main/logger.js` — **New** — electron-log wrapper with mandatory redaction, rotation config, `getLogPath()`.
- `src/main/crashGuard.js` — **New** — global process/app crash handlers + local-only `crashReporter.start`.
- `src/main/index.js` — **Modified** — init crashGuard first, `before-quit`/`close` confirm-on-quit, reload PTY reconcile (incl. legacy `pty.js` singleton), `render-process-gone` wiring.
- `src/main/tasksManager.js` — **Modified** — atomic write, `.bak` recovery, corrupt-state IPC instead of silent `null`, `safeWatch`.
- `src/main/workspace.js` — **Modified** — atomic write, recovery-before-default so corrupt file is never clobbered.
- `src/main/userSettings.js` — **Modified** — atomic write + recovery on load.
- `src/main/aiToolManager.js` — **Modified** — atomic config write, reasoned CLI-detection result, logged catches.
- `src/main/specManager.js` — **Modified** — atomic status.json write, `safeWatch` on both watchers.
- `src/main/orchestrationManager.js` — **Modified** — fsSafe for bus state (+`baseSha` persisted), `safeWatch`, `recovered` rehydrate status, conflict guard skips detached workers, swallowed catches logged.
- `src/main/gitStatusManager.js` — **Modified** — `safeWatch` on both watchers, git-unavailable probe + quiet ENOENT short-circuit.
- `src/main/gitDiffManager.js` — **Modified** — git-unavailable ENOENT short-circuit (distinguishable result, no silent empty diff).
- `src/main/githubManager.js` — **Modified** — existing `gh --version` probe result additionally published to the health notice.
- `src/main/ptyManager.js` — **Modified** — `destroyExcept(knownIds)` reconcile API, logged catches.
- `src/main/claudeUsageManager.js` — **Modified** — platform guard, degraded-status result, stop polling when unavailable.
- `src/main/updateChecker.js` — **Modified** — discriminated `up-to-date` / `update-available` / `error` results.
- `src/main/promptLogger.js` — **Modified** — redaction before append, size cap.
- `src/main/gitBranchesManager.js` — **Modified** — swallowed catches routed through logger, git-unavailable ENOENT short-circuit.
- `src/shared/ipcChannels.js` — **Modified** — new channels listed above.
- `src/renderer/healthNotice.js` — **New** — dismissible degraded/recovered banner (telemetryNotice pattern).
- `src/renderer/index.js` — **Modified** — mount healthNotice, reconcile-terminals handshake.
- `src/renderer/terminalManager.js` — **Modified** — drop dead-ID session restore (keep viewMode/gridLayout only), prune stale session entries.
- `src/renderer/terminalTabBar.js` — **Modified** — render usage-widget degraded reason.
- `src/renderer/settingsModal.js` — **Modified** — distinct update-check failure state, "Open logs folder", crash-dump collection toggle.
- `src/renderer/orchestrator.js` — **Modified** — render `recovered` workers with resume/remove affordance.
- `PRIVACY.md` — **Modified** — document log file location/rotation/redaction and local-only minidumps.
- `package.json` — **Modified** — add `electron-log`.

## Footprint

- src/main/fsSafe.js
- src/main/logger.js
- src/main/crashGuard.js
- src/main/index.js
- src/main/tasksManager.js
- src/main/workspace.js
- src/main/userSettings.js
- src/main/aiToolManager.js
- src/main/specManager.js
- src/main/orchestrationManager.js
- src/main/gitStatusManager.js
- src/main/gitDiffManager.js
- src/main/githubManager.js
- src/main/ptyManager.js
- src/main/claudeUsageManager.js
- src/main/updateChecker.js
- src/main/promptLogger.js
- src/main/gitBranchesManager.js
- src/shared/ipcChannels.js
- src/renderer/healthNotice.js
- src/renderer/index.js
- src/renderer/terminalManager.js
- src/renderer/terminalTabBar.js
- src/renderer/settingsModal.js
- src/renderer/orchestrator.js
- PRIVACY.md
- package.json

## Dependencies

- `electron-log` (^5) — rotating, packaged-app-safe log file for main +
  renderer with zero server component; replaces invisible `console.*`.

(Crash dumps use Electron's built-in `crashReporter` with
`uploadToServer: false` — no new dependency, no data leaves the machine.)

## Sequencing

1. **`fsSafe.js` + adopt in `workspace.js`** — the highest-stakes corruption
   path (project-list wipe) first. Kill-during-write and corrupt-file-restore
   verified by hand (`kill -9` mid-save; hand-truncate workspaces.json and
   confirm `.bak` restore + no clobber).
2. **Adopt `fsSafe` in the remaining writers** — `tasksManager` (incl. the
   corrupt-state IPC + panel/dashboard consistency), `userSettings`,
   `aiToolManager` config, `specManager` status.json,
   `orchestrationManager` bus state.
3. **`logger.js` + redaction + `promptLogger` fix** — logging must exist
   before crash handlers have somewhere to write. Unit-check the redaction
   regexes against sample keys/tokens; verify the rotating file appears under
   `app.getPath('logs')` in a packaged build.
4. **Swallowed-catch sweep** — route the cited empty catches in
   `orchestrationManager`, `ptyManager`, `aiToolManager`,
   `gitBranchesManager` through `log.warn`; no behavior change.
5. **`crashGuard.js`** — global handlers, local-only crashReporter behind
   the Settings toggle, `MAIN_PROCESS_ERROR` IPC + new `healthNotice`
   renderer banner. Verify a thrown error in a timer logs + banners instead
   of killing the app.
6. **`safeWatch` everywhere** — swap the six `fs.watch` call sites; verify
   deleting a watched project dir at runtime degrades (logged, watcher
   closed) instead of crashing.
7. **Quit/reload lifecycle** — confirm-on-quit dialog when PTYs are live;
   `RECONCILE_TERMINALS` handshake destroying orphaned PTYs (incl. the
   legacy `pty.js` singleton) on reload; `terminalManager` dead-ID restore
   removal. Verify Cmd-R with a running agent kills the orphan and the
   session restore keeps only layout.
8. **Degradation sweep** — `updateChecker` discriminated results (+
   settingsModal display), `claudeUsageManager` platform guard + polling
   stop (+ terminalTabBar display), `aiToolManager` detection reasons,
   git/gh availability probes feeding the health notice with quiet ENOENT
   short-circuits in `gitStatusManager` / `gitBranchesManager` /
   `gitDiffManager` / `githubManager`. Verify with `git`/`gh` temporarily
   masked from PATH that panels degrade with a message instead of breaking.
9. **Orchestration rehydrate** — `recovered` status, conflict-guard
   exemption for detached workers, `baseSha` in the bus snapshot,
   orchestrator board resume/remove affordance. Verify a restart with leftover
   worktrees no longer blocks dispatching an overlapping spec.
10. **Docs** — PRIVACY.md: log location/rotation/redaction, local-only
    minidumps (collection toggle documented; any future upload is a separate
    opt-in, honoring the existing "it will be opt-in" promise); settingsModal
    "Open logs folder".
