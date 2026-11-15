---
keywords: linux, frame server, hooks, node, shell, inotify, fs.watch, server workspace
related: server-specs, server-workspace-panels, server-workspaces, server-hardening, audit-q3-cross-platform
---

# Frame Server on Linux

## Problem

Frame is built and tested day to day on macOS, while Frame Server runs on the user's Linux box. A review of the 73 modules Frame Server loads found no hard-coded Mac paths, but three places assume a Mac-like machine and fail quietly on Linux:

- **Hooks need `node` on PATH.** Claude Code hooks run `exec node .frame/bin/<script>` (`src/shared/frameTemplates.js:1000-1044`). Since `server-specs` provisions `.frame/bin` into server worktrees, these hooks now run on the server. Claude Code's native installer does not install Node, so on a server without it every tool call can hit a hook error. Frame Server already gives its terminals its own Node as `FRAME_NODE` (`src/main/ptyManager.js:227`), but the hooks do not use it.
- **The shell list comes from the Mac.** The lane "+" menu lists shells probed on the desktop (`ptyManager.getAvailableShells`, with `/bin/zsh` first). Choosing one in a server workspace sends that path to the server (`ptyManager.js:673`), where zsh is often missing on Ubuntu and the terminal fails to start. With no `SHELL` set, the default is also `/bin/zsh` (`ptyManager.js:90`).
- **Git status watches the whole worktree.** `gitStatusManager` watches the worktree recursively (`gitStatusManager.js:161`). On Linux, Node implements this with one inotify watch per directory, so a repository with `node_modules` can exhaust `fs.inotify.max_user_watches` (`ENOSPC`). The watcher then closes and the Changes panel stops refreshing without saying why.

## Goal

- **Hooks run on a server without system Node, or skip cleanly.** A Claude Code session in a server worktree gets Frame's spec and module hints using Frame Server's own Node when `node` is not on PATH, and never fails a tool call because Node is missing. Local behavior is unchanged.
- **Server workspaces use the server's shells.** In a server workspace the "+" shell list shows the shells that exist on the server, and a terminal there starts with a shell that exists on the server, including when `SHELL` is unset.
- **Git status keeps working in large repositories on Linux.** The server's git status stays live in a repository with `node_modules` (or similar large ignored trees) within the default inotify limit, and if watching still fails, the Changes panel says so and keeps refreshing on demand.

## Constraints

- Builds on `server-specs` (tooling provisioned into server worktrees) and `server-workspace-panels` (the server watches and pushes `git.status`; no desktop polling over SSH).
- Hook commands are shared templates written into users' `.claude/settings.json`. Any change must keep working on the desktop, where `FRAME_NODE` is Electron's binary and needs `ELECTRON_RUN_AS_NODE=1`. It must also be picked up by Frame's existing managed-hook upgrade, with no manual edit.
- macOS desktop behavior and code paths stay as they are (the same guard `audit-q3-cross-platform` set).
- Frame Server runs as the user, never as root: raising `max_user_watches` is not Frame's to do.
- No new dependencies on the server package.
- No protocol number bump for added methods; an older server answers "Unknown method" and the desktop falls back to today's behavior.

## Success Criteria

- When a Claude Code session runs in a server worktree on a machine with no `node` on PATH, then Frame's hooks run with Frame Server's Node (or exit 0 silently), and no tool call reports a hook error.
- When the desktop runs the updated hooks, then the hint output is the same as before.
- When an existing project opens in the updated Frame, then its managed hook entries are upgraded to the new commands.
- When the user opens the "+" menu in a server workspace, then it lists only shells present on the server.
- When a server terminal is created with no shell chosen and `SHELL` unset, then it starts with a shell that exists on the server (`/bin/bash`, else `/bin/sh`).
- When a server workspace's repository has more directories than the inotify limit allows (for example a large `node_modules`), then Frame Server's git status still refreshes after an edit and a commit.
- When the server's worktree watcher fails anyway, then the Changes panel says live updates are off for that workspace and why, instead of going stale silently.
- When `npm test` runs on Linux in CI, then the new hook command, shell selection and watcher rules have tests that fail before the change.

## Out of Scope

- audit-q3-cross-platform (desktop on Windows and Linux: Keychain, Overview counts, packaging)
- A macOS Frame Server package
- Raising system inotify limits or installing packages on the server
- Codex sign-in via localhost callback on a server

## Open Questions

- **How hooks find Node.** Options:
  - (a) Hook commands use `${FRAME_NODE:-node}` with `ELECTRON_RUN_AS_NODE=1`. This works wherever Frame launched the terminal, and falls back to `node` elsewhere.
  - (b) Keep `node`, but skip silently when `command -v node` fails. This is simplest, but a server without Node loses the hints.
- **How the server watches a large worktree.** Options:
  - (a) Non-recursive watches on the directories git tracks (skipping ignored trees such as `node_modules`), re-derived when the tree changes.
  - (b) Watch only `.git` plus the worktree's top level, and refresh on a slow timer while a desktop is connected.
- **Shell choice in a server workspace.** Options:
  - (a) Frame Server reports its own shell list (`terminals.shells`), and the "+" menu shows it for server workspaces.
  - (b) No shell choice in server workspaces: always the server user's login shell.
