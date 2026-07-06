# Reliability, crash recovery & observability

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study.

## Problem

Frame's main process persists all critical state with plain, non-atomic
`writeFileSync`, has zero global crash handlers, degrades poorly when external
dependencies are absent, restores stale/mismatched state on restart, and ships
with no logging infrastructure a founder could use to debug a user's bug report.
Concretely:

### 1. Data corruption with no recovery path
- **Non-atomic writes everywhere.** Every state file is written with a bare
  `fs.writeFileSync` (no temp-file + `rename`, no `fsync`, no `.bak`): tasks
  (`src/main/tasksManager.js:131`), workspaces (`src/main/workspace.js:74`),
  user settings (`src/main/userSettings.js:51`), per-tool CLI config
  (`src/main/aiToolManager.js:112`), spec `status.json`
  (`src/main/specManager.js:123`). A crash or full disk mid-write leaves a
  truncated/corrupt file and there is no prior-good copy to fall back to.
  (`src/main/orchestrationManager.js:230` writes a temp path but still without
  atomic rename/backup.)
- **Corrupt `tasks.json` silently disables all CRUD.**
  `loadTasks` (`src/main/tasksManager.js:80-89`) returns `null` on any
  `JSON.parse` failure. Downstream mutations then no-op, so the dashboard clears
  while the tasks panel keeps stale data — inconsistent UI, no error surfaced.
- **Corrupt `workspaces.json` destroys the project list.**
  `loadWorkspace` (`src/main/workspace.js:59-67`) returns
  `createDefaultWorkspace()` (empty) on parse error; the very next mutation calls
  `saveWorkspace` (`src/main/workspace.js:74`) and overwrites the still-on-disk
  (recoverable) file with the empty default → total, permanent loss of the
  user's project list. No `.bak`, no recovery prompt.

### 2. Crash-handling gaps
- **No global handlers at all.** There is no `process.on('uncaughtException')`,
  no `process.on('unhandledRejection')`, and no `render-process-gone` /
  `child-process-gone` / `unresponsive` / `crashReporter` anywhere in
  `src/main`. `src/main/index.js` wires only `window-all-closed`
  (`:194`), `activate` (`:200`), and `closed → ptyManager.destroyAll()`
  (`:62-64`). A single uncaught error takes down the whole main process silently.
- **FSWatcher has no `error` listener.** Every `fs.watch` call is wrapped in a
  `try/catch` that only catches *synchronous* creation failure —
  `src/main/gitStatusManager.js:74` & `:94`, `src/main/tasksManager.js:267`,
  `src/main/specManager.js:676` & `:693`,
  `src/main/orchestrationManager.js:241`. None attach `.on('error', …)` to the
  returned watcher. If the watched root is deleted/renamed at runtime the watcher
  emits an `error` event with no listener → unhandled `EventEmitter` error →
  main-process crash (and, per §1, no atomic write means in-flight state can be
  corrupted too).
- **Window reload orphans PTYs.** PTYs are only destroyed on the window `closed`
  event (`src/main/index.js:62-64`). A renderer reload (Cmd-R / `did-fail-load`)
  does not fire `closed`, so the renderer's `terminalManager` loses all handles
  while the underlying agents keep running invisibly in the main process. There
  is no reload/reconcile handler.
- **No confirm-on-quit.** `window-all-closed` quits immediately
  (`src/main/index.js:194-198`); there is no `before-quit`/`will-quit` guard, so
  quitting with agents mid-task kills them with no warning.

### 3. Poor degradation when dependencies are missing/failing
- **Keychain / OAuth is macOS-only and silent.**
  `claudeUsageManager.getOAuthToken` (`src/main/claudeUsageManager.js:28-55`)
  shells out to `security find-generic-password`; on Linux/Windows or a locked
  keychain it just returns `null` and the failure is logged to a `console.log`
  no one sees while polling keeps running.
- **CLI detection can only say "not found."** `aiToolManager` probes via
  `-ilc command -v <cli>` and resolves `false` on spawn error/timeout
  (`src/main/aiToolManager.js:236-259`); there's no richer diagnostic and no
  guidance surfaced.
- **`updateChecker` cannot tell failure from up-to-date.** Both the "no newer
  version" branch and every failure branch resolve the same `null` —
  up-to-date (`src/main/updateChecker.js:89-90`), JSON parse error (`:92-93`),
  request error (`:98`), and timeout (`:99`). The UI can never distinguish
  "you're current" from "the check failed."

### 4. Rehydration correctness
- **Terminal restore uses dead IDs.** On project load, `terminalManager`
  (`src/renderer/terminalManager.js:~195-225`) restores only `viewMode`,
  `gridLayout`, custom names, and `activeTerminalId` keyed by terminal IDs from a
  *previous* process. Those IDs never match freshly-spawned PTYs, so restore is
  effectively cosmetic — prior sessions aren't reattached.
- **Orchestration rehydrate is partial.** `rehydrate`
  (`src/main/orchestrationManager.js:610-643`) rebuilds workers from
  `frame/<slug>/*` branches with `terminalId: null`, `detached: true`, and a
  status derived only from git (`merged ⇒ done`, else `idle`). There is no
  `baseSha`, no live lane, and stale `idle` detached workers persist on the board
  where they can collide with the footprint/conflict guard and block future
  dispatch.

### 5. Zero observability / logging
- **No logging infrastructure exists.** No `electron-log` / `winston` / `pino`,
  no rotating log file, no crash reporter / Sentry anywhere in `src` or
  `package.json`. Debugging relies entirely on scattered `console.log` /
  `console.error` that are invisible in a packaged app (no devtools). A founder
  receiving a bug report has nothing to inspect. (`task-prod-crash-reporting`
  remains pending.)
- **~29 swallowing catch blocks make errors vanish.** e.g.
  `src/main/orchestrationManager.js` (`:140,:173,:175,:190,:232,:387,:448,:451,:453,:552,:565,:581,:587,:592,:596,:597,:626`),
  `src/main/ptyManager.js:87,:105,:121,:128`,
  `src/main/aiToolManager.js:19,:254`,
  `src/main/gitBranchesManager.js:289,:291,:309,:382`. Real failures (kill,
  worktree removal, template read, bus write) disappear with no trace.
- **`promptLogger` leaks secrets.** `logInput`
  (`src/main/promptLogger.js:44+`) appends *every* raw terminal input line
  verbatim to `~/.frame/prompts/<project>.log` with no redaction and no rotation —
  API keys, tokens, and passwords typed into a terminal land in a plaintext log.
  Any real logging effort must not repeat this.
- **Telemetry is not a debugging tool.** `telemetry.js` is an opt-out Aptabase
  anonymous launch counter only — no error/event stream a maintainer could
  correlate to a report.

## Goal

Make Frame durable and diagnosable:
- **Atomic, recoverable writes** for all state files (temp-file + `fsync` +
  atomic `rename`, plus a `.bak` written before overwrite) with a corrupt-file
  recovery path that restores from `.bak` instead of clobbering it with an empty
  default.
- **Global error handlers** (`uncaughtException`, `unhandledRejection`,
  `render-process-gone`/`child-process-gone`) that log and degrade instead of
  silently dying, plus `error` listeners on every FSWatcher.
- **Graceful degradation** when git / gh / a CLI / network / keychain is absent
  or fails — the app stays usable and tells the user what's unavailable, and
  `updateChecker` distinguishes failure from up-to-date.
- **A real, rotating log file** (redacted — never secrets) and an optional,
  consent-gated crash reporter.
- **Correct rehydration**: reattach or cleanly retire terminals/orchestration
  workers on restart so stale IDs and detached idle workers don't mislead the UI
  or block dispatch. Confirm-on-quit when agents are running.

## Constraints

- Electron **main + renderer** split; changes must respect the existing manager
  boundaries (`tasksManager`, `workspace`, `userSettings`, `orchestrationManager`,
  `ptyManager`, `specManager`, `telemetry`, `updateChecker`, `promptLogger`) and
  their IPC contracts.
- **Privacy first:** logs and any crash payload must not leak secrets. The
  current `promptLogger` behavior (verbatim terminal capture) is the anti-pattern
  to avoid; redaction is mandatory.
- **Telemetry is opt-out** today (Aptabase launch counter). Any crash reporting
  must honor the same consent model and be documented (PRIVACY.md).
- Must remain cross-platform: don't assume macOS-only facilities (e.g. the
  `security`/Keychain path in `claudeUsageManager`).
- Keep it lightweight — this is a local desktop app, not a server; avoid heavy
  agent/APM stacks.

## Success criteria

- All state files (`tasks.json`, `workspaces.json`, user settings, tool config,
  spec `status.json`) are written atomically and survive a mid-write kill with an
  automatic `.bak` restore; no mutation ever overwrites recoverable data with an
  empty default.
- `uncaughtException` / `unhandledRejection` / `render-process-gone` handlers
  exist and **log rather than crash**; the app surfaces a recoverable error state.
- Every `fs.watch` attaches an `error` listener; deleting a watched root no
  longer crashes the main process.
- With git, gh, a CLI, network, or keychain missing/failing, the app stays usable
  and clearly reports what's degraded; `updateChecker` reports failure distinctly
  from up-to-date.
- A rotating, redacted log file exists at a documented location and captures
  enough context (with error stacks from previously-swallowed catches) to triage
  a user's bug report.
- On restart, terminals are either reattached or cleanly cleared (no dead-ID
  cosmetic restore), orchestration workers rehydrate without stale idle/detached
  entries blocking dispatch, and quitting with live agents prompts for
  confirmation.

## Out of scope

- Full APM / distributed tracing or a hosted analytics backend.
- Multi-user / server-side reliability and the team-collaboration platform
  (tracked separately).
- Reworking the agent orchestration model itself beyond rehydration correctness.
- A general secrets-manager; only redaction of logs is in scope here.

## Open questions for /spec.plan

- Crash-reporter choice (self-hosted vs. Sentry vs. minidump-only) and the
  consent flow — needs a PRIVACY.md entry consistent with the existing opt-out
  telemetry model.
- Log file location, format, size cap, and rotation policy (per-project under
  `~/.frame/` vs. Electron `userData`), plus retention.
- Redaction strategy — do we keep `promptLogger` at all, and if so how do we
  scrub secrets from terminal input before persisting?
- Atomic-write helper: shared utility vs. per-manager, and whether to adopt a
  vetted library vs. a small in-repo `writeFileAtomic`.
- Terminal rehydration: is true PTY reattach feasible, or is "clean clear +
  explicit resume" the pragmatic target?
