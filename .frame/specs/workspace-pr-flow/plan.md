# Plan — Workspace PR flow

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 PR title and body:** Frame composes them deterministically and the user edits them in the dialog. Sources: spec title, the Goal summary and the outcome when present; without a spec, the commit subjects. Rationale: instant and consistent, no model call (self-hosted direction), and the "why" already lives in the spec the agent wrote. Rejected: the agent drafts the text and runs `gh pr create` (slower, needs a lane, hard to edit).
- **B2 Merge method:** project setting `settings.workspaces.mergeMethod`. It defaults to the first method the repository allows, in the order squash → merge → rebase (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`). Rejected: asking on every merge.
- **B3 After merge:** the workspace is archived automatically (`settings.workspaces.archiveOnMerge`, default on, like Conductor's `archive_on_merge`). Rejected: asking each time.
- **B4 Refresh:** for workspaces that are pushed or have a PR, every 3 minutes while the window is visible (`pollGate.gatedInterval`), plus on window focus and right after every Frame action. Rejected: focus/actions only (CI results would never surface on their own).
- **B5 Shortcut:** Create PR is ⌘⌥P. ⌘⇧P is the palette and ⌘⇧R is Electron's force reload. Rejected: no shortcut.

Technical (asked):
- **T1 Ownership:** main owns git/PR state. A new `workspaceGitState` module runs one gated poller for the watched project's workspaces, calls git and `gh`, and pushes `WORKSPACE_GIT_STATE`. Push / Create PR / Merge go through it so state re-pushes right after each action. Same shape as `gitStatusManager` / `SPEC_DATA`. Rejected: per-row renderer polling.
- **T2 Test posture:** pure logic only (testing record).

Technical (silent):
- **Push:** `git push -u origin <branch>` when the branch has no upstream, otherwise `git push`. Argv only, run in the worktree. No `--force` anywhere, and the base branch is never a push target (refused if the workspace branch equals its base).
- **Counts on the row:** `unpushed` is `rev-list --count @{u}..HEAD` when an upstream exists, else `origin/<base>..HEAD`. `behind` is `rev-list --count HEAD..origin/<base>`. `dirty` comes from `git status --porcelain`.
- **PR lookup:** `gh pr view <branch> --json number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,headRefName,baseRefName`, run in the main checkout so a renamed or remote-only branch still resolves. No PR → `pr: null`.
- **gh with free text:** a new argv runner `runGh(args, cwd)` in `githubManager` (the existing `run` is a shell string), so a title or body with quotes can never break the command. The body goes in through `--body-file -` on stdin.
- **Fix failing checks** builds its prompt in a pure function: branch, PR number, failing check names, `gh pr checks <n>` and `gh run view <run-id> --log-failed` as the way to read logs. It is sent with `agentDispatch.dispatch({ createNew: true, ... })` in the selected workspace. Not a spec command, so not a staged template.
- **After merge:** `gh pr merge <n> --<method>` (no `--delete-branch`; GitHub's own repo setting decides that). The main checkout runs `git pull --ff-only` when it is on the PR's base and clean. With `archiveOnMerge`, the workspace is archived (clean by then; the branch is kept locally).
- **UI module:** the row's git badges, the PR dialog and the PR actions live in a new renderer module `workspacePr.js`. `workspaceSection` asks it for row HTML and menu items, so it stops growing. The dialog reuses the task-run modal shell.
- **Access:** reuse `githubManager.checkAccess` (cached). Without gh, auth or a GitHub remote, PR actions are disabled with that reason; push works for any `origin`.
- **Stale in-flight specs** (`audit-q3-*`) don't touch these files' current work. Not blocking.

### Data shapes

`WORKSPACE_GIT_STATE` push: `{ projectPath, access: { gh, authed, repoName }, workspaces: { [id]: RowState } }`

```
RowState = { dirty: number, unpushed: number, behind: number, hasUpstream: boolean,
  pr: null | { number, url, state: 'draft'|'open'|'merged'|'closed',
               checks: { passing, failing, pending, failingNames: [] },
               comments: number, reviewDecision, mergeable: boolean,
               ready: boolean /* open, not draft, mergeable, no failing/pending checks */ } }
```

Settings additions: `settings.workspaces.mergeMethod: 'squash'|'merge'|'rebase'|null` (null = repo default), `archiveOnMerge: boolean` (default true).

## Files

- `src/shared/prFlow.js` — **New**: pure `parseCount`, `mapPrView`, `checksSummary`, `composePr` (title/body from spec or commits), `pickMergeMethod`, `fixChecksPrompt`, `isPushable`
- `test/prFlow.test.js` — **New**: tests for the above
- `src/shared/workspaceRegistry.js` — **Modified**: `normalizeSettings` gains `mergeMethod`, `archiveOnMerge`
- `test/workspaceRegistry.test.js` — **Modified**: the new settings keys
- `src/main/gitBranchesManager.js` — **Modified**: `revCount`, `upstreamOf`, `pushBranch` (argv, upstream on first push, never force), `commitSubjects`, `fastForwardIfOn`
- `src/main/githubManager.js` — **Modified**: argv `runGh(args, cwd, stdin)`; export `checkAccess`, `runGh`
- `src/main/workspaceGitState.js` — **New**: per-project state collection, gated poller + focus refresh, `WORKSPACE_GIT_STATE` push, push / PR draft / PR create / merge actions with re-push
- `src/main/workspaceManager.js` — **Modified**: `notify` also refreshes git state; export `archive` for archive-on-merge
- `src/main/index.js` — **Modified**: wire `workspaceGitState`
- `src/shared/ipcChannels.js` — **Modified**: `WORKSPACE_GIT_STATE`, `WORKSPACE_GIT_REFRESH`, `WORKSPACE_PUSH`, `WORKSPACE_PR_DRAFT`, `WORKSPACE_PR_CREATE`, `WORKSPACE_PR_MERGE`
- `src/renderer/workspacePr.js` — **New**: subscribes to git state; row badges HTML; PR menu items; PR dialog; push / create / merge / fix-checks / open-on-GitHub actions
- `src/renderer/workspaceSection.js` — **Modified**: render `workspacePr` badges and menu items on rows
- `src/renderer/index.js` — **Modified**: init `workspacePr`; commands `workspace.push`, `workspace.createPr` (⌘⌥P), `workspace.merge`, `workspace.fixChecks`
- `src/main/menu.js` — **Modified**: Create Pull Request… ⌘⌥P
- `src/renderer/projectSettingsModal.js` — **Modified**: merge method select and archive-on-merge toggle in Workspaces
- `index.html` — **Modified**: PR dialog markup; the two settings rows
- `src/renderer/styles/components/workspaces.css` — **Modified**: badges, PR dialog

## Footprint

- src/shared/prFlow.js
- test/prFlow.test.js
- src/shared/workspaceRegistry.js
- test/workspaceRegistry.test.js
- src/main/gitBranchesManager.js
- src/main/githubManager.js
- src/main/workspaceGitState.js
- src/main/workspaceManager.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/workspacePr.js
- src/renderer/workspaceSection.js
- src/renderer/index.js
- src/main/menu.js
- src/renderer/projectSettingsModal.js
- index.html
- src/renderer/styles/components/workspaces.css

## Dependencies

None.

## Sequencing

1. **Pure core.** `src/shared/prFlow.js` with `test/prFlow.test.js`. Covers:
   - counts and the gh PR view → `pr` mapping (state, checks summary, ready);
   - PR title/body composition from a spec or from commit subjects;
   - merge-method choice from repo flags and the setting;
   - the fix-checks prompt;
   - `isPushable` (refuses the base branch).

   `normalizeSettings` gains `mergeMethod` / `archiveOnMerge`, extended in `test/workspaceRegistry.test.js`.
2. **Git and gh primitives.**
   - `gitBranchesManager`: `revCount`, `upstreamOf`, `pushBranch`, `commitSubjects`, `fastForwardIfOn`.
   - `githubManager`: argv `runGh` with optional stdin; export `checkAccess` / `runGh`.
3. **State in main.** New `src/main/workspaceGitState.js`:
   - collects `RowState` per active workspace plus `access`;
   - pushes `WORKSPACE_GIT_STATE`;
   - runs one `pollGate.gatedInterval` (3 min) for the watched project, refreshes on window focus and on `WORKSPACE_GIT_REFRESH`, and on every `workspaceManager.notify`.

   Channels go in `ipcChannels.js`; wire it in `index.js`.
4. **Actions in main.**
   - `WORKSPACE_PUSH` (refuses base, warns on dirty via the result).
   - `WORKSPACE_PR_DRAFT`: composes title/body from the held spec (spec-in-workspace location map) or commit subjects.
   - `WORKSPACE_PR_CREATE`: push first if needed, then `gh pr create --base --head --title --body-file - [--draft]`.
   - `WORKSPACE_PR_MERGE`: method from the setting / repo, then ff the main checkout if safe, then archive when `archiveOnMerge`.
   - Each one re-pushes state.
5. **Row state and Push in the renderer.** New `src/renderer/workspacePr.js`:
   - subscribes to `WORKSPACE_GIT_STATE`;
   - renders badges: dirty, ↑unpushed, ↓behind, PR #n with state and checks dot, comments;
   - supplies menu items. `workspaceSection.js` renders both.
   - Push action plus `workspace.push` command. Styles in `workspaces.css`.
6. **Create PR.**
   - PR dialog markup in `index.html`, logic in `workspacePr.js`: title, body, draft. Prefilled from `WORKSPACE_PR_DRAFT`, base shown, create through `WORKSPACE_PR_CREATE`.
   - `workspace.createPr` command with ⌘⌥P, plus the menu item in `menu.js`.
   - Disabled with the access reason when PR actions are unavailable.
7. **Checks and fixes.**
   - Failing/pending/passing on the row with the failing names in its tooltip.
   - "Fix failing checks" dispatches `fixChecksPrompt` to a new agent lane in the workspace; "Open PR on GitHub" opens the URL.
   - `workspace.fixChecks` command.
8. **Merge.**
   - Merge action (enabled when `ready`) with a confirm naming the method, through `WORKSPACE_PR_MERGE`; `workspace.merge` command.
   - Project Settings → Workspaces gains the merge method select and the archive-on-merge toggle (`projectSettingsModal.js`, `index.html`).
