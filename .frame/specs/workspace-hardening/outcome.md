
## T01 — Close option injection and fix the push target

Added prFlow.pushArgs: every push names `origin refs/heads/B:refs/heads/B`, adds -u when the upstream is not origin/B (re-pointing a wrong one), and refuses invalid names and the base; workspaceGitState.push uses it, with the remote's default branch standing in for a missing base; gitBranchesManager.pushBranch now takes that argv. Branch text is validated with isValidBranchName in workspaceManager.create (base and branch), gitBranchesManager.fetchBranch and workspaceRegistry.rename, and the rename runs `branch -m -- old new`; gitDiffManager refuses a non-commit mergeBase and an invalid base. Deviation from the plan: a branch whose upstream is origin/<base> is not refused — its push is redirected to its own name and its upstream re-pointed, because branching from origin/main is common; the goal (nothing reaches the base) holds. New test/workspaceGit.test.js drives the real modules against temp repos with a bare remote; its git writes retry on index.lock because Frame's background git-state read (started by every workspace mutation) can hold the lock — Followup: background reads should use `git --no-optional-locks` so agents' own git commands never collide with Frame's polling.

_Captured: 2026-11-11 · 9 file change(s)_

---

## T02 — Make archive keep commits

Added gitBranchesManager.headState (symbolic-ref, rev-parse, `rev-list --count HEAD --not --branches --remotes --tags`) and include it as `head` in workspaceManager.status. archive now re-reads it after the commit/discard step: commits no branch, remote branch or tag holds stop the archive with `{ headOff }` and the worktree stays; `rescue: true` first creates `<branch>-rescue-<shortsha>` at HEAD, then removes the worktree. The server route passes `rescue` through. archiveQueued puts archive behind the per-project queue; workspaceGitState.merge uses it and reports `not archived: N commits not on any branch would be lost` instead of removing. Archive's add/commit/reset/clean run with ARCHIVE_TIMEOUT_MS (120 s). The rescue dialog in the renderer is T03.

_Captured: 2026-11-11 · 5 file change(s)_

---

## T03 — Ask before archiving unreachable commits and report queued merges

The archive flow reads `status.head` and, when commits no branch holds would go with the folder (or a commit about to be made on a detached HEAD), shows a new rescue dialog before any terminal is closed: "keep them on `<branch>-rescue-<shortsha>`" or Cancel, with focus on Cancel and Enter doing what the focused button says. A `headOff` reply (commits made after the check) asks the same and retries with `rescue: true`. Added prFlow.mergeLanded; workspaceGitState.merge reads the PR back after `gh pr merge` and, when it has not merged (merge queue, auto-merge, unreadable), returns `queued: true` with no fast-forward and no archive; workspacePr.js says so. No CSS change was needed (the dialog reuses the archive dialog's classes).

_Captured: 2026-11-11 · 7 file change(s)_

---

## T04 — Make guards fail closed

trackedDirtyCount now returns `{ count, error }` and updateFromBase refuses with "Could not check for uncommitted changes, so nothing was merged" when the check fails. Abort Update first checks `merge-base --is-ancestor MERGE_HEAD origin/<base>` (new gitBranchesManager.mergeHeadIn) and leaves any other merge in place with a reason. New src/shared/gitMissing.js (isGitMissing: ENOENT only counts as "git missing" when the working directory exists) replaces the ad-hoc checks in gitBranchesManager, gitStatusManager and gitDiffManager, so a removed workspace folder no longer switches the file-tree status or the review diff off for the session.

_Captured: 2026-11-11 · 8 file change(s)_

---

## T05 — Give every workspace a real base

Added prFlow.baseForBranch (the branch's upstream when it is another valid branch, else the default branch) and IPC WORKSPACE_BASE_FOR_BRANCH backed by workspaceManager.baseForBranch (upstream read with `for-each-ref --format=%(upstream:short) refs/heads/<branch>`, so no tag can shadow the branch). The New Workspace dialog shows Base in both modes, below Branch for an existing branch, and prefills it when a branch is chosen until the user types their own; create stores it (validated) and, without one, stores what the dialog would have suggested. Records already stored with `base: null` read as the remote's default branch in listLocal and in every workspaceGitState path (rowState, push, PR create, merge fast-forward, update, abort) through baseOf; nothing is migrated. Rename refuses a branch that has an upstream or an origin/<branch>, saying to rename it on GitHub first.

_Captured: 2026-11-11 · 9 file change(s)_

---

## T06 — Fix registry and filesystem edges

L6: projectRegistry.removeProject keeps a removed project's workspace records under the additive top-level key `detachedWorkspaceRecords`, and addProject restores them; the removal confirmation lists the workspace folders that stay on disk (live-checked). L7: workspaceRegistry.reconcile takes `{ canon }` and the manager passes realpath, so a symlinked workspaces root no longer marks every workspace missing. L9: copyFiles copies with `verbatimSymlinks`. L10: a trailing `/**` also selects the collapsed folder itself, and copyFilesMatch.dirsToExpand + gitBranchesManager.listIgnoredIn list files inside a fully ignored folder that an anchored pattern reaches into (unanchored patterns never expand a folder, and node_modules/.git never). L13c: create records the start commit and, when it fails after making the branch (worktree add or registry write), deletes it with `update-ref -d refs/heads/<b> <startSha>` — only while it still points there. L13e: refreshWorkspaceWatchers drops the project's specLocations entry before the watched-project early return; specRoot is exported for the test.

_Captured: 2026-11-11 · 13 file change(s)_

---

## T07 — Make dialogs do what the focused control says

New src/renderer/modalKeys.js: enterSubmits(target, keys) — Enter confirms only from a field; on a button, select or link the browser's own handling stands (Enter on Cancel cancels), and a textarea needs ⌘/Ctrl. The archive dialog and the New Workspace dialog use it. New src/renderer/scopeGuard.js with exclusive(fn, { onBusy, queue }): Create PR is exclusive from the moment it is invoked (draft loading included) — a second ⌘⌥P refocuses the open dialog instead of binding a second set of listeners; the conflict dialog is exclusive with `queue`, so two updates that stop on conflicts take turns and each click answers one.

_Captured: 2026-11-11 · 6 file change(s)_

---

## T08 — Keep work after an await on its own workspace

scopeGuard.js gains scopeGuard(scope, current) (still / sameProject) and selectionChange(prev, next) (same / meta / switch); state.js gains currentScope() and updateWorkspaceMeta({ branch, name }). runSetupThenAgent captures the selected workspace at its start and creates the setup and agent terminals for it explicitly (projectPath, workspaceId, cwd); it only enters their lanes while that workspace is still selected, and starts no agent after a project switch. The new-workspace submit selects nothing when the project changed during the create. The conflict follow-up (resolve / abort) carries the project the update started in; resolve refuses to select a workspace of another project. workspaceSection.load keeps a pending reselect until a load for that project applies it (an overtaken load no longer loses the remembered workspace), and a renamed branch or name updates the selection in place instead of the no-op re-select that provisioned on every refresh.

_Captured: 2026-11-11 · 6 file change(s)_

---

## T09 — Keep review state through errors and edits

reviewModel.js gains applyFileList (a failed load keeps files, ticks and merge base and reports the error above the list), remainingAfterSend (only the comments a send carried leave the list), newSideLines + reanchor (when a file's diff reloads, a comment stays on its line if the quoted text is still there, follows the text to the nearest line if it moved, else is marked outdated — shown in the pending list and sent flagged by composeReviewPrompt) and pruneScopes. reviewSection.js keeps one comment box for the viewport's life, re-attached on every render: the typed text, caret and selection survive, and focus comes back only if the box had it (a blur followed by a re-attach in the same task does not count). Clicking another line or file, or editing another comment, keeps a non-empty draft as a pending comment; a draft whose line leaves the diff is kept and marked outdated. Counts and status are coerced/escaped in the review file list and the workspace row badges. Viewed ticks of workspaces that no longer exist are pruned when a review opens; saved terminal sessions of gone workspaces are pruned on every workspace list load, and a removed project's workspace session keys go with it.

_Captured: 2026-11-11 · 8 file change(s)_

---

## Findings — closing status

Every finding of spec.md is fixed; none was accepted unfixed.

| Id | Status | Task | Note |
|---|---|---|---|
| L1 | fixed | T01 | explicit `origin B:B` refspec; base refused; wrong upstream re-pointed (deviation: not refused) |
| L2 | fixed | T01 | rename validated, `branch -m --` |
| X1 | fixed | T01 | base/branch validated before any git in create (local and server route) |
| L3 | fixed | T02, T03 | headState, rescue branch dialog, archive-after-merge skips |
| L4 | fixed | T05 | base asked/prefilled; `base: null` resolved on read |
| L5 | fixed | T02 | merge archives through `archiveQueued` |
| L6 | fixed | T06 | records kept and restored; folders listed in the warning |
| L7 | fixed | T06 | canonical paths in reconcile |
| L8 | fixed | T04 | dirty-check error refuses |
| L9 | fixed | T06 | `verbatimSymlinks` |
| L10 | fixed | T06 | `dir/**` matches the folder; `dirsToExpand` |
| L11 | fixed | T02 | `ARCHIVE_TIMEOUT_MS` 120 s |
| L12 | fixed | T05 | pushed branch not renamed |
| L13a | fixed | T04 | abort only our merge |
| L13b | fixed | T03 | queued merge reported |
| L13c | fixed | T06 | compare-and-swap branch delete |
| L13d | fixed | T01 | mergeBase commit-id check, base validated |
| L13e | fixed | T06 | specLocations invalidated for every project |
| L14 | fixed | T04 | `isGitMissing` in three managers |
| R1 | fixed | T07 | `enterSubmits` |
| R2 | fixed | T07 | exclusive Create PR |
| R3 | fixed | T08 | setup and agent created for the new workspace explicitly |
| R4 | fixed | T09 | `applyFileList` |
| R5 | fixed | T09 | `remainingAfterSend` |
| R6 | fixed | T08 | captured project in create and conflict follow-ups |
| R7 | fixed | T07 | queued conflict dialog |
| R8 | fixed | T09 | one persistent comment box; drafts kept |
| R9 | fixed | T09 | `reanchor`, outdated flag |
| R10 | fixed | T08 | sticky reselect |
| R11 | fixed | T08 | `updateWorkspaceMeta` |
| R12 | fixed | T09 | counts coerced, status escaped |
| R14 | fixed | T09 | viewed and session keys pruned |

Follow-up from T01, done after the spec closed (2026-11-11, at the user's request): background git reads no longer take index.lock. `git status` runs with `--no-optional-locks` (execGitArgs for `status`/`diff`, gitStatusManager, gitDiffManager), and the conflict listing uses `ls-files -u` because `git diff` still refreshes the index under that flag on git 2.39. Verified by a test that stat-dirties a file and checks `.git/index` is not rewritten (it was before), and by dropping the index.lock retry from test/workspaceGit.test.js: 10/10 runs passed without it. Limit: the review's `git diff` (run when a review loads) still refreshes the index.
