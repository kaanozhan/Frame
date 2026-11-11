
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
