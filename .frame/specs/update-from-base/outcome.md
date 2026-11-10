
## T01 — Pure update rules in prFlow.js

Added parseConflicts, updateMenuState, conflictPrompt and updateMessage to src/shared/prFlow.js with four tests in test/prFlow.test.js. updateMenuState labels a merge with no conflicted files left 'Finish Merge with Agent' (not in the plan) so a merge whose conflicts are staged but uncommitted still has a way out.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Git helpers for the update

Added trackedDirtyCount, mergeInProgress, conflictedFiles (raw -z list for prFlow.parseConflicts), mergeRef (merge --no-edit, resolves { ok, error }) and abortMerge to src/main/gitBranchesManager.js, all argv in the worktree with the push timeout for merge/abort. A conflicting merge reports git's generic 'Command failed' text because git writes conflict notices to stdout; callers detect conflicts through MERGE_HEAD and the unmerged list, not the message.

_Captured: 2026-11-10 · 1 file change(s)_

---

## T03 — updateFromBase and abortUpdate in main

Added updateFromBase and abortUpdate to src/main/workspaceGitState.js with IPC channels WORKSPACE_UPDATE_FROM_BASE / WORKSPACE_UPDATE_ABORT in src/shared/ipcChannels.js; rowState now carries merging and conflicts. The update returns an existing conflict instead of starting another, refuses tracked-dirty worktrees, fetches (falling back to the last fetched origin/<base> with a note), reports up to date at 0 behind, merges, and aborts a merge that stopped without conflicts; every path ends in refresh(projectPath).

_Captured: 2026-11-10 · 2 file change(s)_

---
