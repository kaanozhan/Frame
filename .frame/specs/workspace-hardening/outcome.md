
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
