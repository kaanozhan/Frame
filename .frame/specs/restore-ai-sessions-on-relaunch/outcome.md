## T01 — Measure the hook ground

Probed `SessionStart` for Claude Code 2.1.295 and Codex 0.160.0 under a pty from a Frame lane, recorded in `measurements.md`. Both CLIs pass the env through, send a UUID `session_id` and an existing `transcript_path`, and `$PPID` is the CLI process whose pgid equals the tty's tpgid; a nested CLI from a Bash tool sits in another group, so the planned `pgid($PPID) === tpgid(shell)` check holds with no ancestor walk. `/clear` re-fire was not measurable headless (documented by Claude Code); the plan's command template stands unchanged.

_Captured: 2026-10-09 · 1 file change(s)_

---
## T02 — Pure store core

Added `src/main/sessionRestoreStore.js`: report name/payload parsing (UUID id, absolute `transcript_path`), live-map reducers (register, report, claim, meta, foreground, close) that return the project whose record must be rewritten, record projection, `putRecord` with MRU prune to 20, and `planRestore` (transcript-exists filter, dedupe, cap 9). `seenAgent` keeps a claimed terminal through its first shell prompt; only agent → shell ends a session. Covered by `test/sessionRestoreStore.test.js` (20 tests).

_Captured: 2026-10-09 · 2 file change(s)_

---
## T03 — Claude session hook template and install

Added `SESSION_REPORT_HOOKS` (an env-guarded `sh`+`cat` SessionStart command, verified against a live Claude run to name the claude pid) to `frameTemplates.js`, and `installSessionHook` with a shared `mergeHookEntries` helper to `frameProject.js`, called from `gitSharing.setMode` without the active-tool gate. Diverged from plan: no separate `removeSessionHook` — `removeSpecHintHook` now counts the session entry as Frame's, so sharing-mode moves, migration and `removeFrame` take it out with no new call sites. Outside the plan's Files, three existing tests that pin Frame's exact hook set (`frameProjectInit`, `gitSharing`, `layoutMigration`) were updated to count the new entry; new coverage in `test/sessionHookInstall.test.js`.

_Captured: 2026-10-09 · 8 file change(s)_

---
## T04 — Codex session hook

Added `CODEX_SESSION_REPORT_HOOKS` (same command, plus a `[ ! -d .frame ]` guard since `CODEX_HOME/hooks.json` is global) and `installCodexSessionHook` in `frameProject.js`, called after `gitSharing.reconcile` on both init and open with no active-tool gate; `removeCodexHintHook` now removes it too. Outside the plan's Files: the `npm test` script in `package.json` now sets `CODEX_HOME=.frame/runtime/test-codex-home`, because the now-ungated install made every init/open test write the user's real `~/.codex/hooks.json`. Tests added to `test/sessionHookInstall.test.js`.

_Captured: 2026-10-09 · 4 file change(s)_

---
## T05 — Main-process wrapper

Added `src/main/sessionRestore.js`: loads/saves `~/.frame/session-restore.json` through `fsSafe` (skipping writes when a record is unchanged), clears and watches `~/.frame/session-reports/`, accepts a report only when `pgid(pid) === tpgid(shell)` via one `ps` call (Windows accepts as is), exposes `envFor` / `registerTerminal` / `onForeground` / `onClose` / `freeze` for ptyManager, and the IPC handlers; `index.js` inits it before any PTY exists. Diverged from plan: a sixth channel, `SESSION_RESTORE_DONE` — `take()` holds a project's record until the renderer says its restore finished (60 s fallback), so the first claimed terminal cannot rewrite a multi-session record down to one mid-restore.

_Captured: 2026-10-09 · 3 file change(s)_

---
## T06 — PTY wiring

`ptyManager.createTerminal` now adds `sessionRestore.envFor(id)` to the PTY env and registers the terminal with its shell pid; the foreground poll forwards name changes; `destroyAll` freezes the store before killing anything. Beyond the plan, `destroyExcept` (orphans after a renderer reload) passes `teardown: true` so those sessions are kept, while user/orchestrator closes and shell exits call `onClose`. Verified end to end under the project's Electron with HOME redirected: the real hook command in a real PTY produced a store record that survived `destroyAll`, and the same report from a background job was rejected by the foreground-group check.

_Captured: 2026-10-09 · 1 file change(s)_

---
