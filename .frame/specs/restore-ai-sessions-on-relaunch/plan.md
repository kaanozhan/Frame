# Plan — Restore AI sessions on relaunch

## Architecture

### Resolved plan-time decisions

- **Session capture mechanism → `SessionStart` hook + per-terminal env**
  (asked). Rejected: guessing from the newest transcript after a terminal
  opened (two Claude terminals in one project cross-assign; `/clear` is
  missed) and reading `--resume <id>` off the command line (plain `claude`
  carries no id). The hook also fires on `/clear` / `/resume` / compaction,
  so the mapping follows the terminal's *current* session.
- **Where the hook lives → per project** (asked). Claude: the project's
  `.claude/settings.json` / `settings.local.json` (the sharing mode's file,
  `gitSharing.hookFileFor`). Codex: `CODEX_HOME/hooks.json` — Codex loads
  hooks only there (`codex-parity`) — but the command is guarded on `.frame/`
  in the hook's cwd, so it only acts in Frame projects. Consequence, accepted:
  sessions in projects that were never initialized with Frame are not restored.
  Rejected: a user-global entry in `~/.claude/settings.json`.
- **Active-tool gate → bypassed for the session hook only** (asked). Both the
  Claude and the Codex entry are installed on every open of a Frame project,
  whichever tool is active, so a project with one Claude and one Codex
  terminal restores both. The hint hooks keep today's gate.
- **Last active project → saved explicitly** (asked, in the spec's open
  question). Written on every project selection; launch selects it if it is
  still in the workspace, else falls back to today's `projects[0]`.
- **Restore is automatic, plain shells ignored, Claude + Codex only**
  (decided in the spec conversation).
- **Test posture → pure logic only** (asked). Matches the testing record:
  the store's pure core and the hook install/remove are tested; DOM-coupled
  renderer code is not.
- *Silent:* the hook writes its stdin payload to a file with `sh` + `cat`
  — no node start, no `.frame/bin` script, no dependency. Same `sh -c` posture
  as every existing Frame hook.
- *Silent:* a session ends (and leaves the record) when the user closes the
  terminal, the shell exits, or the terminal's foreground process returns to
  the shell after an agent had been seen in it. App teardown never ends one:
  `ptyManager.destroyAll()` freezes the store before killing PTYs.
- *Silent:* the store lives in `~/.frame/session-restore.json` beside
  `workspaces.json`, written atomically on every change — it survives a crash,
  unlike renderer `localStorage`. The existing `frame-terminal-sessions`
  localStorage record is left as is.
- *Silent:* "once per project per run" is held in the renderer, so a renderer
  reload (which destroys every PTY) restores again — same as a relaunch.
- *Silent:* existence check uses the payload's `transcript_path`, which both
  CLIs send; an entry without one is never restored.
- *Silent:* a nested CLI (e.g. `claude -p` run from inside a session's Bash
  tool) inherits the env and would fire `SessionStart` too. Reports are
  accepted only when the reporting process belongs to the terminal's
  foreground process group; step 1 measures which pid the hook can name.
- *Silent:* restore is capped at the per-project terminal limit (9), oldest
  first. Overlapping in-flight footprints (`audit-q3-cross-platform`,
  `audit-q3-performance-resources` on `ptyManager.js`, `index.js`,
  `terminalManager.js`, …) are audit specs; this plan's edits there are small
  additive hooks into existing functions and do not contradict them.

### Flow 1 — capture

1. `ptyManager.createTerminal` adds `FRAME_TERMINAL_ID=<term-N>` and
   `FRAME_SESSION_DIR=~/.frame/session-reports` to the PTY env.
2. The user runs `claude` or `codex`. On `SessionStart` the hook runs:

   ```sh
   [ -z "$FRAME_SESSION_DIR" ] || [ -z "$FRAME_TERMINAL_ID" ] || {
     f="$FRAME_SESSION_DIR/$FRAME_TERMINAL_ID.<tool>.$PPID"
     cat > "$f.tmp" && mv -f "$f.tmp" "$f.json"; }
   ```

   (`<tool>` is literal `claude` / `codex`; the Codex form also requires
   `[ -d .frame ]`.)
3. `sessionRestore` (main) watches the directory, parses
   `<terminalId>.<tool>.<pid>.json`, validates (UUID session id, known live
   terminal, pid in the foreground group), deletes the file, and applies it to
   the live map. The terminal's project record is rewritten.

### Flow 2 — record upkeep

Live map (main): `terminalId → { projectPath, tool, sessionId, transcriptPath,
cwd, name, createdAt, seenAgent }`. Events that change it: report, restore
claim, rename/active (renderer → main), foreground-process change (ptyManager's
existing poll), user close (`TERMINAL_DESTROY`) and shell exit. Each event
rewrites only the record of the project it concerns:

```json
{
  "version": 1,
  "lastActiveProject": "/abs/path",
  "projects": {
    "/abs/path": {
      "savedAt": 1760000000000,
      "activeSessionId": "uuid",
      "sessions": [
        { "tool": "claude", "sessionId": "uuid", "transcriptPath": "…jsonl",
          "cwd": "/abs/path", "name": "Auth work" }
      ]
    }
  }
}
```

Projects untouched this run keep their record from the last run. Records are
pruned MRU to 20 projects, like the localStorage record. Frozen (teardown):
every event is ignored until the next `createTerminal`.

### Flow 3 — restore

1. Launch: `projectListUI` asks main for `lastActiveProject` and selects it.
2. On every project selection, `multiTerminalUI.setCurrentProject` calls
   `sessionRestore.maybeRestore(projectPath)` (renderer). First time this
   run → `SESSION_RESTORE_TAKE` returns the record's sessions whose transcript
   exists, capped at 9.
3. For each, `agentDispatch.resumeAgentSession` opens a new terminal **in that
   project** (not "current"), applies the saved name, tells main the claim
   (`SESSION_RESTORE_CLAIM`) and types `claude --resume <id>` or
   `codex resume <id>`. The previously active session's terminal gets focus;
   the view lands on Terminals.

## Files

- `src/main/sessionRestoreStore.js` — **New**. Pure core: report filename
  parsing/validation, live-map reducers (report, claim, meta, foreground,
  close), project-record projection, MRU prune, restore plan
  (exists-filter + cap).
- `src/main/sessionRestore.js` — **New**. Electron/fs wrapper: store file
  read/write (`fsSafe`), report-dir watch and cleanup, freeze/unfreeze,
  foreground-group check, IPC handlers.
- `src/main/ptyManager.js` — **Modified**. Session env on spawn; forward
  foreground changes, user destroy and exit to `sessionRestore`; freeze in
  `destroyAll`, unfreeze in `createTerminal`.
- `src/main/index.js` — **Modified**. `sessionRestore.init` + `setupIPC`.
- `src/main/frameProject.js` — **Modified**. `installSessionHook` /
  `removeSessionHook` (project Claude settings) and `installCodexSessionHook`
  / removal, without the active-tool gate; Codex install called on open and
  init.
- `src/main/gitSharing.js` — **Modified**. Install/remove the Claude session
  hook alongside the spec-hint hook when the mode's file is applied.
- `src/shared/frameTemplates.js` — **Modified**. `SESSION_REPORT_HOOKS`
  (Claude) and `CODEX_SESSION_REPORT_HOOKS` command templates.
- `src/shared/ipcChannels.js` — **Modified**. `SESSION_RESTORE_TAKE`,
  `SESSION_RESTORE_CLAIM`, `SESSION_RESTORE_META`,
  `SESSION_RESTORE_SET_LAST_PROJECT`, `SESSION_RESTORE_GET_LAST_PROJECT`.
- `src/renderer/sessionRestore.js` — **New**. `maybeRestore(projectPath)`,
  once-per-run set, sequential restore.
- `src/renderer/agentDispatch.js` — **Modified**. `resumeAgentSession(tool,
  sessionId, { projectPath, name, focus })`; `resumeClaudeSession` delegates
  to it.
- `src/renderer/multiTerminalUI.js` — **Modified**. Call `maybeRestore` after
  a project switch.
- `src/renderer/terminalManager.js` — **Modified**. Send name and active
  terminal changes to main (`SESSION_RESTORE_META`).
- `src/renderer/projectListUI.js` — **Modified**. Save the selected project;
  launch selects the saved one.
- `test/sessionRestoreStore.test.js` — **New**. Pure-core tests.
- `test/sessionHookInstall.test.js` — **New**. Claude + Codex session-hook
  install/remove: merge-safe, idempotent, no active-tool gate, sharing-mode
  file move.

## Footprint

- src/main/sessionRestoreStore.js
- src/main/sessionRestore.js
- src/main/ptyManager.js
- src/main/index.js
- src/main/frameProject.js
- src/main/gitSharing.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/renderer/sessionRestore.js
- src/renderer/agentDispatch.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/projectListUI.js
- test/sessionRestoreStore.test.js
- test/sessionHookInstall.test.js

## Dependencies

None.

## Sequencing

1. **Measure the hook ground.** In a Frame terminal with the env set by hand,
   confirm for Claude Code (2.1.x) and Codex (0.160.x): the hook process
   inherits `FRAME_*`; the payload carries `session_id`, `transcript_path`,
   `source`; which pid (`$PPID` or an ancestor) shares the terminal's
   foreground process group, and that a nested `claude -p` does not; and that
   `SessionStart` fires again on `/clear` and `--resume`. Record the results in
   `.frame/specs/restore-ai-sessions-on-relaunch/measurements.md` and adjust
   the command template if `$PPID` is not the right pid.
2. **Pure store core** — `sessionRestoreStore.js` with
   `test/sessionRestoreStore.test.js`: filename parse/validate, reducers,
   record projection, `seenAgent` → shell drop, MRU prune, restore plan.
3. **Hook templates and install** — templates in `frameTemplates.js`;
   `installSessionHook` / `removeSessionHook` and Codex equivalents in
   `frameProject.js`; wire into `gitSharing.setMode`, project open and init;
   with `test/sessionHookInstall.test.js`.
4. **Main wrapper + PTY wiring** — `sessionRestore.js` (store file, report
   watch, startup cleanup, freeze, IPC channels), `ptyManager.js` env and
   event forwarding, `index.js` init.
5. **Renderer metadata and last project** — `terminalManager.js` sends
   name/active changes; `projectListUI.js` saves the selection and selects
   the saved project on launch.
6. **Restore** — `agentDispatch.resumeAgentSession` (Claude + Codex, explicit
   project), `renderer/sessionRestore.js`, the `multiTerminalUI` call; focus
   the previously active session and land on Terminals.
