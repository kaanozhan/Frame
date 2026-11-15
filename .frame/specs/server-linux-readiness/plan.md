# Plan — Frame Server on Linux

## Architecture

### Resolved plan-time decisions

The user accepted every recommendation on 2026-11-15, adding one requirement: "loopa girip cpu şişirip performans sorunu yaşatmasın" (no loops, no CPU spikes). That requirement is decision T5.

Business:
- **B1 Shell choice in a server workspace.** The "+" menu shows the server's own shells, read with a new `terminals.shells` method, so it behaves as it does locally. Rejected: no shell choice on servers, which would leave zsh and fish users with no choice.

Technical:
- **T1 How hooks find Node.** Every hint hook command runs the first Node it finds: `node` on PATH, then `$FRAME_NODE` with `ELECTRON_RUN_AS_NODE=1`; with neither it exits 0. A desktop with system Node runs exactly what it runs today. In a server worktree, Frame Server's own Node runs, because `FRAME_NODE` survives login shells.

  The new command, for script `S` and mode `M`:
  ```
  sh -c '[ ! -f .frame/bin/S ] || { n=$(command -v node || printf %s "$FRAME_NODE"); [ -z "$n" ] || ELECTRON_RUN_AS_NODE=1 exec "$n" .frame/bin/S M; }'
  ```
  Rejected: adding Frame's Node to the terminals' PATH. Debian's `/etc/profile` resets PATH in login shells, and the user's `node` would silently become Frame's Node 20.

  Known lag: in `repo` mode a server worktree gets the new command once the upgraded `.claude/settings.json` is committed and pushed.
- **T2 Watching large worktrees on Linux.** On `process.platform === 'linux'` only, `gitStatusManager` replaces the recursive worktree watch with one non-recursive watch per directory that git does not ignore. The directory list comes from `git ls-files -z` (tracked) plus `git ls-files -o --exclude-standard --directory -z` (untracked, not ignored), so `node_modules` and other ignored trees are never watched.
  - If the cap (T5) is exceeded or a watch fails with `ENOSPC`/`EMFILE`, the worktree watch is dropped for a slow refresh timer, and the status payload carries `live: false` with the reason.
  - The `.git` watcher is unchanged.
  - macOS and Windows keep the recursive watch.

  Rejected: `.git` plus the top level plus a timer, because edits reach the panel late and the server polls for nothing.
- **T3 Test posture: everything testable.**
  - Hook commands are run through a real `sh` with PATH and `FRAME_NODE` set three ways.
  - The legacy upgrade, the server's shell list and the default shell are tested.
  - The directory set, the cap fallback and the T5 loop guards are tested on temp repos.
  - The renderer note stays untested (no DOM harness). Rejected: pure logic only.
- **T4 (silent) Default shell.** With `SHELL` unset, Linux uses `/bin/bash`, else `/bin/sh`; macOS keeps `/bin/zsh`. On the server, a `shell` passed by the desktop that does not exist there is ignored and the default is used, which also covers older desktops.
- **T5 (silent, user requirement) No loops, no CPU spikes.**
  - **Bounded watches.** At most 4000 directory watches per worktree. Above that, the timer fallback runs with `live: false` and the reason "too many folders to watch".
  - **Directory list rebuilt rarely.** The list is rebuilt only when a watched directory gains or loses a subdirectory. Rebuilds are debounced 1 s, never more than once per 10 s, and never more than one `ls-files` pair at a time.
  - **No self-triggering.** Events caused by Frame's own reads are ignored: `.frame/` and `.git` are already filtered, and the existing `GIT_SELF_READ_GRACE_MS` guard stays. A rebuild therefore cannot cause another rebuild.
  - **Slow fallback timer.** It ticks every 30 s and runs only while a desktop watches. It stops on `git.unwatch`, on idle and on project switch, and never overlaps an in-flight `git status` (the existing `isFetching` guard).
  - **Hook cost.** Each hint call adds only one `command -v`.
- **T6 (silent) Codex hooks stay as they are.** They live in the machine-wide `~/.codex/hooks.json` (`frameProject.js:741`, `codexHookCommands`), and the desktop never installs them on a server, so a server has no Codex hint hooks to break. Changing their command would also make Codex quietly stop trusting them (`codexHookTrustState`), forcing every user to re-trust. Only the Claude Code hooks (`SPEC_HINT_HOOKS`, committed per project) change.
- **T7 (silent) Older Frame Server.** "Unknown method" on `terminals.shells` hides the shell choice for that workspace, so the server user's login shell opens. No protocol bump (server-hardening rule).

### Data shapes

```
terminals.shells {}  → [{ id, name, path }]        (the server's getAvailableShells())
GET_AVAILABLE_SHELLS + { workspaceId }              (renderer → main; routed for server workspaces)
GIT_STATUS_DATA      + { live: false, liveReason }  (only when the worktree is not watched live)
```

### Components

- `src/shared/frameTemplates.js`: `hintCommand(script, mode)` builds the T1 command, and `SPEC_HINT_HOOKS` uses it. Every previous command string (all six hooks) is added to `LEGACY_SPEC_HINT_COMMANDS`.
- `src/main/frameProject.js` is unchanged. Its upgrade (`installSpecHintHook`) and removal paths are already list-driven: they take out entries made only of `LEGACY_SPEC_HINT_COMMANDS` and add today's, on project open.
- `src/main/ptyManager.js`:
  - `getDefaultShell` adds the Linux fallback (T4).
  - `GET_AVAILABLE_SHELLS` takes `{ workspaceId }`. For a server workspace it answers from `terminals.shells`, or with an empty list on an old server, and the renderer then shows no shell choice.
  - `createTerminal` validates a given shell path on non-macOS platforms.
- `src/server/terminals.js`: `terminals.shells`.
- `src/main/gitStatusManager.js`: `watchDirs(root)` (Linux): the directory set, per-directory watchers, rebuild scheduling (T5), the cap, and `live`/`liveReason` in the push.
- `src/renderer/terminalManager.js`: `getAvailableShells()` sends the current workspace id.
- `src/renderer/gitChangesPanel.js`: a one-line note "Live updates are off for this workspace — <reason>. Changes refresh every 30 s."

## Files

- `src/shared/frameTemplates.js` — **Modified**: `hintCommand`, new Claude Code hook commands, the previous forms in `LEGACY_SPEC_HINT_COMMANDS`
- `src/main/ptyManager.js` — **Modified**: Linux default shell, routed `GET_AVAILABLE_SHELLS`, shell path validation
- `src/server/terminals.js` — **Modified**: `terminals.shells`
- `src/main/gitStatusManager.js` — **Modified**: Linux per-directory watching with cap, rebuild limits and fallback timer; `live` / `liveReason`
- `src/renderer/terminalManager.js` — **Modified**: workspace id with the shell list request
- `src/renderer/gitChangesPanel.js` — **Modified**: live-updates-off note
- `test/hintHooks.test.js` — **New**: the hook command under real `sh` (node on PATH / only `FRAME_NODE` / neither), the upgrade of the previous forms, Codex hooks unchanged
- `test/serverShells.test.js` — **New**: `terminals.shells`, the default shell with `SHELL` unset, an unknown shell path ignored, routing and the old-server fallback
- `test/gitWatchLinux.test.js` — **New**: the directory set skips ignored trees, a new subdirectory is picked up, rebuild limits, no self-triggered rebuild, the cap and `ENOSPC` fallback with `live: false`, the timer stops on unwatch

## Footprint

- src/shared/frameTemplates.js
- src/main/ptyManager.js
- src/server/terminals.js
- src/main/gitStatusManager.js
- src/renderer/terminalManager.js
- src/renderer/gitChangesPanel.js
- test/hintHooks.test.js
- test/serverShells.test.js
- test/gitWatchLinux.test.js

## Dependencies

None.

## Sequencing

1. **Hook command.**
   - `hintCommand` in `frameTemplates.js`; `SPEC_HINT_HOOKS` uses it.
   - The previous strings go into `LEGACY_SPEC_HINT_COMMANDS`, so `frameProject`'s existing upgrade replaces them on open.
   - Tests in `test/hintHooks.test.js` (real `sh`; the upgrade through `installSpecHintHook`), failing first.
2. **Shells on the server.**
   - Linux default shell and shell path validation in `ptyManager`.
   - `terminals.shells` in `src/server/terminals.js`.
   - Routed `GET_AVAILABLE_SHELLS` with the old-server fallback.
   - `terminalManager.getAvailableShells` sends the workspace id.
   - Tests in `test/serverShells.test.js`, failing first.
3. **Linux per-directory watching.**
   - `watchDirs` in `gitStatusManager` (Linux only), with the directory set, rebuild debounce and rate limit, and no self-triggered rebuild.
   - Tests in `test/gitWatchLinux.test.js` (the platform is injected), failing first.
4. **Cap and fallback.**
   - The 4000-watch cap and `ENOSPC`/`EMFILE` handling switch to the 30 s timer (stopped on unwatch, idle and switch).
   - `live` / `liveReason` in the push.
   - The note in `gitChangesPanel.js`.
   - Tests in `test/gitWatchLinux.test.js`, failing first.
