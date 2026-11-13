---
keywords: server workspace, remote panels, file tree, changes, diff, review, pull request, push, update from base
related: server-workspaces, workspace-review, workspace-pr-flow, update-from-base, workspaces
---
Server workspaces got the same panels and way out as local ones.

How it works:
- Desktop main routes panel calls explicitly:
  - File and git calls go by path, via `serverPanels.rootOf` (`serverRootFor` over `workspaceManager.serverRoots()`, the known server folders rather than the local disk).
  - PR-flow and update actions go by workspace id (`serverLocation`).
- Frame Server answers through `src/server/panels.js`, which runs Initiative 1's own modules there:
  - `files.tree/read`: read-only, 2 MB cap;
  - `git.watch/unwatch/refresh/diff/branches/switch`;
  - `review.files/fileDiff`;
  - `pr.refresh/push/draft/create/merge`, `update.run/abort` (the server's `workspaceGitState`, with `gh` as the server user).
- The server pushes `git.status` and `pr.state`:
  - `gitStatusManager` keeps one watch, local or remote, and re-watches on reconnect.
  - `workspaceGitState` merges the server's state into `WORKSPACE_GIT_STATE` (`mergeGitStatePayloads`, with the server's `gh` kept as `serverAccess`).
- Renderer:
  - Server rows get badges and full menus; `gh` problems name the host.
  - The file tree loads for connected server workspaces and says "<host> is offline" otherwise.
  - The editor opens server files read-only.
  - File actions under a server root are refused up front.

Why this path:
- Explicit routing (rejected: a generic IPC forwarder, which needs a whitelist and breaks `event.sender` replies).
- The server watches and pushes (rejected: desktop polling over SSH).
- `gh` runs on the server, where the branch and credentials are (rejected: desktop `gh` after a push).
- Read-only tree (rejected: rename/paste plus permanent delete, since the server has no trash).

Rules for future work:
- Any new checkout-bound IPC needs a remote branch in its handler, through `serverPanels`, or it will read the wrong machine.
- While disconnected, routed calls answer "offline" and never fall back to local.
- Writes to server files stay refused until the editing spec.

Followups: editing server files and file-tree actions on the server; specs held in server workspaces; node-pty on a real Linux server.

Chain: spec.md → plan.md → tasks.md → outcome.md
