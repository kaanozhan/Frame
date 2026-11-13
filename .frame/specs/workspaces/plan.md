# Plan — Workspaces

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 Panel layout:** scope today's views (file tree, Changes, GitHub, dock) to the selected workspace. No right-hand git panel here; it moves to `workspace-review`. Rationale: one sidebar change at a time, keeps this spec bounded.
- **B2 Sidebar placement:** a new **Workspaces** section directly under the project switcher (main row first, then workspaces, ＋ button). The existing Work/Context nav stays below it and follows the selected workspace. Rationale: nothing users rely on disappears.
- **B3 Base branch:** default to the remote's default branch (`origin/HEAD`), with a base picker in the new-workspace dialog. Rationale: the branch list already exists; `develop`-style repos are not stuck.
- **B4 Short names:** **color names** (user's choice, over city names and the proposed mountains/rivers), e.g. `amber`, `teal`, `indigo`. Taken names get a numeric suffix (`teal-2`).
- **B5 Terminal cap:** 9 terminals **per workspace** (main counts as one workspace), replacing 9 per project. Rationale: 9 per project is too tight once a project has several workspaces.

Business (silent):
- Non-git project: only the main row; ＋ is disabled with the reason in its tooltip.
- No `origin` remote: no fetch; the base comes from local branches.
- The new-workspace dialog asks little, like Conductor: start point (new branch from base, or existing branch), base, AI tool, optional first prompt. Enter creates.
- Restoring a workspace whose branch is now checked out elsewhere is refused, and Frame names the other workspace (keeps C3).
- A worktree that disappeared outside Frame shows as **missing** on its row, with Restore and Remove-record actions.
- Projects without `.frame/` (non-Frame) still get workspaces with default settings; the Project Settings section shows "Initialize Frame to customize".

Technical (asked):
- **T1 Representation:** `projectPath` stays the project identity (the main checkout). A new **active workspace** `{ id, root }` lives in renderer state. Checkout-bound surfaces use `root`: terminal cwd, file tree, git status, diff, branch picker, sessions. Project-bound surfaces keep `projectPath`: Specs, Tasks, settings, project switcher badges. Terminals gain `workspaceId` next to `projectPath`. Main is the reserved id `main` with `root = projectPath`. Rejected: registering worktrees as separate projects (`.frame` meta would diverge per copy).
- **T2 Registry:** workspace records are stored inside each project record in `~/.frame/workspaces.json` (`projects[i].workspaces`). The file is machine-local, needs no migration, and stays the only registry file. On every list, records are reconciled against `git worktree list`. The project-registry rename is **step 1 of this spec**.
- **T3 Setup script:** runs in a visible terminal tab named `setup` inside the workspace. When that tab's foreground process returns to the shell (laneStatus `running → idle`), Frame opens the AI terminal. The setup tab stays open for reading and rerunning.
- **T4 Test posture:** pure logic and data transforms only, the project's convention (testing record: `src/main`, `src/shared` and pure renderer modules are covered; DOM code is not).

Technical (silent):
- **Linked-worktree git watching:** in a linked worktree `.git` is a file (`gitdir: …`). `gitStatusManager` resolves it to the real git dir and watches that, instead of skipping (today: `gitStatusManager.js:96-102`).
- **Fetch:** `git fetch origin <base>` with a 15 s timeout. On failure Frame uses the local `origin/<base>` and shows a notice.
- **Git commands:** all new git calls use `execGitArgs` (argv, no shell). The string-built `addWorktree` is left for orchestration only.
- **copyFiles:** candidates come from `git ls-files --others --ignored --exclude-standard --directory` run in the main checkout. They are matched by a dependency-free matcher (`*`, `**`, `?`; `node_modules/` and `.git` never considered). Default list `.env*`.
- **Settings:** `.frame/config.json` → `settings.workspaces = { setupScript, copyFiles, branchPrefix }` (shared in `repo` mode). The machine-local worktree root lives in app user settings (`workspacesRoot`, default `~/frame/workspaces`). Default branch prefix is `ws` → branch `ws/<name>`. This avoids orchestration's `frame/<slug>/work` ref namespace.
- **Disk layout:** `<workspacesRoot>/<basename(projectPath)>/<name>`. If that path exists, the name takes the next free suffix.
- **Sessions:** the Claude/Codex session lists are queried with the active workspace's `root` instead of `projectPath`. Claude's encoded-path lookup and Codex's `belongsTo` then match the worktree by construction, and main behaves as today.
- **Archive mechanics:** status via `git status --porcelain`. "Commit" runs `git add -A` + `git commit -m <message>` (default `WIP: archive <name>`, editable). "Discard" runs `git reset --hard` + `git clean -fd`. Once clean, `git worktree remove --force` (drops ignored files such as copied `.env` and `node_modules`). The branch is never deleted.
- **Restore** recreates the worktree from the branch, then reruns copyFiles and the setup script (dependencies were removed with the folder).
- **Persistence of selection:** the selected workspace per project is kept in localStorage (`frame-active-workspace`), so S9 holds across restarts.
- **Per-workspace UI state keys:** main keeps today's keys (`projectPath`), so `frame-terminals-view` and `frame-terminal-sessions` are unchanged for main (C9). Other workspaces use `${projectPath}#${workspaceId}`.
- **Session restore:** records carry `workspaceId`. A session whose workspace is gone resumes in main (today's cwd fallback in `src/renderer/sessionRestore.js`).
- **Stale in-flight specs:** `audit-q3-performance-resources` (shipped in f18e334, status left at `implementing`) and `audit-q3-cross-platform` (planned since 2026-07-20) list `ptyManager.js` / `terminalManager.js` in their footprints. They are not live work; noted, not blocking.

### Data shapes

`~/.frame/workspaces.json`: the on-disk keys are unchanged; each project record gains a `workspaces` array:

```
projects[i] = { path, name, isFrameProject, addedAt, lastOpenedAt,
  workspaces: [ { id, name, branch, base, path, location: 'local',
                  createdAt, archivedAt: null | ISO } ] }
```

`location` is written as `'local'` now and never read by UI. It is there so self-hosted can add `'server'` without a migration (C6).

Renderer active workspace: `{ id: 'main' | <id>, root: <abs path>, name, branch }`.

Terminal state (`terminalManager`) and PTY record (`ptyManager.ptyInstances`) gain `workspaceId` (default `'main'`).

### Components

- **`src/shared/workspaceRegistry.js`** (pure): add, archive, restore, rename, find-by-branch (C3 check), reconcile with `git worktree list` rows (marks `missing`), active/archived views.
- **`src/shared/workspaceNames.js`** (pure): color pool and next free name given taken names and existing dirs.
- **`src/shared/copyFilesMatch.js`** (pure): glob compile and match over relative paths.
- **`src/main/workspaceManager.js`**: IPC for list / create / status / archive / restore / rename / settings. Orchestrates git primitives, copyFiles and registry persistence through `projectRegistry`.
- **`src/main/projectRegistry.js`** (renamed from `workspace.js`): owns `~/.frame/workspaces.json`, now also reads and writes `projects[i].workspaces`.
- **Renderer:**
  - `state.js`: active workspace, `onWorkspaceChange`.
  - `workspaceSection.js`: sidebar list, row menu, archived filter, archive dialog.
  - `newWorkspaceModal.js`: dialog plus the setup → AI terminal sequence.
  - `workspaces/rollup.js` (pure): per-workspace attention counts from terminal states.

## Files

Rename (step 1):
- `src/main/workspace.js` — **Deleted** (becomes `projectRegistry.js`)
- `src/main/projectRegistry.js` — **New**: the project registry, same API under registry names, plus workspace record persistence
- `src/main/index.js` — **Modified**: require/init the renamed registry and `workspaceManager`
- `src/main/frameProject.js` — **Modified**: registry calls renamed; `settings.workspaces` getter/setter + IPC
- `src/main/sessionRestore.js` — **Modified**: `WORKSPACE_DIR` → `FRAME_HOME_DIR`; `workspaceId` on registered terminals
- `src/main/menu.js` — **Modified**: "Add Project…" label; New Workspace (⌘⇧N) item
- `src/shared/frameConstants.js` — **Modified**: `WORKSPACE_DIR` → `FRAME_HOME_DIR`, `WORKSPACE_FILE` → `PROJECT_REGISTRY_FILE` (value stays `workspaces.json`)
- `src/shared/ipcChannels.js` — **Modified**: six `*WORKSPACE*` channels renamed to `*PROJECT_REGISTRY*` names; new workspace channels
- `src/renderer/projectListUI.js` — **Modified**: registry channels renamed; workspace-nav → project-nav (ids, classes, functions)
- `src/renderer/appLoader.js` — **Modified**: channel names and loader strings ("projects")
- `src/renderer/multiTerminalUI.js` — **Modified**: `updateProjectNav` call; active workspace wiring; create terminal in workspace root
- `src/renderer/tour/tourSteps.js` — **Modified**: `.project-nav-item` selectors
- `src/renderer/styles/components/terminals-view.css` — **Modified**: `.workspace-nav-*` → `.project-nav-*`
- `src/renderer/styles/components/project-section.css` — **Modified**: `#project-panel` / `.project-nav-*`
- `index.html` — **Modified**: `#project-panel`, loader text, Workspaces section container, new-workspace and archive dialog markup, Project Settings Workspaces section
- `scripts/eval/retrieval-cases.json` — **Modified**: expected file path `src/main/projectRegistry.js`
- `test/frameProjectOpen.test.js` — **Modified**: loads `projectRegistry` and the renamed channel

Workspace core:
- `src/shared/workspaceRegistry.js` — **New**: pure registry operations and reconcile
- `src/shared/workspaceNames.js` — **New**: color-name pool and suffixing
- `src/shared/copyFilesMatch.js` — **New**: dependency-free glob matcher
- `src/main/workspaceManager.js` — **New**: workspace IPC and lifecycle (create, status, archive, restore, rename, list, settings)
- `src/main/gitBranchesManager.js` — **Modified**: `defaultRemoteBranch`, `fetchBranch` (timeout), argv-based worktree add/remove, `worktreeStatus`, `commitAll`, `discardAll`, `listIgnoredCandidates`
- `src/main/gitStatusManager.js` — **Modified**: resolve the real git dir for linked worktrees and watch it
- `src/main/ptyManager.js` — **Modified**: `workspaceId` on PTY records; cap per workspace
- `src/main/sessionRestoreStore.js` — **Modified**: carry `workspaceId` on session records
- `src/main/userSettings.js` — **Modified**: `workspacesRoot` default

Renderer:
- `src/renderer/state.js` — **Modified**: active workspace, `setWorkspace` / `getWorkspace` / `onWorkspaceChange`, per-project persistence
- `src/renderer/index.js` — **Modified**: re-point file tree, git watch and diff on workspace change; register `workspace.new` / `workspace.archive` / `workspace.rename` commands
- `src/renderer/terminalManager.js` — **Modified**: `workspaceId` on terminals, filter by active workspace, per-workspace prefs keys, cap per workspace
- `src/renderer/terminalsView.js` — **Modified**: prefs key per workspace (main unchanged)
- `src/renderer/agentDispatch.js` — **Modified**: dispatch and resume into a workspace (cwd + workspaceId)
- `src/renderer/sessionRestore.js` — **Modified**: resume into the recorded workspace, fallback main
- `src/renderer/sessionsPanel.js` — **Modified**: query sessions by active workspace root
- `src/renderer/statusBar.js` — **Modified**: branch label guard compares against the active workspace root
- `src/renderer/statusBar/branchPicker.js` — **Modified**: operate on the active workspace root
- `src/renderer/workspaceSection.js` — **New**: Workspaces sidebar section (main row, rows with labels/status, ＋, row menu, archived filter, missing state, archive dialog)
- `src/renderer/newWorkspaceModal.js` — **New**: new-workspace dialog and setup → AI terminal sequence
- `src/renderer/workspaces/rollup.js` — **New**: pure per-workspace attention/running counts
- `src/renderer/projectSettingsModal.js` — **Modified**: Workspaces section (setup script, files to copy, branch prefix)
- `src/renderer/github/rowModels.js` — **Modified**: label worktree rows with their workspace name from the registry
- `src/renderer/githubPanel.js` — **Modified**: pass the project's workspaces to `rowModels`
- `src/renderer/styles/components/workspaces.css` — **New**: Workspaces section and dialogs
- `src/renderer/styles/main.css` — **Modified**: import `workspaces.css`

Tests:
- `test/workspaceRegistry.test.js` — **New**: add/archive/restore/rename, branch-collision refusal, reconcile marks missing
- `test/workspaceNames.test.js` — **New**: color picking, suffixing against taken names and dirs
- `test/copyFilesMatch.test.js` — **New**: `*`, `**`, `?`, `.env*` default, `node_modules` never matched
- `test/workspaceRollup.test.js` — **New**: per-workspace counts, main vs others, other projects ignored
- `test/gitStatusWatcher.test.js` — **Modified**: git-dir resolution from a `.git` file
- `test/sessionRestoreStore.test.js` — **Modified**: `workspaceId` round-trips
- `test/githubRowModels.test.js` — **Modified**: worktree rows labeled from workspaces

## Footprint

- src/main/workspace.js
- src/main/projectRegistry.js
- src/main/index.js
- src/main/frameProject.js
- src/main/sessionRestore.js
- src/main/sessionRestoreStore.js
- src/main/menu.js
- src/main/workspaceManager.js
- src/main/gitBranchesManager.js
- src/main/gitStatusManager.js
- src/main/ptyManager.js
- src/main/userSettings.js
- src/shared/frameConstants.js
- src/shared/ipcChannels.js
- src/shared/workspaceRegistry.js
- src/shared/workspaceNames.js
- src/shared/copyFilesMatch.js
- src/renderer/projectListUI.js
- src/renderer/appLoader.js
- src/renderer/multiTerminalUI.js
- src/renderer/tour/tourSteps.js
- src/renderer/state.js
- src/renderer/index.js
- src/renderer/terminalManager.js
- src/renderer/terminalsView.js
- src/renderer/agentDispatch.js
- src/renderer/sessionRestore.js
- src/renderer/sessionsPanel.js
- src/renderer/statusBar.js
- src/renderer/statusBar/branchPicker.js
- src/renderer/workspaceSection.js
- src/renderer/newWorkspaceModal.js
- src/renderer/workspaces/rollup.js
- src/renderer/projectSettingsModal.js
- src/renderer/github/rowModels.js
- src/renderer/githubPanel.js
- src/renderer/styles/components/workspaces.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/components/project-section.css
- src/renderer/styles/main.css
- index.html
- scripts/eval/retrieval-cases.json
- test/frameProjectOpen.test.js
- test/workspaceRegistry.test.js
- test/workspaceNames.test.js
- test/copyFilesMatch.test.js
- test/workspaceRollup.test.js
- test/gitStatusWatcher.test.js
- test/sessionRestoreStore.test.js
- test/githubRowModels.test.js

## Dependencies

None.

## Sequencing

1. **Rename the project registry.** Move `src/main/workspace.js` to `src/main/projectRegistry.js` and rename:
   - constants: `FRAME_HOME_DIR`, `PROJECT_REGISTRY_FILE` (filename value unchanged);
   - the six registry IPC channels;
   - the sidebar nav (`workspaceNav*` → `projectNav*`, `#workspace-panel` → `#project-panel`, `.workspace-nav-*` → `.project-nav-*` in JS, CSS and tour selectors);
   - user-facing strings ("Add Project…", loader "projects");
   - the eval case path.

   Update `test/frameProjectOpen.test.js`. On-disk JSON keys are untouched. No behavior change.
2. **Pure workspace core.** Add `src/shared/workspaceRegistry.js`, `src/shared/workspaceNames.js` and `src/shared/copyFilesMatch.js` with `test/workspaceRegistry.test.js`, `test/workspaceNames.test.js` and `test/copyFilesMatch.test.js`.
3. **Git primitives.**
   - `gitBranchesManager`: `defaultRemoteBranch`, `fetchBranch` (15 s timeout), argv worktree add/remove, `worktreeStatus`, `commitAll`, `discardAll`, `listIgnoredCandidates`.
   - `gitStatusManager`: resolve and watch the real git dir of linked worktrees, extending `test/gitStatusWatcher.test.js` for the `.git`-file resolution.
4. **Main workspace lifecycle.**
   - `projectRegistry` persists `projects[i].workspaces`.
   - New `workspaceManager.js` with IPC (list + reconcile, create = fetch → worktree add → copyFiles, status, archive with commit/discard, restore, rename) and its channels in `ipcChannels.js`.
   - `settings.workspaces` getter/setter + IPC in `frameProject.js`; `workspacesRoot` in `userSettings.js`.
   - Wire in `src/main/index.js`.
5. **Active workspace in the renderer.**
   - `state.js` gains the active workspace with per-project persistence (`frame-active-workspace`) and `onWorkspaceChange`.
   - `index.js` re-points file tree, git watch and diff to the workspace root.
   - `statusBar.js` guard and `branchPicker.js` use the root.
   - `sessionsPanel.js` queries by root.
6. **Terminals per workspace.**
   - `workspaceId` on terminals: `terminalManager` (filtering, per-workspace prefs keys with main unchanged, cap per workspace) and `ptyManager` (record + cap).
   - `terminalsView` keys; `multiTerminalUI` creates terminals in the workspace root; `agentDispatch` dispatch/resume into a workspace.
   - Session restore carries `workspaceId` (`sessionRestore.js` main + renderer, `sessionRestoreStore.js`), with `test/sessionRestoreStore.test.js` extended.
7. **Workspaces sidebar section.**
   - `workspaceSection.js` + `workspaces.css` + `index.html` container: main row, rows (branch label, color name, status from `workspaces/rollup.js`), ＋, row menu (Rename, Archive), archived filter with Restore, missing state with Restore / Remove record.
   - Add `test/workspaceRollup.test.js`.
8. **New workspace flow.**
   - `newWorkspaceModal.js` + markup; ⌘⇧N in `menu.js` and `workspace.new` in `index.js` commands.
   - Create via IPC, select the new workspace, open the `setup` terminal running the setup script, open the AI terminal (chosen tool, optional prompt) when setup returns to the shell. With no setup script, open the AI terminal directly.
9. **Archive flow.**
   - Archive dialog (commit with editable message / discard / cancel) shown when status is dirty.
   - Close the workspace's terminals, call archive, return selection to main.
   - Restore reruns copyFiles + setup.
   - `workspace.archive` and `workspace.rename` palette commands.
10. **Project Settings → Workspaces.** Setup script, files to copy (one glob per line, default `.env*`) and branch prefix in `projectSettingsModal.js` and `index.html`, through the `settings.workspaces` IPC; disabled with "Initialize Frame to customize" for non-Frame projects.
11. **GitHub panel labels.** `github/rowModels.js` labels worktree rows with their workspace name (registry passed from `githubPanel.js`); extend `test/githubRowModels.test.js`.
