---
keywords: server workspace, remote panels, file tree, changes, diff, review, pull request, push, update from base
related: server-workspaces, workspace-review, workspace-pr-flow, update-from-base, workspaces
---

# Panels for server workspaces

## Problem

`server-workspaces` put a workspace's terminals and agents on the user's server, but it stopped there. Selecting a server workspace shows "comes in a later update" in the file tree. The Changes panel, branch label, diff, review, push, PR and update-from-base are switched off for it, and the row menu offers only rename and archive.

So the user can watch an agent work on the server but cannot see what it changed, review it, or ship it without dropping into a terminal and doing it by hand. That undoes most of Initiative 1, whose loop is: agent works → review with line comments → push → PR → merge → update from base.

Server workspaces need the same panels and the same way out as local ones.

## Goal

When a server workspace is selected, the checkout-bound panels and the PR flow work against its folder on the server, the same as for a local workspace:

- **File tree.** The worktree's files, with git decorations, and opening a file to read it.
- **Changes and branch.** The Changes panel lists the worktree's changes, and the status-bar branch label shows its branch. Both refresh while the agent works.
- **Diff and review.**
  - The diff tab works.
  - Review Changes (⌘⌥R) works: file list against the merge base, diffs, viewed state, line comments, and sending them to the agent lane on the server.
- **PR flow.** The row shows ●dirty, ↑unpushed, ↓behind and the PR with its checks. Push, Create PR (prefilled from the held spec or the commits), Fix Failing Checks, Merge and Open on GitHub work. Git and `gh` run on the server as the server user.
- **Update from base.** Update, conflicts, the conflict dialog, Resolve with agent and Abort work for server workspaces.
- **Offline.** While disconnected, these panels say the server is offline instead of showing stale or local data. They come back on reconnect.

## Constraints

- **Same window, same panels (B1 of `server-workspaces`).** The renderer keeps its IPC; the desktop main process routes by the selected workspace's location, the way terminals already are. No second set of panels for remote.
- **Git and `gh` run where the code is.** On the server, as the server user, with that user's git credentials and `gh auth`. Frame stores no tokens (2026-11-09). The rules of `workspace-pr-flow` hold unchanged: never force-push, never push the base, never commit for the agent, argv only with free text on stdin.
- **Reuse, don't fork.** The server runs Initiative 1's own modules (`gitDiffManager` review/diff, `workspaceGitState` actions, `gitBranchesManager` helpers, `prFlow` rules) through the existing electron shim. Pure rules stay in `src/shared` and stay tested.
- **Responsiveness.**
  - Each file tree, status or diff request is one round trip, bounded in size: the review's 2 MB diff ceiling, and file reads capped.
  - Refreshes are driven by server-side watching or its polling, not by the desktop polling over SSH.
  - Visibility gating (`pollGate`) still applies on the desktop side.
- **Read-mostly files.** Reading files and the file tree's existing actions only. Editing server files from the desktop editor is out of this spec.
- **Local stays unchanged.** Local workspaces and the main checkout behave exactly as before, whether or not a server is connected.
- **Out of scope by decision.** Orchestration (2026-11-09 decision).

## Success Criteria

- When the user selects a connected server workspace, then the file tree shows its worktree's files with git decorations, and opening a file shows its content.
- When an agent on the server changes or commits files, then the Changes panel, the branch label and the row's ●/↑ badges update without user action within the usual refresh interval.
- When the user opens Review Changes on a server workspace, then the file list is complete against the merge base with `origin/<base>`, diffs render, viewed ticks persist, and sending comments reaches the workspace's agent lane on the server.
- When the user pushes, creates a PR, fixes failing checks or merges from a server workspace, then the git and `gh` commands run on the server, follow the `workspace-pr-flow` rules, and the row shows the resulting PR state.
- When the user runs Update from base on a server workspace, then the merge happens on the server. On conflicts, the dialog, Resolve with agent and Abort behave as they do locally.
- When the server is disconnected, then a selected server workspace's panels say it is offline. After reconnecting they show current data again.
- When `gh` is missing or not signed in on the server, then PR actions say so, naming the server.
- When local workspaces are used, with or without a server connected, then nothing changes for them.
- When `npm test` runs, then existing tests pass, and any new pure routing or protocol logic has unit tests.

## Out of Scope

- Editing and saving server files from the desktop editor
- Spec lists and spec commands for specs held in server workspaces (spec-in-workspace across locations)
- Installing and updating Frame Server from the desktop
- Copying gitignored files (`copyFiles`) and the file sync
- Moving a workspace between the Mac and the server
- Verifying node-pty on Linux (tracked separately on a real server)
- A browser or phone client

## Open Questions

- **How panel calls reach the server.** Options:
  - (a) Route the existing IPC channels in desktop main by the workspace's location, with one server method per channel group (`files.*`, `git.*`, `review.*`, `pr.*`, `update.*`) wrapping the same main modules on the server.
  - (b) A generic "remote invoke" that forwards any whitelisted IPC channel to the server's copy of the handler.
- **Live refresh of Changes and badges.** Options:
  - (a) The server watches the selected server workspace (gitStatusManager's watcher there) and pushes status events.
  - (b) The desktop asks on a gated interval and on focus.
- **Where the PR flow's `gh` runs.** Options:
  - (a) Always on the server, where the branch and its credentials are.
  - (b) On the desktop against the remote repo, after the server pushes.
