
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

## T04 — Update from the row and the palette

Added 'Update from <base> (n)' to the workspace row menu from prFlow.updateMenuState, the updateFromBase(ws) action with an in-flight guard and a toast from updateMessage, a red '⚠ merging' badge, and the workspace.updateFromBase palette command (hidden while merging); reviewSection reloads its file list when its workspace's row key (unpushed, behind, dirty, merging) changes. Only the update:run item is rendered in this task; the resolve/abort items arrive with their actions in T05. Files: workspacePr.js, index.js, reviewSection.js, workspaces.css, plus the bundle build.

_Captured: 2026-11-10 · 5 file change(s)_

---

## T05 — Conflicts: dialog, resolve with agent, abort

Added #update-conflict-modal to index.html (files list, Later / Abort update / Resolve with agent; Esc and backdrop mean Later) opened after a conflicted update, and resolveConflicts / abortUpdate in workspacePr.js reachable from the dialog, the row menu (now rendering every updateMenuState item) and the palette commands workspace.resolveConflicts / workspace.abortUpdate. Moved the agent-lane choice into workspacePr.workspaceAgentLanes and pointed reviewSection's 'Send to' at it. Abort from the dialog skips the confirm (the click is the confirmation); from the menu or palette it asks first.

_Captured: 2026-11-10 · 6 file change(s)_

---
