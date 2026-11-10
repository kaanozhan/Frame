# Plan — Update workspace from base

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 How the base comes in:** always `git merge --no-edit origin/<base>` into the workspace branch. History is kept, so a pushed branch with an open PR never needs a force-push, which fits "never force-push" (`workspace-pr-flow`). Rejected: rebase when unpushed and merge otherwise; that means two behaviours, and a conflicted rebase is harder to hand over and abort.
- **B2 Uncommitted changes:** refuse when the worktree has **tracked** uncommitted changes, with "Commit or stash your changes first". Untracked files do not block; git itself refuses a merge that would overwrite one. As a result, `git merge --abort` after a conflict never touches the user's own work. Rejected: auto-stash and restore, because a conflicting stash restore stacks a second conflict on the first.
- **B3 Conflict hand-off:**
  - Right after a conflicted update, a dialog lists the conflicted files and offers **Resolve with agent**, **Abort update** or **Later**.
  - The row also carries the state: a "⚠ merging" badge, plus "Resolve Conflicts with Agent (n)" and "Abort Update" in the row menu and the palette. Closing the dialog therefore never hides the state.
  - Rejected: badge and menu only, which is easy to miss at the moment it happens.

Business (silent):
- **Fetch first.** The ↓n badge is computed against the last-fetched `origin/<base>`, and the poller never fetches (drift found in the evidence pass). "Update from <base>" therefore always shows for a workspace that is not merging, with "(n)" when n is known. The action fetches first and then decides: up to date, updated, or conflict.
- **Fetch failure.** If the fetch fails (offline) but `origin/<base>` exists locally, the update proceeds against it and says so. If `origin/<base>` does not exist at all, it stops with an error.
- **No shortcut.** The actions are reachable from the row menu and the palette (`workspace.updateFromBase`, `workspace.resolveConflicts`, `workspace.abortUpdate`).
- **Choosing the lane.** The conflict prompt goes to the workspace's most recently active agent lane, else a new one. This is the same rule as the review's default "Send to" (`workspace-review`).
- **Nothing is pushed.** The success message says so ("not pushed — push when ready").

Technical (asked):
- **T1 Test posture:** pure logic only, matching the testing record (`src/shared` pure modules under `test/*.test.js`).

Technical (silent):
- **Git helpers in `gitBranchesManager.js`.** All are argv, in the worktree:
  - `trackedDirtyCount(cwd)` (`status --porcelain --untracked-files=no`)
  - `mergeInProgress(cwd)` (`rev-parse -q --verify MERGE_HEAD`)
  - `conflictedFiles(cwd)` (`diff --name-only --diff-filter=U -z`)
  - `mergeRef(cwd, ref)` (`merge --no-edit <ref>`, returning `{ ok, error }` and never throwing)
  - `abortMerge(cwd)` (`merge --abort`)
  - The fetch reuses the existing `fetchBranch(cwd, base)`.
- **Actions in `workspaceGitState.js`.** Next to push, prCreate and merge it gains `updateFromBase(projectPath, id)` and `abortUpdate(projectPath, id)`. Both re-push state through `refresh(projectPath)`. `rowState` gains `merging` (bool) and `conflicts` (paths).
- **Pure rules in `src/shared/prFlow.js`:**
  - `parseConflicts(stdout)` reads the `-z` list;
  - `updateMenuState({ behind, merging, conflicts, base })` decides which update items show and how they are labelled;
  - `conflictPrompt({ branch, base, files })` builds the agent prompt;
  - `updateMessage(result)` builds the user-facing sentence.
- **Shared lane helper.** The lane choice moves into an exported `workspaceAgentLanes(projectPath, workspaceId)` in `workspacePr.js`, and `reviewSection.js` uses it instead of its private copy.
- **Review refresh.** `reviewSection.js` subscribes to `workspacePr.onChange`. When its workspace's state key (`unpushed`, `behind`, `dirty`, `merging`) changes, it reloads the file list silently. An update or abort refreshes the row state, which then refreshes an open review, with no explicit hook.
- **Conflict dialog.** A new `#update-conflict-modal` in `index.html`, built from the same `task-run-modal` markup as `#create-pr-modal`.
- **In-flight spec overlap.** `src/renderer/index.js` and `src/shared/ipcChannels.js` sit in the footprint of `audit-q3-cross-platform` (planned since 2026-07-20, not started). This plan only adds new lines there, so no collision is expected.

### Data shapes

```
UpdateResult =
  | { state: 'updated', commits, fetchNote? }
  | { state: 'up-to-date', fetchNote? }
  | { state: 'conflict', files: string[] }
  | { state: 'dirty', count }
  | { error }
RowState += { merging: boolean, conflicts: string[] }
```

## Files

- `src/shared/prFlow.js` — **Modified**: `parseConflicts`, `updateMenuState`, `conflictPrompt`, `updateMessage`
- `test/prFlow.test.js` — **Modified**: tests for the four rules
- `src/main/gitBranchesManager.js` — **Modified**: `trackedDirtyCount`, `mergeInProgress`, `conflictedFiles`, `mergeRef`, `abortMerge`
- `src/main/workspaceGitState.js` — **Modified**: `updateFromBase`, `abortUpdate`, `merging`/`conflicts` in `rowState`, IPC handlers
- `src/shared/ipcChannels.js` — **Modified**: `WORKSPACE_UPDATE_FROM_BASE`, `WORKSPACE_UPDATE_ABORT`
- `src/renderer/workspacePr.js` — **Modified**: update/resolve/abort menu items and actions, the merging badge, the conflict dialog, `workspaceAgentLanes`
- `src/renderer/reviewSection.js` — **Modified**: uses `workspaceAgentLanes`; reloads on its workspace's state change
- `src/renderer/index.js` — **Modified**: palette commands `workspace.updateFromBase`, `workspace.resolveConflicts`, `workspace.abortUpdate`
- `index.html` — **Modified**: `#update-conflict-modal`
- `src/renderer/styles/components/workspaces.css` — **Modified**: `.ws-badge.merging`, conflict list in the dialog

## Footprint

- src/shared/prFlow.js
- test/prFlow.test.js
- src/main/gitBranchesManager.js
- src/main/workspaceGitState.js
- src/shared/ipcChannels.js
- src/renderer/workspacePr.js
- src/renderer/reviewSection.js
- src/renderer/index.js
- index.html
- src/renderer/styles/components/workspaces.css

## Dependencies

None.

## Sequencing

1. **Pure rules.** In `src/shared/prFlow.js`, with tests in `test/prFlow.test.js`:
   - `parseConflicts` (the `-z` list);
   - `updateMenuState` (no update items for a missing workspace; "Update from <base> (n)" or "Update from <base>" when not merging; "Resolve Conflicts with Agent (n)" and "Abort Update" when merging);
   - `conflictPrompt` (names the base, the branch and every file; resolve, run the tests, complete the merge with `git commit --no-edit`, don't push);
   - `updateMessage` (updated / up to date / dirty / error, plus the fetch note).
2. **Update and abort in main.**
   - Git helpers in `gitBranchesManager.js`.
   - In `workspaceGitState.js`, `updateFromBase`, in this order:
     1. If a merge is already in progress, return the conflict.
     2. If there are tracked dirty files, return `dirty`.
     3. Fetch the base, falling back to the local `origin/<base>` with a note.
     4. Count `HEAD..origin/<base>`; 0 means up to date.
     5. Merge; on failure with conflicts, return `conflict` and the files; on failure without conflicts, abort the merge if one started and return the error.
   - `abortUpdate` runs `merge --abort` only while `MERGE_HEAD` exists.
   - `rowState` gains `merging` and `conflicts`.
   - IPC channels in `ipcChannels.js`. Every path ends in `refresh(projectPath)`.
3. **Update from the row and the palette.**
   - In `workspacePr.js`: menu items from `updateMenuState`, the `updateFromBase(ws)` action with a toast from `updateMessage`, and the "⚠ merging" badge (`workspaces.css`).
   - `workspace.updateFromBase` in `index.js`.
   - `reviewSection.js` reloads when its workspace's state key changes.
4. **Conflicts.**
   - The `#update-conflict-modal` dialog (in `index.html`, styled in `workspaces.css`) opens after a conflicted update and lists the files. Its buttons are Resolve with agent, Abort update and Later.
   - `resolveConflicts(ws)` dispatches `conflictPrompt` to the lane from `workspaceAgentLanes` (most recently active, else new).
   - `abortUpdate(ws)` confirms, then calls `WORKSPACE_UPDATE_ABORT`.
   - The row-menu items and the palette commands `workspace.resolveConflicts` / `workspace.abortUpdate` run the same actions.
   - `reviewSection.js` switches to `workspaceAgentLanes`.
