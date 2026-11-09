# Outcome — Workspaces

## T01 — Rename the project registry

Moved `src/main/workspace.js` to `src/main/projectRegistry.js` (`loadWorkspace` → `loadRegistry`, internals renamed, on-disk `~/.frame/workspaces.json` and its `activeWorkspace`/`workspaces.default` keys untouched), renamed `WORKSPACE_DIR`/`WORKSPACE_FILE` to `FRAME_HOME_DIR`/`PROJECT_REGISTRY_FILE` and the six registry channels to `LOAD_PROJECT_REGISTRY`, `PROJECT_REGISTRY_DATA`, `PROJECT_REGISTRY_UPDATED`, `ADD_PROJECT_TO_REGISTRY`, `REMOVE_PROJECT_FROM_REGISTRY`, `REORDER_REGISTRY_PROJECTS`. The sidebar nav became `projectNav*` / `#project-panel` / `.project-nav-*` across JS, CSS and tour selectors; "Add Project to Workspace…" became "Add Project…" and the loader says "projects". Deviation: `scripts/eval/retrieval-cases.json` was left alone — the corpus is hash-frozen and pinned to a commit where `workspace.js` exists, so editing it broke `retrievalEval.test.js`; and comment-only rewordings landed in files outside the plan's list (`fsSafe.js`, `structureLifecycle.js`, `onboarding*.js`, `paletteSources.js`, `projectSection.js`, `sidebarResize.js`, `app-loader.css`, `view-header.css`) so "workspace" no longer means the registry anywhere.

_Captured: 2026-11-10 · 34 file change(s)_

---

## T02 — Add the pure workspace core

Added `src/shared/workspaceRegistry.js` (add / archive / restore / rename / remove returning `{ ok, records, record }` or `{ ok:false, error:{ code, message, holder } }` without mutating input; one active holder per branch, archived records hold nothing; `reconcile` flags `missing` on active records absent from `git worktree list`, `toStored` strips it), `src/shared/workspaceNames.js` (72-color pool, `nextName` with `-2`/`-3` overflow, `toSlug`, `uniquify` for folder collisions) and `src/shared/copyFilesMatch.js` (gitignore-shaped matcher: unanchored names at any depth, `/`-anchored from root, `*`/`**`/`?`, directory patterns cover contents, `node_modules`/`.git` never match, `.env*` default). The registry also reserves the id `main` and enforces unique names so folder names never collide. Tests: `test/workspaceRegistry.test.js`, `test/workspaceNames.test.js`, `test/copyFilesMatch.test.js` (25 cases).

_Captured: 2026-11-10 · 6 file change(s)_

---

## T03 — Add git primitives

Added a "Workspace helpers" section to `src/main/gitBranchesManager.js`, all on `execGitArgs` (argv): `defaultRemoteBranch` (origin/HEAD → origin/main|master → current/local branch), `fetchBranch` (15 s, never throws), `addWorkspaceWorktree` / `removeWorkspaceWorktree`, `worktreeStatus`, `commitAll`, `discardAll` (`reset --hard` + `clean -fd`, ignored files left for `remove --force`) and `listIgnoredCandidates` (`ls-files --others --ignored --exclude-standard --directory -z`). `execGitArgs` gained an optional `{ timeout, maxBuffer }` and reports timeouts plainly; new branches are created with `--no-track` so a workspace branch never adopts `origin/main` as its upstream — not in the plan, added because the default would make a later push target main. `gitStatusManager` now resolves a `.git` file (`gitdir:`) to the real git dir and watches it (`gitDirFromDotGitFile` / `resolveGitDir`), covered in `test/gitStatusWatcher.test.js`; the helpers were smoke-tested end to end on a scratch repo (create, refuse busy branch, status, discard, commit, remove, branch kept).

_Captured: 2026-11-10 · 3 file change(s)_

---

## T04 — Build the main-side workspace lifecycle

Added `src/main/workspaceManager.js` (list + reconcile, create, status, archive, restore, rename, remove-record; mutations serialized per project, rollback of the worktree when the record cannot be saved) on new invoke channels in `ipcChannels.js` plus `WORKSPACES_UPDATED` push, `GIT_DEFAULT_BRANCH` for the dialog and `WORKSPACE_REMOVE_RECORD` for missing records (the last two not in the plan's channel list). `projectRegistry.js` gained `getWorkspaceRecords`/`setWorkspaceRecords`; `frameProject.js` gained `settings.workspaces` get/set + IPC (defaults readable for non-Frame projects, writes need `.frame/`), normalised by a new `normalizeSettings` in `shared/workspaceRegistry.js`. Deviations: `userSettings.js` was not modified — the generic store already serves `workspacesRoot`, so the `~/frame/workspaces` default lives in workspaceManager; and listing filters `git worktree list` rows to folders that still exist, because git keeps a deleted worktree until `prune` and reconcile never flagged it missing (caught by an end-to-end smoke run on a scratch repo).

_Captured: 2026-11-09 · 7 file change(s)_

---

## T05 — Add the active workspace to the renderer

`state.js` gained `getWorkspace` / `getWorkspaceRoot` / `setWorkspace` / `onWorkspaceChange` / `getRememberedWorkspaceId` with `{ id, root, name, branch }` (main = id `main`, root = project path), the per-project selection remembered in localStorage `frame-active-workspace`, and a reset to main on project change (the workspace list re-selects the remembered one once it has the records — T07). The file tree getter (and therefore the git-status watch, Changes and diff, which ride its payload) now uses the workspace root, re-loaded on workspace change in `index.js`; the status-bar branch guard and `statusBar/branchPicker.js` compare against the root and close on workspace change; `sessionsPanel.js` lists sessions by root, reloads when open, and resumes Claude through `resumeAgentSession` with `cwd: root` instead of `resumeClaudeSession` (which always used the project path). Verified by build + suite only — there is no way to select a workspace until T07.

_Captured: 2026-11-09 · 6 file change(s)_

---

## T06 — Scope terminals to workspaces

Terminals now carry `workspaceId` (default `main`) in `terminalManager.js` and `ptyManager.js`; the manager gained `setCurrentWorkspace` / `getCurrentWorkspaceId` / `getTerminalsInScope`, `getTerminalStates()` filters by project + selected workspace, the 9-terminal cap counts per workspace in both processes, and `createTerminal` defaults to the selected workspace and its folder when the caller passes no cwd. Session prefs (`frame-terminal-sessions`, terminals-view `frame-terminals-view`) key non-main workspaces as `<projectPath>#<id>` while main keeps today's keys; `multiTerminalUI.setCurrentWorkspace` is driven straight from `state.setWorkspace` (like a project switch), and `agentDispatch.resumeAgentSession` takes a `workspaceId` and no longer forces `cwd` to the project. Session restore carries `workspaceId` through `sessionRestoreStore` (entry → record → plan, legacy records default to main), `sessionRestore.registerTerminal`, and the renderer, which resumes into the recorded workspace only when it is still live and otherwise at main/project — plus a guard so the restore never focuses a lane outside the selected workspace; covered in `test/sessionRestoreStore.test.js`.

_Captured: 2026-11-09 · 10 file change(s)_

---

## T07 — Add the Workspaces sidebar section

Added `src/renderer/workspaceSection.js` (main row + workspace rows with branch / color name / status dot, ＋ disabled with a reason outside git, ⋯ and right-click menu with Rename… / Rename branch… / Archive…, inline rename, archived toggle with Restore, missing rows with Restore / Remove; re-reads on project change, `WORKSPACES_UPDATED` and window focus, re-selects the remembered workspace, falls back to main when the selection disappears), the pure `src/renderer/workspaces/rollup.js` + `test/workspaceRollup.test.js`, `styles/components/workspaces.css`, the `#workspace-section` container in `index.html` and its init in `index.js`; the dialogs plug in later through `setActions` (T08/T09). Two fixes outside the plan's file list for this step, both found by driving the app over CDP in an isolated HOME: the project nav's Terminals count now reads the selected workspace's terminals (`projectListUI.js`), and the project-change handler loads the file tree at `state.getWorkspaceRoot()` because re-selecting the same project pulled the git watch back to main while the workspace stayed selected. Live-verified: create + select (status bar shows the workspace branch, file tree shows the worktree with the copied `.env`), terminal opens in the worktree and is scoped per workspace, reload restores the selection, rename, archive (selection returns to main), restore, missing state, remove record.

_Captured: 2026-11-09 · 9 file change(s)_

---
