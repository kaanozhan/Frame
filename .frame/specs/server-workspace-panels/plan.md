# Plan — Panels for server workspaces

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 File tree actions on server workspaces.** In this spec the tree is **read-only**: you can browse it and open files. Rename, paste and delete say "File actions on server workspaces come in a later update." Agents do most file changes, and the server has no trash, so delete would be permanent. Rejected: rename/paste plus a permanent delete after confirmation.

Business (silent):
- **Editor.** A server file opens in the editor read-only with a note, and Save is refused with "Editing server files comes in a later update". Editing is out of scope by spec.
- **Branch picker.** It lists and switches branches for a server workspace through the same path routing as the other git calls.
- **Offline.** A selected server workspace whose server is not connected shows "<host> is offline — reconnect to see this workspace" in the file tree. Panel calls answer with the same offline error instead of local or stale data.
- **Commands.** The row menu and palette offer the full PR flow, review and update for server workspaces. The `selectedLocalWorkspace` guards added by `server-workspaces` go away.

Technical (asked):
- **T1 How calls reach the server.** Explicit routing in desktop main:
  - File and git calls are routed **by path**: a root or file path that is a server workspace's folder, or lies under one.
  - Workspace actions are routed **by id** (`serverLocation`).
  - Both go through grouped server methods (`files.*`, `git.*`, `review.*`, `pr.*`, `update.*`). Every forwarded call is visible.

  Rejected: a generic channel forwarder. It would need a whitelist, and handlers that reply through `event.sender` do not forward generically.
- **T2 Live refresh.** The **server watches**:
  - `git.watch` starts the server's own `gitStatusManager` watcher on the selected server workspace. Its `GIT_STATUS_DATA` comes back as a `git.status` event, which the desktop forwards unchanged.
  - The server's `workspaceGitState` (3-minute poller plus actions) pushes `pr.state` with `gh` run on the server. The desktop merges it into the project's `WORKSPACE_GIT_STATE`.

  Rejected: the desktop polling over SSH.
- **T3 Where `gh` runs.** Always on the server, where the branch and its credentials are. The merged payload carries the server's `gh` access separately, so a missing or unauthenticated `gh` is reported naming the server. Rejected: the desktop's `gh` after a server push.
- **T4 Test posture.** Pure logic only, following the testing record: path → server root, and the git-state payload merge.

Technical (silent):
- **Reuse.** The server runs Initiative 1's modules through the existing shim:
  - `fileTree.getFileTree`
  - `fileEditor.readFile`, with the read capped at 2 MB
  - `gitStatusManager`
  - `gitDiffManager`: `reviewFiles`, `reviewFileDiff`, and a new exported `gitDiff` extracted from the `GET_GIT_DIFF` handler
  - `gitBranchesManager`: `loadBranches`, `switchBranch`
  - `workspaceGitState`: `refresh`, `push`, `prDraft`, `prCreate`, `merge`, `updateFromBase`, `abortUpdate`
- **One router module on the desktop.** `src/main/serverPanels.js` holds the remote branch of every routed handler: `rootOf(path)`, the calls and the event forwarding. Each existing handler gains one early `if (remote) return serverPanels.x(...)`.
- **Roots.** `workspaceManager.serverRoots()` returns the known server workspace folders with their host and connection state. The match is separator-safe, so `/a/b` does not match `/a/bc`.
- **Git status singleton.** The desktop's `gitStatusManager` watches one root at a time. Watching a server root stops the local watcher and starts `git.watch`; watching a local root stops the server watch.
- **In-flight overlap.** Some of these files also sit in the footprints of the stalled `audit-q3-*` specs (planned or implementing since July/August). The changes here are additive routing guards only.

### Data shapes

```
serverRootFor(path, roots[]) → root | null          (equal to or under root, separator-safe)
mergeGitStatePayloads(local, server, projectPath) → { projectPath, access, serverAccess, workspaces: { ...local, ...server } }
Server methods:
  files.tree { root } → FileNode[]        files.read { filePath } → { content|error, extension, fileName, readOnly: true }
  git.watch { root } / git.unwatch / git.refresh        git.diff { projectPath, relPath, staged } → { diff, isBinary, isUntracked }
  git.branches { root } / git.switch { root, branchName }
  review.files { root, base } / review.fileDiff { root, mergeBase, path, oldPath, untracked }
  pr.refresh { projectPath } / pr.push / pr.draft / pr.create / pr.merge { projectPath, id, … }
  update.run / update.abort { projectPath, id }
Server events: git.status (GIT_STATUS_DATA payload), pr.state (WORKSPACE_GIT_STATE payload)
```

## Files

- `src/shared/serverRouting.js` — **Modified**: `serverRootFor`, `mergeGitStatePayloads`
- `test/serverRouting.test.js` — **Modified**: tests for both
- `src/server/panels.js` — **New**: the `files.*`, `git.*`, `review.*`, `pr.*` and `update.*` methods, plus the `git.status` and `pr.state` events
- `src/server/index.js` — **Modified**: register panels
- `src/main/gitDiffManager.js` — **Modified**: export `gitDiff` (the `GET_GIT_DIFF` body); route `GET_GIT_DIFF`, `REVIEW_FILES` and `REVIEW_FILE_DIFF` by path
- `src/main/serverPanels.js` — **New**: desktop router (root lookup, calls, offline errors, event forwarding)
- `src/main/workspaceManager.js` — **Modified**: `serverRoots()`
- `src/main/fileTree.js` — **Modified**: route `LOAD_FILE_TREE` by path; refuse rename/paste/trash under a server root
- `src/main/fileEditor.js` — **Modified**: route `READ_FILE` by path; refuse `WRITE_FILE` under a server root
- `src/main/gitStatusManager.js` — **Modified**: route `WATCH_GIT_STATUS` / `REFRESH_GIT_STATUS` / `UNWATCH_GIT_STATUS` by the watched root
- `src/main/gitBranchesManager.js` — **Modified**: route `LOAD_GIT_BRANCHES` / `SWITCH_GIT_BRANCH` by path
- `src/main/workspaceGitState.js` — **Modified**: merge the server's `pr.state` into the refresh payload; route push / draft / create / merge / update / abort by id
- `src/renderer/workspacePr.js` — **Modified**: access per location (`serverAccess` for server rows, messages naming the host); badges and menu items for server rows
- `src/renderer/workspaceSection.js` — **Modified**: full menu for server rows; drop `selectedLocalWorkspace`
- `src/renderer/index.js` — **Modified**: load the file tree for server workspaces; offline placeholder; commands back on `selectedWorkspace`
- `src/renderer/fileTreeUI.js` — **Modified**: read-only actions under a server root
- `src/renderer/editor.js` — **Modified**: read-only mode with a note for server files
- `src/renderer/styles/components/workspaces.css` — **Modified**: editor read-only note

## Footprint

- src/shared/serverRouting.js
- test/serverRouting.test.js
- src/server/panels.js
- src/server/index.js
- src/main/gitDiffManager.js
- src/main/serverPanels.js
- src/main/workspaceManager.js
- src/main/fileTree.js
- src/main/fileEditor.js
- src/main/gitStatusManager.js
- src/main/gitBranchesManager.js
- src/main/workspaceGitState.js
- src/renderer/workspacePr.js
- src/renderer/workspaceSection.js
- src/renderer/index.js
- src/renderer/fileTreeUI.js
- src/renderer/editor.js
- src/renderer/styles/components/workspaces.css

## Dependencies

None.

## Sequencing

1. **Pure rules.** Add to `src/shared/serverRouting.js`, with tests in `test/serverRouting.test.js`:
   - `serverRootFor`: separator-safe match of a path to a root;
   - `mergeGitStatePayloads`: local and server rows, `serverAccess`.
2. **Server panels.** In `src/server/panels.js`, registered in `src/server/index.js`:
   - `files.tree` / `files.read` (read capped at 2 MB);
   - `git.watch` / `git.unwatch` / `git.refresh` / `git.diff` / `git.branches` / `git.switch`;
   - `review.files` / `review.fileDiff`;
   - `pr.refresh` / `pr.push` / `pr.draft` / `pr.create` / `pr.merge`;
   - `update.run` / `update.abort`;
   - the `git.status` and `pr.state` events.

   Also export `gitDiff` from `src/main/gitDiffManager.js` (the `GET_GIT_DIFF` body).
3. **Desktop router for files and git.**
   - Add `src/main/serverPanels.js` and `workspaceManager.serverRoots()`.
   - Route by path:
     - `LOAD_FILE_TREE` and `READ_FILE`;
     - `GET_GIT_DIFF`, `REVIEW_FILES` and `REVIEW_FILE_DIFF`;
     - `LOAD_GIT_BRANCHES` and `SWITCH_GIT_BRANCH`;
     - `WATCH_GIT_STATUS` / `REFRESH_GIT_STATUS` / `UNWATCH_GIT_STATUS`, with `git.status` forwarded as `GIT_STATUS_DATA`.
   - Under a server root, `WRITE_FILE` and file-tree rename/paste/trash are refused.
   - Disconnected calls answer "offline".
4. **PR flow and update from base.**
   - `workspaceGitState`: `WORKSPACE_GIT_REFRESH` also refreshes the server project and merges `pr.state` (`mergeGitStatePayloads`); push / draft / create / merge / update / abort for a server workspace route by id.
   - `workspacePr.js`: per-location access and blocked reasons naming the host, badges and menu items for server rows.
   - `workspaceSection.js`: full menu for server rows.
   - `src/renderer/index.js`: commands back on `selectedWorkspace`.
5. **Renderer panels for server workspaces.**
   - `src/renderer/index.js` loads the file tree for a connected server workspace and shows the offline placeholder otherwise.
   - `fileTreeUI.js` marks actions under a server root as read-only.
   - `editor.js` opens server files read-only with a note (style in `workspaces.css`).
