# Plan — Workspace hardening

## Architecture

### Resolved plan-time decisions

Business (asked; the user chose to ask users, 2026-11-11: "yerel tarafta kullanıcıya sorarak ilerleme taraftarıyım"):
- **B1 L3: unreachable commits on archive.** Archive stops and asks: "N commits on a detached HEAD are not on any branch — keep them on `<branch>-rescue-<shortsha>`, or cancel". "Archive after merge" never removes such a worktree silently; it skips archiving and says why. Rejected: a silent rescue branch.
- **B2 L4: the base of a workspace opened from an existing branch.** The New Workspace dialog shows the Base field in both modes, prefilled from the branch's upstream (when that is not the branch itself), else the project's default branch, and the record stores it. Workspaces already stored with `base: null` resolve to the default remote branch when read; nothing is migrated. Rejected: detecting it without asking.
- **B3 L6: removing a project that has workspaces.** Removal warns first and lists the worktree folders that stay on disk. The records are kept, in an additive registry key, so re-adding the project restores them. Rejected: discarding them.
- **B4 R9: review comment anchors after the file changes.** Comments are re-anchored by their quoted line text when the diff reloads: the same line if the text still matches, else the nearest equal line. One whose text is gone is marked "outdated", still listed, and sent flagged. Rejected: keeping stale line numbers.

Business (silent):
- **X1 is in scope.** Found during the evidence pass (option injection into `git fetch` on create, reproduced) and added to the spec as a finding of the same class as L2.
- **L13c branch rollback.** When create fails after making a new branch, the branch is deleted, but only with a compare-and-swap (`update-ref -d refs/heads/<b> <startSha>`), so it is removed only if nothing has moved it. This is a recorded exception to `workspaces` C4 ("never deletes a branch"): it undoes Frame's own half-finished create, never a user branch.
- **L12** A branch that has been pushed (it has an upstream, or `origin/<old>` exists) cannot be renamed from Frame; the message says to rename it on GitHub first. Unpushed branches rename as before.
- **L13b** A merge that GitHub queued (state not `merged` after `gh pr merge`) reports "queued", and skips the fast-forward and the archive.
- **L13a** Abort Update aborts only a merge whose `MERGE_HEAD` is part of `origin/<base>`. Any other merge in progress is refused with a message.

Technical (silent):
- **Test posture.** A failing test comes before each fix, as the spec requires. Within the testing record:
  - **(a) Pure tests** in `test/*.test.js` for every new or changed shared rule.
  - **(b) Temp-repo tests** in a new `test/workspaceGit.test.js`. They drive the real `workspaceManager`, `gitBranchesManager` and `workspaceGitState` against temporary repos and a bare remote. The harness stubs `electron` / `@aptabase/electron/main` / `posthog-node` and `./githubManager` (as `frameProjectOpen.test.js` and `gitSharing.test.js` do), and sets `HOME` before requiring, because `DEFAULT_ROOT` reads it when the module loads.
  - **(c) Renderer fixes** are verified live, with their logic extracted into small pure modules that are unit-tested.
- **Shared helpers, introduced once:**
  - `prFlow.pushArgs({ branch, base, upstream, setUpstream })` returns `{ args } | { error }`. It refuses invalid names, the base, and an upstream equal to `origin/<base>`. The push always names `origin refs/heads/B:refs/heads/B`.
  - `prFlow.mergeLanded(pr)`.
  - `baseForBranch({ branch, upstream, defaultBranch })`.
  - `isGitMissing(err, cwd, exists)`: `ENOENT` counts as "git missing" only when the cwd exists. Used by `gitBranchesManager`, `gitStatusManager` and `gitDiffManager`.
  - `isValidBranchName` (existing) at every argv entry: create, fetch, rename, push. Plus `--` where git accepts it (`branch -m -- old new`).
  - Renderer:
    - `modalKeys.enterSubmits(target)`: Enter confirms only when focus is not on a button.
    - `exclusive(key)`: one dialog request at a time; a second call refocuses or queues.
    - `scopeGuard(projectPath, workspaceId).still()`: work after an await runs only for the scope it started in.
- **L3.**
  - `git.headState(worktree, branch)` returns `{ onBranch, detached, sha, unreachable }` via `symbolic-ref -q HEAD` and `rev-list --count HEAD --not --branches --remotes --tags`.
  - `status()` includes it, so the renderer asks before it closes terminals.
  - `archive()` returns `{ headOff }` unless `rescue: true`; with `rescue` it creates the rescue branch after any commit/discard step.
- **L5.** `workspaceManager.archiveQueued` runs archive through the per-project queue; `merge()` uses it.
- **L7.** `registry.reconcile(records, rows, { canon })` compares canonical paths. The manager passes `realpathSync` with a raw-path fallback.
- **L8.** `trackedDirtyCount` returns `{ count, error }`, and update-from-base refuses on error.
- **L9.** `cpSync` with `verbatimSymlinks: true`.
- **L10.**
  - A trailing `/**` in a pattern also matches the directory itself.
  - `dirsToExpand(candidates, patterns)` lists files inside collapsed ignored directories (`ls-files --others --ignored --exclude-standard -z -- <dir>`); these are filtered again.
- **L11.** `ARCHIVE_TIMEOUT_MS` (120 s) for archive's add/commit/reset/clean.
- **L13d.** `mergeBase` must match `^[0-9a-f]{7,64}$`, and `base` is validated in `reviewFiles`.
- **L13e.** `specLocations` drops a project's cached entry before the watched-project early return.
- **R4, R5, R9, R14.** Pure helpers in `reviewModel.js`:
  - `applyFileList(prev, res)` (an error keeps files and ticks);
  - `remainingAfterSend(comments, sentIds)`;
  - `newSideLines(diff)` and `reanchor(comments, path, lines)`;
  - `pruneScopes(all, projectPath, liveIds)`, also used for terminal session keys.
- **R8.** One persistent textarea is re-attached on render, restoring focus and selection only if it had them. Clicking another line or file with a non-empty draft keeps the draft pending. A draft whose line disappears moves to the pending list.
- **R11.** `state.updateWorkspaceMeta({ branch, name })` replaces the no-op re-select. A pure `selectionChange(prev, next)` returns `same`, `meta` or `switch`.
- **R12.** Numbers are coerced with `Number(x) || 0` and the status is escaped before interpolation.
- **Overlap.** Several files here (`workspaceManager.js`, `gitBranchesManager.js`, `workspaceGitState.js`, `gitDiffManager.js`, `gitStatusManager.js`, `newWorkspaceModal.js`, `reviewSection.js`, `terminalManager.js`) are also in `server-hardening`'s footprint. Run the two specs one after the other, not in parallel.

### Data shapes

```
headState → { onBranch, detached, sha, unreachable }
archive(projectPath, id, { action?, message?, rescue? }) → { error } | { dirty, count } | { headOff: headState } | { error: null }
pushArgs → { args: ['push', ('-u'), 'origin', 'refs/heads/B:refs/heads/B'] } | { error }
registry file += detachedWorkspaceRecords: { [projectPath]: Record[] }   (additive)
review comment += outdated?: true
```

## Files

- `src/shared/prFlow.js` — **Modified**: `pushArgs`, `mergeLanded`, `baseForBranch`
- `test/prFlow.test.js` — **Modified**
- `src/shared/workspaceRegistry.js` — **Modified**: rename validates the branch; `reconcile` with `canon`
- `test/workspaceRegistry.test.js` — **Modified**
- `src/shared/copyFilesMatch.js` — **Modified**: `/**` directories, `dirsToExpand`
- `test/copyFilesMatch.test.js` — **Modified**
- `src/shared/gitMissing.js` — **New**: `isGitMissing`
- `test/gitMissing.test.js` — **New**
- `src/shared/reviewModel.js` — **Modified**: `applyFileList`, `remainingAfterSend`, `newSideLines`, `reanchor`, `pruneScopes`, outdated marking in `composeReviewPrompt`
- `test/reviewModel.test.js` — **Modified**
- `src/main/workspaceManager.js` — **Modified**: validation on create/rename (L2, X1), `archiveQueued`, `headState` in status, archive rescue, base for from-branch, pushed-branch rename refusal, canonical reconcile, `verbatimSymlinks`, branch rollback, `dirsToExpand` use
- `src/main/gitBranchesManager.js` — **Modified**: `fetchBranch` validation, `pushBranch` takes argv, `headState`, `trackedDirtyCount` error, archive timeouts, ignored-directory listing, `isGitMissing`
- `src/main/workspaceGitState.js` — **Modified**: push via `pushArgs`, base resolution for `base: null`, `archiveQueued` in merge, `mergeLanded`, abort-only-our-merge, dirty-error refusal
- `src/main/gitDiffManager.js` — **Modified**: `isGitMissing`, `mergeBase`/`base` validation
- `src/main/gitStatusManager.js` — **Modified**: `isGitMissing`
- `src/main/projectRegistry.js` — **Modified**: keep records on removal and restore on add
- `src/main/specManager.js` — **Modified**: `specLocations` invalidation
- `src/shared/ipcChannels.js` — **Modified**: `WORKSPACE_BASE_FOR_BRANCH`
- `test/workspaceGit.test.js` — **New**: temp-repo tests for L1, L2, X1, L3, L4, L5, L6, L7, L8, L9, L12, L13a, L13c, L13d, L14
- `src/renderer/modalKeys.js` — **New**: `enterSubmits`
- `src/renderer/scopeGuard.js` — **New**: `scopeGuard`, `exclusive`, `selectionChange`
- `test/rendererGuards.test.js` — **New**: tests for the two modules above
- `src/renderer/workspaceSection.js` — **Modified**: Enter handling, archive rescue dialog, sticky reselect, meta update
- `src/renderer/newWorkspaceModal.js` — **Modified**: Enter handling, base in both modes, scope-captured setup and agent start
- `src/renderer/workspacePr.js` — **Modified**: exclusive Create PR and conflict dialogs, captured project after awaits, number coercion, queued-merge message
- `src/renderer/reviewSection.js` — **Modified**: `applyFileList`, `remainingAfterSend`, persistent draft box, re-anchoring, escaped status, `pruneScopes`
- `src/renderer/state.js` — **Modified**: `updateWorkspaceMeta`
- `src/renderer/terminalManager.js` — **Modified**: prune workspace session keys; `clearProjectSession` drops `path#*`
- `src/renderer/projectListUI.js` — **Modified**: removal warning lists workspace folders
- `index.html` — **Modified**: archive rescue choice
- `src/renderer/styles/components/workspaces.css`, `src/renderer/styles/components/review.css` — **Modified**: rescue choice, outdated comments

## Footprint

- src/shared/prFlow.js
- test/prFlow.test.js
- src/shared/workspaceRegistry.js
- test/workspaceRegistry.test.js
- src/shared/copyFilesMatch.js
- test/copyFilesMatch.test.js
- src/shared/gitMissing.js
- test/gitMissing.test.js
- src/shared/reviewModel.js
- test/reviewModel.test.js
- src/main/workspaceManager.js
- src/main/gitBranchesManager.js
- src/main/workspaceGitState.js
- src/main/gitDiffManager.js
- src/main/gitStatusManager.js
- src/main/projectRegistry.js
- src/main/specManager.js
- src/shared/ipcChannels.js
- test/workspaceGit.test.js
- src/renderer/modalKeys.js
- src/renderer/scopeGuard.js
- test/rendererGuards.test.js
- src/renderer/workspaceSection.js
- src/renderer/newWorkspaceModal.js
- src/renderer/workspacePr.js
- src/renderer/reviewSection.js
- src/renderer/state.js
- src/renderer/terminalManager.js
- src/renderer/projectListUI.js
- index.html
- src/renderer/styles/components/workspaces.css
- src/renderer/styles/components/review.css

## Dependencies

None.

## Sequencing

1. **Option injection and the push target: L1, L2, X1, L13d.**
   - `pushArgs` and `isValidBranchName` at create, fetch, rename and push; `branch -m --`.
   - `mergeBase` / `base` validation in review.
   - Tests: `prFlow`, `workspaceRegistry`, and `test/workspaceGit.test.js` (introduced here with its harness). Covered cases: a branch tracking `origin/main` under `push.default=upstream`; rename to `-f`; a base of `--upload-pack=…`; a mergeBase of `--output=…`.
2. **Archive never loses commits: L3, L5, L11, L13b.**
   - `headState`, archive `headOff` and `rescue`, the rescue dialog (`workspaceSection`, `index.html`, `workspaces.css`).
   - `archiveQueued` in merge; archive timeouts; `mergeLanded` and the queued message.
   - Temp-repo tests for the detached commit and the queued archive; pure test for `mergeLanded`.
3. **Guards fail closed: L8, L13a, L14.**
   - `trackedDirtyCount` errors refuse update.
   - Abort only our merge.
   - `isGitMissing` in the three managers.
   - Tests: `gitMissing` plus temp-repo cases.
4. **A workspace knows its base: L4, L12.**
   - `baseForBranch`, `WORKSPACE_BASE_FOR_BRANCH`, the Base field for existing branches, read-time resolution for `base: null`.
   - Pushed-branch rename refusal.
   - Tests: pure, plus temp repos with a `master`-only remote and a pushed branch.
5. **Registry and filesystem edges: L6, L7, L9, L10, L13c, L13e.**
   - Kept records and the removal warning.
   - Canonical reconcile; `verbatimSymlinks`; ignored-directory expansion.
   - Compare-and-swap branch rollback; `specLocations` invalidation.
   - Tests: pure, plus temp repos (symlinked root, removed and re-added project, failed create).
6. **Dialogs: R1, R2, R7.**
   - `modalKeys.enterSubmits` in the archive and New Workspace dialogs.
   - `exclusive` for Create PR and the conflict dialog.
   - Pure tests; live check.
7. **Scope after awaits: R3, R6, R10, R11.**
   - `scopeGuard` in new-workspace setup and agent start, and in the conflict resolve/abort.
   - Sticky reselect; `updateWorkspaceMeta`.
   - Pure tests for `scopeGuard` / `selectionChange`; live check.
8. **Review state: R4, R5, R8, R9, R12, R14.**
   - `applyFileList`, `remainingAfterSend`, the persistent draft box, re-anchoring with outdated comments.
   - Escaped and coerced values; `pruneScopes` for viewed state and terminal session keys.
   - `reviewModel` tests; live check.
