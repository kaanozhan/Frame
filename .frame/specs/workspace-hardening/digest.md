---
keywords: workspaces, hardening, push target, option injection, archive, rescue branch, base branch, review state, dialogs, scope guard
related: workspaces, spec-in-workspace, workspace-pr-flow, workspace-review, update-from-base, server-hardening
---
The local workspace flows now hold their rules at the edges, not only in the pure rules.

**Git safety.**
- Every push names its target (`prFlow.pushArgs`: `origin refs/heads/B:refs/heads/B`); the base is never pushed, and a wrong upstream is re-pointed.
- Branch and ref text is validated with `isValidBranchName` at create, fetch, rename and review, and rename runs `branch -m -- old new`. A base of `--upload-pack=<cmd>` no longer reaches git (X1).
- Archive stops on commits no branch holds (`git.headState`) and offers a rescue branch `<branch>-rescue-<shortsha>`; archive-after-merge skips with a note. A merge that GitHub only queued is reported, with no fast-forward or archive.
- Guards fail closed: an unreadable dirty check refuses the update; Abort Update aborts only a merge whose MERGE_HEAD is in `origin/<base>`; a missing folder is not "git missing" (`src/shared/gitMissing.js`).

**Records.** A workspace opened from a branch records a real base (prefilled from its upstream, else the default branch); old `base: null` records read as the remote default. Removing a project keeps its records under `detachedWorkspaceRecords` and re-adding restores them. A pushed branch is not renamed from Frame. A failed create deletes its own new branch by compare-and-swap (a recorded exception to "never deletes a branch").

**Renderer.**
- `modalKeys.enterSubmits`: Enter on a focused button does what the button says.
- `scopeGuard.exclusive`: one Create PR at a time; conflict dialogs take turns.
- `scopeGuard.scopeGuard`: setup, agent start, create and conflict follow-ups stay on the project and workspace they started in.
- Review state survives errors, sends and re-renders; comments re-anchor by quoted text or become "outdated".

**Rules for future work.**
- Never put user or IPC text into git argv without `isValidBranchName` (or a commit-id check) and `--` where git allows it.
- Never remove a worktree without `headState`.
- Work after an await in the renderer captures its project/workspace first.
- `test/workspaceGit.test.js` is the temp-repo harness for main-process git behaviour; add a case there for each git-edge fix.

**Gaps.**
- `git diff` (the review) still refreshes the index under `--no-optional-locks` on git 2.39; background reads (`status`, conflict listing via `ls-files -u`) no longer take index.lock.
- Renderer fixes are verified live over CDP, without a DOM test harness.
- An edit to an untracked file in a workspace does not refresh the open review (pre-existing).

Chain: spec.md → plan.md → tasks.md → outcome.md
