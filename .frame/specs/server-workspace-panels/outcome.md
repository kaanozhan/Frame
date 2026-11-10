
## T01 — Pure rules: path → server root, git-state merge

Added serverRootFor (longest separator-safe match of a root or file path to a server workspace folder; trailing slashes ignored) and mergeGitStatePayloads (local and server rows in one WORKSPACE_GIT_STATE payload for the desktop project, the server's gh access kept as serverAccess, null when no server) to src/shared/serverRouting.js, with two tests in test/serverRouting.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Server panels: files, git, review

Added src/server/panels.js (registered in src/server/index.js): files.tree, files.read (2 MB cap, readOnly), git.watch/unwatch/refresh with the server gitStatusManager's GIT_STATUS_DATA broadcast as git.status, git.diff, git.branches/switch, review.files/fileDiff. Extracted gitDiff from the GET_GIT_DIFF handler in src/main/gitDiffManager.js and exported startWatching/stopWatching/pushStatus from src/main/gitStatusManager.js so the server can drive them.

_Captured: 2026-11-10 · 5 file change(s)_

---

## T03 — Server PR flow and update methods

Added pr.refresh / pr.push / pr.draft / pr.create / pr.merge and update.run / update.abort to src/server/panels.js, all running the server's own workspaceGitState (git and gh as the server user, workspace-pr-flow rules unchanged); its WORKSPACE_GIT_STATE pushes are broadcast as pr.state. Added workspaceGitState.setWatched so pr.refresh makes the server project the polled and pushed one.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T04 — Desktop routing for the file tree and file reads

Added src/main/serverPanels.js (rootOf via workspaceManager.serverRoots() and serverRootFor, call with an '<host> is offline' error while disconnected, read-only messages) and workspaceManager.serverRoots() (known server workspace folders, last known ones kept while offline). LOAD_FILE_TREE (fileTree.js) and READ_FILE (fileEditor.js) route by path to files.tree/files.read; WRITE_FILE and file-tree rename/paste/trash are refused under a server root (paste checks source and destination). An offline tree answers [] (the renderer shows the offline note in T08).

_Captured: 2026-11-10 · 4 file change(s)_

---

## T05 — Desktop routing for diff, review, branches and git status

GET_GIT_DIFF, REVIEW_FILES and REVIEW_FILE_DIFF (gitDiffManager.js) and LOAD_GIT_BRANCHES / SWITCH_GIT_BRANCH (gitBranchesManager.js) route by path to git.diff / review.* / git.branches / git.switch, answering in each channel's usual shape with the offline error when disconnected. gitStatusManager keeps one watch: watching a server root stops the local watcher and starts git.watch on the server, its git.status events reach the window as GIT_STATUS_DATA for that root only, a reconnect re-issues the watch, REFRESH asks git.refresh, and watching a local root unwatches the server.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T06 — PR flow and update from base routed in main

workspaceGitState keeps the server's pr.state per desktop project and merges it into every WORKSPACE_GIT_STATE push (mergeGitStatePayloads, serverAccess kept apart); WORKSPACE_GIT_REFRESH refreshes the local project and asks the server's pr.refresh in parallel, returning the merged payload; push, draft, create, merge, update and abort for a server workspace go to the server by id (offline answers '<host> is offline — reconnect to continue.'); server state is dropped on disconnect.

_Captured: 2026-11-10 · 1 file change(s)_

---

## T07 — PR flow on for server rows in the renderer

workspacePr.access(ws) / prBlockedReason(ws) now take the workspace: server workspaces use the server's gh access (serverAccess) and their messages name the host ('… not signed in on box — run gh auth login there'); offline server rows show no badges or PR items (their last state would be stale); server rows get the same badges and row-menu items as local ones. workspaceSection offers the full menu for server rows and selectedLocalWorkspace is gone; the palette's review/update/push/PR commands use selectedWorkspace again.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T08 — Server workspaces in the panels

src/renderer/index.js loads the file tree (and with it the routed git watch) for a connected server workspace, shows '<host> is offline — reconnect…' in the tree otherwise, and reloads or blanks it when the link comes back or drops while one is selected. fileTreeUI refuses rename, delete and paste under a server workspace up front (before the 'Move to Trash?' confirm) with 'File actions on server workspaces come in a later update.'. The editor opens server files read-only: the textarea is read-only, Save is disabled with a tooltip, the status reads 'Read-only · on the server', a forced save explains why, and a failed server read is surfaced as an error toast. Style for the read-only status in workspaces.css.

_Captured: 2026-11-10 · 4 file change(s)_

---
