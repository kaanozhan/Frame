---
keywords: workspaces, hardening, data loss, push, archive, rename, review, pull request, dialog, race
related: workspaces, spec-in-workspace, workspace-pr-flow, workspace-review, update-from-base
---

# Workspace hardening

## Problem

A review of the five local workspace specs on 2026-11-11 (four independent read-throughs, with the most severe findings confirmed in the code and several reproduced in a scratch repo) found defects that the test suite does not see. The tests cover the pure rules; the defects sit at the edges of the flows. Some break rules the user set for this work: never push the base branch, never lose uncommitted or committed work, never act on the wrong workspace. These must be fixed before the branches reach `main` or are used on real projects.

Findings, by id (file:line as of commit `2a592fd`):

**Data loss and wrong target**
- **L1 Push can land on the base branch.** With an upstream set, `pushBranch` runs a bare `git push`, and `isPushable` compares names only. A branch whose upstream is `origin/main` pushes to main under `push.default=upstream`. A "from branch" workspace stores `base: null`, so the base branch itself passes. (`workspaceGitState.js:248`, `gitBranchesManager.js:552`, `prFlow.js:142`)
- **L2 Branch rename takes option text.** `git branch -m <old> <new>` runs with unvalidated user text. Renaming an archived workspace's branch to `-f` renames the main checkout's current branch (for example `main`) over the workspace branch: `main` disappears and the workspace commits lose their ref (reproduced 2026-11-11). (`workspaceManager.js:483`)
- **X1 Create passes base and branch text into git argv unvalidated.** A base of `--upload-pack=<command>` makes `git fetch origin <base>` run that command (reproduced 2026-11-11). It is reachable from the New Workspace dialog and from the server's `workspaces.create`. Added after the plan-time evidence pass. (`workspaceManager.js:330`, `gitBranchesManager.js:417`)
- **L3 Archive drops commits made on a detached HEAD.** The only guard is `status --porcelain` before `worktree remove --force`. "Archive after merge" reaches this with no dialog. (`workspaceManager.js:419`)
- **R1 Enter always confirms the archive dialog,** even with focus on Cancel and "Discard" selected. The New Workspace dialog has the same pattern. (`workspaceSection.js:477`, `newWorkspaceModal.js:48`)
- **R2 The Create PR dialog is re-entrant.** ⌘⌥P while it is open, or two opens in a row, leaves stale listeners. The next create can use another workspace's id. (`workspacePr.js:185`)
- **R3 The first agent starts in whatever workspace is selected when setup finishes,** not in the new one. (`newWorkspaceModal.js:244`)
- **R6 Conflict and create paths act on the current project after an await.** After a project switch they select or abort with the wrong project and workspace pair. (`workspacePr.js:327`, `:395`, `newWorkspaceModal.js:192`)
- **R7 One conflict dialog is shared by concurrent updates.** One click resolves both. (`workspacePr.js:362`)

**Wrong results**
- **L4 "From branch" workspaces assume base `main`.** Update, PR base and review are wrong for a branch cut from `develop`, and fail in a `master` repo. (`workspaceManager.js:377`, `workspaceGitState.js:74`)
- **L5 `merge()` archives outside the per-project queue.** A concurrent create can resurrect or drop a record. (`workspaceGitState.js:334`)
- **L6 Removing a project discards its workspace records.** Worktrees stay on disk, unowned and holding their branches. (`projectRegistry.js:137`, `frameProject.js:1514`)
- **L7 A symlinked workspaces root marks every workspace missing,** because paths are compared as strings while git lists real paths. (`workspaceRegistry.js:192`, `workspaceManager.js:287`)
- **L8 The update-from-base dirty guard fails open.** `trackedDirtyCount` returns 0 on any error. (`gitBranchesManager.js:605`)
- **L9 Copied symlinks point back into the main checkout,** because `cpSync` rewrites relative links. (`workspaceManager.js:123`)
- **L10 `copyFiles` patterns miss fully ignored directories.** `certs/**` selects nothing. (`copyFilesMatch.js:79`, `gitBranchesManager.js:507`)
- **L11 Archive "commit" and "discard" run under the 10 s default timeout.** A slow pre-commit hook always fails; a discard can stop half-way. (`gitBranchesManager.js:473`)
- **L12 Renaming a pushed branch strands its upstream and its PR.** (`workspaceManager.js:490`)
- **L14 A missing folder is read as "git is not installed"** in two more places, and that switches git features off for the session. `gitBranchesManager` was fixed earlier. (`gitStatusManager.js:354`, `gitDiffManager.js:92`)
- **R4 A failed review file list wipes every "viewed" tick.** (`reviewSection.js:169`)
- **R5 Review comments added while a send is in flight are dropped unsent.** (`reviewSection.js:392`)
- **R8 The open comment box is rebuilt on every center re-render.** The caret jumps to the end; a draft is discarded when another line or file is clicked; the box vanishes when its line leaves the diff. (`reviewSection.js:364`, `:229`, `:331`)
- **R10 The remembered workspace is lost when a second list load overlaps the first.** (`workspaceSection.js:108`)
- **R11 The "renamed branch" re-select is a no-op,** so the workspace is provisioned again on every window focus. (`workspaceSection.js:129`)

**Smaller**
- **L13a** `abortUpdate` aborts any `MERGE_HEAD`, including a merge the user or agent started. (`workspaceGitState.js:386`)
- **L13b** On a merge-queue repo, `gh pr merge` returns success without merging, and the fast-forward and archive still run. (`workspaceGitState.js:325`)
- **L13c** Create's rollback leaves the new branch behind. (`workspaceManager.js:381`)
- **L13d** `mergeBase` from IPC reaches argv unvalidated. (`gitDiffManager.js:188`)
- **L13e** `specLocation` uses a map refreshed only for the watched project. (`specManager.js:131`)
- **R9** Review comment anchors are never re-based after the file changes. (`reviewSection.js:325`)
- **R12** Counts and status values are interpolated into HTML without coercion. (`workspacePr.js:103`, `reviewSection.js:488`)
- **R14** `frame-review-viewed` is never pruned. Terminal session keys are capped at 20 by recency, but stale workspace keys evict live ones and survive project removal.

## Goal

Every finding above is either fixed or explicitly accepted with its reason recorded. The workspace rules then hold in every path:

- **Push never reaches the base.** A push always names its target, `origin <branch>`. It is refused when the branch is the base or its upstream is the base.
- **No branch name or ref text is ever read as an option.** Names are validated with the existing `isValidBranchName` at every entry point (create, fetch, rename, push), and passed after `--` where git allows it.
- **Archive never loses commits.** A worktree whose HEAD is not on its branch, or has commits no branch holds, is not removed without the user's explicit choice.
- **Dialogs do what the focused control says.** Enter on Cancel cancels. One dialog serves one request at a time, and every action after an await uses the project and workspace it was started for.
- **A workspace knows its base.** One opened from an existing branch records a real base, not an assumed `main`.
- **Review state survives errors.** Viewed ticks, pending comments and drafts are kept through a failed load, a send in flight and a re-render.
- **Guards fail closed.** When Frame cannot tell whether work is uncommitted, it refuses the operation.

## Constraints

- Behaviour that is correct today does not change: this spec fixes defects and adds no features.
- The rules of the five specs stay as written (`workspaces`, `spec-in-workspace`, `workspace-pr-flow`, `workspace-review`, `update-from-base`): never `--force`, never push the base, never commit for the agent, never auto-commit on archive, argv only.
- Every fix that can be reproduced in a test gets the failing test first. This covers pure rules, and git behaviour in temporary repositories (the testing record covers `src/main` and `src/shared`). Renderer fixes without a DOM harness are verified live and extracted into pure helpers where that is cheap.
- No registry migration that could lose records. Existing `workspaces.json` files keep working.
- Server workspace routing is out of this spec (`server-hardening`). Fixes here must not break it.
- Commits are made only with the user's approval.

## Success Criteria

- When a workspace branch's upstream is the base branch (or the branch is the base), then Push refuses with a clear reason and nothing reaches the base, under every `push.default`.
- When a branch is renamed to a name starting with `-` or otherwise invalid, then the rename is refused and no git command runs.
- When a workspace is created with a base or branch that is not a valid branch name (for example `--upload-pack=…`), then the create is refused and no git command runs with it.
- When a workspace whose HEAD is detached with commits no branch holds is archived, including by "archive after merge", then the worktree is not removed until the user chooses what happens to those commits.
- When Enter is pressed with focus on Cancel in the archive or New Workspace dialog, then the dialog cancels.
- When Create PR is invoked while its dialog is open or its draft is loading, then one dialog exists, the typed text is kept, and the PR is created for the workspace shown.
- When the user switches workspace or project during a setup script, an update or a create, then the follow-up (agent start, conflict choice, selection) applies to the original workspace or is dropped, never to the new selection.
- When a workspace is opened from a branch cut from a non-default base, then update, PR base and review use that base, and a repository without `main` works.
- When the review's file list fails to load, then viewed ticks are unchanged. When a comment is added during a send, then it remains pending.
- When the dirty check errors, then update-from-base refuses.
- When a project is removed and re-added, then its workspaces are still listed, or the user was told what happens to them before removal.
- When `npm test` runs, then it passes, with a regression test for every finding reproducible outside the DOM.
- When the spec closes, then every finding id above is marked fixed or accepted-with-reason in `outcome.md`.

## Out of Scope

- New workspace features
- Frame Server and server workspaces (`server-hardening`)
- A DOM test harness for the renderer
- Orchestration

## Open Questions

- **L3 What archive does with unreachable commits.** Options:
  - (a) Refuse with a dialog that offers "keep them on a rescue branch `<branch>-detached-<sha>`" or cancel.
  - (b) Always create the rescue branch silently and say so.
- **L4 Where a "from branch" workspace gets its base.** Options:
  - (a) Ask in the dialog, prefilled from the branch's upstream or the default branch.
  - (b) Detect it without asking: upstream, then the nearest merge-base among the remote's default and common bases.
- **L6 Removing a project that has workspaces.** Options:
  - (a) Keep the records, so re-adding the project restores them.
  - (b) Warn before removal and list what will be left on disk.
- **R9 Comment anchors after the file changes.** Options:
  - (a) Re-anchor by the quoted line text when the diff reloads, and mark comments whose line is gone as "outdated".
  - (b) Keep them as written and show the line they were written against.
