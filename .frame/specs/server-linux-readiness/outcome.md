
## T01 — Hint hooks find Node on a server

Added `hintCommand(script, mode)` to `src/shared/frameTemplates.js`, exported for tests. All six Claude Code hint hooks in `SPEC_HINT_HOOKS` now use it: `node` on PATH, else `$FRAME_NODE` with `ELECTRON_RUN_AS_NODE=1`, else exit 0, and still exit 0 without `.frame/bin/<script>`. The six previous `exec node` strings were appended to `LEGACY_SPEC_HINT_COMMANDS`, so `frameProject.installSpecHintHook`'s existing upgrade replaces them on project open; `frameProject.js` itself is unchanged, as planned. Codex hooks are untouched. Tests in `test/hintHooks.test.js` run each command through a real `/bin/sh` with a PATH that has only `sh` (plus `node` in one case). Deviation: `test/frameProjectInit.test.js`, which is not in the plan, pinned the previous command shape by regex; it now pins the new shape and keeps its backreference (the file the guard tests is the file it execs). Running that file on its own fails 16 tests on the previous commit too; it passes in `npm test`.

_Captured: 2026-11-15 · 3 file change(s)_

---

## T02 — Default shell on Linux and unknown shell paths

`ptyManager.getDefaultShell` now delegates the Unix case to `defaultUnixShell(platform, env, exists)`: `$SHELL`, else `/bin/zsh` on macOS, else `/bin/bash` on Linux, falling back to `/bin/sh`. `createTerminal` passes the requested shell through `requestedShell(path, platform, exists)`, which off macOS and Windows drops an absolute path that does not exist on that machine (logged) and uses the default. On a Frame Server this covers a desktop sending `/bin/zsh`. Both rules take the platform and an exists check, so `test/serverShells.test.js` tests Linux on any machine. `fs`/`path` are now required at the top of `src/main/ptyManager.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T03 — A server workspace's shell menu lists the server's shells

Added `terminals.shells` to `src/server/terminals.js` (the server's `getAvailableShells()`). `GET_AVAILABLE_SHELLS` in `src/main/ptyManager.js` now takes `{ workspaceId }` and answers a server workspace from Frame Server, and `terminalManager.getAvailableShells` sends the current workspace id. Deviation from the plan's 'empty list on an older server': that answer is a single `Default shell` entry with a null path (the server picks its default), because both menus read an empty list as 'Loading...' and re-ask, which would loop while the menu stays open. Second deviation, approved by the user: `homeBoard.js` and `terminalTabBar.js` (not in the plan) cached the list once at startup, so each now re-reads it once per open for the current workspace and re-renders without asking again, showing 'No shells found' instead of re-asking forever. Tests in `test/serverShells.test.js`; the menus are DOM code with no harness and get the spec's closing live check.

_Captured: 2026-11-15 · 6 file change(s)_

---

## T04 — Linux watches one folder at a time

On `platform === 'linux'`, which `startWatching` now takes as an option for tests, `gitStatusManager` replaces the recursive worktree watch with `createDirWatcher`. It holds one non-recursive `fs.watch` per folder from `watchedDirsFor(root)`: parents of `git ls-files` (tracked) and `ls-files -o --exclude-standard` (untracked, not ignored) files, plus untracked folders from `--directory`, minus `.git`/`.frame`. The set is re-read only when a watched folder gains or loses a subfolder: debounced 1 s, never sooner than 10 s after the previous re-read (`LINUX_WATCH`, shortened in tests), never two at once, with one pending re-read covering a burst. After a re-read that changed the set, one refresh catches files made in a new folder before it was watched. The `.git` watcher and macOS/Windows behavior are unchanged. Tests in `test/gitWatchLinux.test.js` cover the folder set, live edits, nested new folders, a 40-folder burst taking ≤ 3 re-reads, and no re-read or push storm from Frame's own reads.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T05 — Watch cap, timer fallback and the live-updates-off note

`createDirWatcher` now stops watching folders and switches to a refresh timer in two cases: when the folder set exceeds `LINUX_WATCH.MAX_DIRS` (4000), or when a watch fails with `ENOSPC`/`EMFILE`, at creation or later. The timer runs every `FALLBACK_INTERVAL_MS` (30 s), skips a tick while a `git status` is in flight, does no further re-reads, and is cleared by `stopWatching` (and by Frame Server's idle). The status push carries `live: false, liveReason`, the de-dupe includes it, and the push goes out at once on fallback. `src/renderer/gitChangesPanel.js` adds one line above the list: 'Live updates are off for this workspace — <reason>. Changes refresh every 30 s.' It is created in JS with the panel's existing empty-state class, so `index.html` and the styles are untouched. Tests cover the cap, the timer catching an edit, no re-reads on the timer, the timer stopping with the watch, no live flag when watched live, and ENOSPC via a patched `fs.watch`. The spec's closing live check (isolated app, server package from this branch) confirmed the T03 menus: in a server workspace the request carried its workspace id; offline showed one 'Default shell' entry, with one request in 2.5 s while the menu stayed open.

_Captured: 2026-11-15 · 4 file change(s)_

---
