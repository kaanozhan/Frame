# Plan — Specs inside workspaces

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 Task state:** the agent keeps editing `tasks.json`, but every spec template is given the main checkout's absolute path in a new `{tasks_path}` placeholder. Task state lives in the project home only; a workspace branch never carries `tasks.json` changes, so merges cannot conflict there. Rejected: task state in the spec folder imported on merge. It is better for moving work between machines, but it rewrites the templates and `derivePhase`.
- **B2 New spec from main:** always create a workspace first (Conductor's model). A dropped idea is cleaned up by archiving. Rejected: asking every time (an extra step on every spec).
- **B3 `gitSharing: local`:** on archive, the worktree's spec folders are copied into the main checkout before the folder is removed. Without this, `worktree remove --force` deletes them. Both modes behave the same. Rejected: keeping specs in the main checkout in local mode (two behaviours).

Technical (asked):
- **T1 Tooling in worktrees:** copy, don't symlink. On create and restore, on every spec command, and on every workspace selection, Frame copies `.frame/bin`, `.frame/runtime/commands` and `.frame/index` into the worktree (plus `.claude/settings.local.json` in local mode, where the hook file is untracked). The hint scripts resolve their root from the hook cwd and then read the worktree's own `.frame/` (evidence: `scripts/spec-hint.js:68-75`). Copies therefore need no script change. Rejected: symlinks (Windows needs privileges; Node realpaths `__dirname` to main and muddles root resolution).
- **T2 Test posture:** pure logic only, the project's convention (testing record).

Technical (silent):
- **Existing bug fixed here:** today a spec command dispatched while a workspace is selected stages its prompt in the main checkout but tells the agent the relative path. The agent's cwd is the worktree, so the file is not found (`specManager.js:812-841`, `terminalManager.js:342-347`). Prompts are now staged in the root the agent runs in.
- **Root resolution:** every spec IPC that names a slug (`GET_SPEC`, `UPDATE_SPEC_STATUS`, `RENAME_SPEC`, `READ_SPEC_REPORT`, `BUILD_SPEC_COMMAND_FILE`) resolves the slug to its root through the merged list. Renderer payloads stay the same. `spec.new` passes an explicit `root` (the target workspace's folder).
- **Merged list:** `LIST_SPECS` and `SPEC_DATA` carry main's specs plus each active, present workspace's specs. Each entry gets `workspace: { id, name, branch, root } | null`. On a slug in both places, the workspace copy wins while that workspace is active. Sort order stays as today (malformed first, then `updated_at` desc).
- **Watchers:** besides main's specs root, one recursive watcher per active workspace specs root. The set is recomputed when workspaces change (workspaceManager calls specManager after every mutation).
- **Task import:** `syncTasksFromMarkdown` reads `tasks.md` / `outcome.md` from the spec's root and writes main's `tasks.json` (unchanged target).
- **Templates:** `{project_path}` becomes the agent's root (the worktree for a workspace spec). `{tasks_path}` is main's `tasks.json` (resolved through `frameStore.resolvePath`, so legacy layouts keep working).
- **Opening a spec selects its workspace** (or main) first, then opens the drawer (`multiTerminalUI.showSpecsGrid` + `specsDashboard.openSpec`). Dispatching a spec command does the same before staging.
- **Creating a spec from main** creates a workspace with default options through `WORKSPACE_CREATE`, selects it, runs its setup script without starting an agent, and dispatches the Spec Creator lane there.
- **Spec paths** keep going through `frameStore.specsRoot(root)` / `resolveSpecDir(root, slug)` (metaPathGuard). Both already accept any root.
- **Stale in-flight footprints** (`audit-q3-cross-platform`, `audit-q3-performance-resources`) on `specManager.js` / `frameProject.js` / `agentDispatch.js` are dormant. They are noted, not blocking.

### Data shapes

Spec list entry (unchanged fields + one new):

```
{ slug, title, phase, ai_tool, task_count, completed_count, created_at, updated_at, reports?,
  workspace: null | { id, name, branch, root } }
```

`BUILD_SPEC_COMMAND_FILE` payload gains an optional `root`. It returns `instruction` relative to that root, as today.

### Components

- **`src/shared/workspaceSpecs.js`** (pure, New):
  - `mergeSpecLists(mainSpecs, workspaceLists)`: merge, dedupe and sort;
  - `provisionEntries({ gitSharing })`: what to copy into a worktree;
  - `commandPaths({ projectPath, root, tasksPath })`: placeholder values;
  - `handBackSlugs(worktreeSlugs, mainSlugs, mode)`: which spec folders return to main on archive.
- **`src/main/workspaceTooling.js`** (New): `provision(projectPath, worktreePath)` copies the entries (overwrite, recursive); `handBack(projectPath, worktreePath)` copies spec folders into main in local mode.
- **`specManager.js`:**
  - root-aware listing and reads, `listAllSpecs(projectPath)`, slug → root resolution;
  - prompt staging into the root;
  - per-workspace watchers and `refreshWorkspaceWatchers(projectPath)`.
- **`workspaceManager.js`:** provision on create/restore, hand back before archive removal, call `specManager.refreshWorkspaceWatchers` after mutations, new `WORKSPACE_PROVISION` IPC.
- **Renderer:**
  - `agentDispatch` picks or creates the target workspace;
  - the specs board, spec panel, Home widget and workspace rows show where a spec lives;
  - opening a spec selects its workspace.

## Files

- `src/shared/workspaceSpecs.js` — **New**: pure merge/dedupe, provision entries, command paths, hand-back selection
- `src/main/workspaceTooling.js` — **New**: copy Frame tooling into a worktree; hand spec folders back to main
- `src/main/specManager.js` — **Modified**: root-aware spec paths, merged list, slug→root resolution in IPC, per-workspace watchers, prompt staging into the agent's root, `{tasks_path}`, tasks import from roots
- `src/main/workspaceManager.js` — **Modified**: provision on create/restore, hand back on archive, refresh spec watchers, `WORKSPACE_PROVISION`
- `src/shared/ipcChannels.js` — **Modified**: `WORKSPACE_PROVISION`
- `src/templates/commands/claude-code/spec.implement.md` — **Modified**: tasks file named by `{tasks_path}`
- `src/templates/commands/claude-code/spec.tasks.md` — **Modified**: import note names `{tasks_path}`
- `src/shared/frameTemplates.js` — **Modified**: the documented placeholder list gains `{tasks_path}`
- `src/renderer/agentDispatch.js` — **Modified**: spec.new targets the selected workspace or creates one from main; spec commands select the spec's workspace and pass its root
- `src/renderer/specsDashboard.js` — **Modified**: workspace chip on cards; opening a workspace spec selects its workspace
- `src/renderer/specPanel.js` — **Modified**: workspace chip on rows; open selects the workspace
- `src/renderer/home/widgets/activeSpecs.js` — **Modified**: workspace chip on rows
- `src/renderer/workspaceSection.js` — **Modified**: rows show the spec they hold (click opens it); provision on select
- `src/renderer/styles/components/workspaces.css` — **Modified**: `.ws-chip` and the row's spec line
- `test/workspaceSpecs.test.js` — **New**: merge/dedupe/sort, provision entries per mode, command paths, hand-back selection

## Footprint

- src/shared/workspaceSpecs.js
- src/main/workspaceTooling.js
- src/main/specManager.js
- src/main/workspaceManager.js
- src/shared/ipcChannels.js
- src/templates/commands/claude-code/spec.implement.md
- src/templates/commands/claude-code/spec.tasks.md
- src/shared/frameTemplates.js
- src/renderer/agentDispatch.js
- src/renderer/specsDashboard.js
- src/renderer/specPanel.js
- src/renderer/home/widgets/activeSpecs.js
- src/renderer/workspaceSection.js
- src/renderer/styles/components/workspaces.css
- test/workspaceSpecs.test.js

## Dependencies

None.

## Sequencing

1. **Pure core.** Add `src/shared/workspaceSpecs.js`:
   - `mergeSpecLists` (workspace copy wins on a slug clash, existing sort kept);
   - `provisionEntries` (`.frame/bin`, `.frame/runtime/commands`, `.frame/index`, plus `.claude/settings.local.json` in local mode);
   - `commandPaths`;
   - `handBackSlugs`.

   Tests in `test/workspaceSpecs.test.js`.
2. **Tooling in worktrees.**
   - Add `src/main/workspaceTooling.js`.
   - In `workspaceManager.js`: provision after create and restore; hand spec folders back to main before the archive removal (local mode); expose `WORKSPACE_PROVISION` (channel in `ipcChannels.js`).
3. **Root-aware specs in main.** In `specManager.js`:
   - spec path helpers take a root;
   - `listSpecs(projectPath, root)` reads a root but counts tasks from main's `tasks.json`;
   - `listAllSpecs(projectPath)` merges main with active workspaces (records from `projectRegistry`, folders that exist);
   - `GET_SPEC` / `UPDATE_SPEC_STATUS` / `RENAME_SPEC` / `READ_SPEC_REPORT` resolve slug → root;
   - `LIST_SPECS` and `SPEC_DATA` carry the merged list;
   - `syncAllSpecTasks` imports from each spec's root;
   - watchers are added per workspace specs root, with `refreshWorkspaceWatchers` called by workspaceManager after every mutation.
4. **Prompts staged where the agent runs.**
   - `BUILD_SPEC_COMMAND_FILE` accepts `root` (or resolves it from the slug), provisions tooling into a workspace root, and stages the prompt in `<root>/.frame/runtime/prompts`.
   - `{project_path}` is filled with the root and the new `{tasks_path}` with main's `tasks.json`.
   - Update `spec.implement.md`, `spec.tasks.md` and the placeholder list in `frameTemplates.js`.
5. **Dispatch targets the right workspace.** In `agentDispatch.js`:
   - `dispatchSpecNew` uses the selected workspace, or from main creates one (`WORKSPACE_CREATE`), selects it, runs its setup script without an agent (`newWorkspaceModal.runSetupThenAgent({ openAgent: false })`) and dispatches the Spec Creator there with `root`;
   - `dispatchSpecCommand` / `_dispatchImplement` select the spec's workspace (or main) before staging.

   `workspaceSection.js` invokes `WORKSPACE_PROVISION` when a workspace is selected.
6. **Show where a spec lives.**
   - A workspace chip on spec cards (`specsDashboard.js`), spec panel rows (`specPanel.js`) and Home's Active Specs (`home/widgets/activeSpecs.js`).
   - Opening a workspace spec selects its workspace, then opens the drawer.
   - Workspace rows show `spec · <slug>` for the in-flight spec they hold, and clicking it opens that spec.
   - Styles in `workspaces.css`.
