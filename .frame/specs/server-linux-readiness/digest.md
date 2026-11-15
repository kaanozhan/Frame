---
keywords: linux, frame server, hooks, node, shell, inotify, fs.watch, server workspace
related: server-specs, server-workspace-panels, server-workspaces, server-hardening, audit-q3-cross-platform
---
Frame Server now copes with a plain Linux box. A review of the 73 modules Frame Server loads found no hard-coded Mac paths but three Mac-shaped assumptions, all fixed:

- **Hint hooks:** `frameTemplates.hintCommand` runs `node` from PATH, else `$FRAME_NODE` with `ELECTRON_RUN_AS_NODE=1` (Frame Server's bundled Node on a server), else exits 0. The old `exec node` strings sit in `LEGACY_SPEC_HINT_COMMANDS`, so the existing upgrade replaces them on project open. Rejected: putting Frame's Node on PATH, since Debian's `/etc/profile` resets PATH. Codex hooks are unchanged: they are machine-wide, never installed on a server, and trust-tracked.
- **Shells:** with `SHELL` unset, Linux starts `/bin/bash`, then `/bin/sh` (macOS stays `/bin/zsh`), and a shell path missing on the machine is ignored (`requestedShell`). Frame Server answers `terminals.shells`, and a server workspace's "+" menu lists those. An old or offline server answers one "Default shell" entry with a null path, never an empty list.
- **Git status on Linux:** the recursive watch is replaced by one non-recursive watch per folder git cares about (`watchedDirsFor`: tracked, untracked-not-ignored, empty untracked), so `node_modules` is never watched. The folder list is re-read only when folders appear or vanish (debounced 1 s, at least 10 s apart, one at a time). Above 4000 folders or on `ENOSPC`/`EMFILE` it falls back to a 30 s timer that stops with the watch, and pushes `live: false, liveReason`; the Changes panel shows that line.

Rules established:
- No watcher, timer or menu may re-trigger itself. Every new watch path carries a bound and a test for it (the user's "no loops, no CPU spikes").
- The two "+" menus re-read the shell list once per open and never retry.
- In `repo` mode a server worktree gets new hook commands only after the upgraded `.claude/settings.json` is committed.

Chain: spec.md → plan.md → tasks.md → outcome.md
