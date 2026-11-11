
## T01 — Close option injection and fix the push target

Added prFlow.pushArgs: every push names `origin refs/heads/B:refs/heads/B`, adds -u when the upstream is not origin/B (re-pointing a wrong one), and refuses invalid names and the base; workspaceGitState.push uses it, with the remote's default branch standing in for a missing base; gitBranchesManager.pushBranch now takes that argv. Branch text is validated with isValidBranchName in workspaceManager.create (base and branch), gitBranchesManager.fetchBranch and workspaceRegistry.rename, and the rename runs `branch -m -- old new`; gitDiffManager refuses a non-commit mergeBase and an invalid base. Deviation from the plan: a branch whose upstream is origin/<base> is not refused — its push is redirected to its own name and its upstream re-pointed, because branching from origin/main is common; the goal (nothing reaches the base) holds. New test/workspaceGit.test.js drives the real modules against temp repos with a bare remote; its git writes retry on index.lock because Frame's background git-state read (started by every workspace mutation) can hold the lock — Followup: background reads should use `git --no-optional-locks` so agents' own git commands never collide with Frame's polling.

_Captured: 2026-11-11 · 9 file change(s)_

---
