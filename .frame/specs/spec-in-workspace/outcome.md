
## T01 — Add the pure core workspaceSpecs.js

Added `src/shared/workspaceSpecs.js`: `provisionEntries` (`.frame/bin`, `.frame/runtime/commands`, `.frame/index`, plus `.claude/settings.local.json` in local mode), `mergeSpecLists` (entries tagged `workspace` or null, workspace copy wins a slug clash, first-listed workspace wins between two, listSpecs' own sort), `rootForSlug`, `commandPaths` (`project_path` = the agent's root, `tasks_path` = main) and `handBackSlugs` (local mode only; new slugs and strictly newer copies). `rootForSlug` was not named in the plan; it is the slug → root rule step 3 needs, kept pure here. Tests: `test/workspaceSpecs.test.js` (6 cases).

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Provision Frame tooling into worktrees and hand specs back

Added `src/main/workspaceTooling.js`: `provision` copies `provisionEntries` (bin, runtime/commands, index, plus `.claude/settings.local.json` in local mode) from the main checkout into a worktree, overwriting; `handBack` copies spec folders chosen by `handBackSlugs` into main through `frameStore.specsRoot`/`resolveSpecDir` (status.json `updated_at` as the stamp). `workspaceManager.js` provisions after create and restore, hands back before the archive's `worktree remove --force`, and serves the new `WORKSPACE_PROVISION` channel. Smoke-tested on a scratch Frame project in local mode with Frame's info/exclude entries: all four paths land in the new worktree, and a spec written there is in main's `.frame/specs` after archive while the folder is gone (without those exclude entries the provisioned files would make a worktree look dirty). One full-suite run hung once (killed after 2 min; every file passes alone, `structureLifecycle.test.js` takes ~25 s) and the rerun passed in 34 s — noted as flaky, not caused by this change.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T03 — Make specManager root-aware

Instead of threading a root parameter through every function as the plan sketched, `specManager.js` gained a per-project `specLocations` map (slug → `{ root, workspace }`, rebuilt by `refreshSpecLocations` from main plus every active workspace whose folder exists, workspace winning a slug clash) and `getSpecDir` resolves through it — so status reads/writes, phase reconcile, reports, getSpec, update, delete and the tasks.md import all act on the right checkout with unchanged signatures, while tasks.json stays read through `projectPath`. `listSpecs` iterates the map and tags/sorts through `mergeSpecLists` (so `LIST_SPECS`/`SPEC_DATA` carry the merged list), `searchSpecs` covers every checkout, `getSpec` returns `workspace`, and `renameSpec` keeps the folder in its checkout and registers the new slug's location (without that, the post-move status write landed a stray folder in main). Smoke-tested on the scratch project: a slug in both places resolves to the workspace copy, a workspace-only spec is tagged, rename stays in the worktree, and after a local-mode archive both specs show from main.

_Captured: 2026-11-10 · 1 file change(s)_

---

## T04 — Watch workspace specs folders and import their tasks

`specManager.js` factored its specs watcher callback into `specsWatchHandler` and added `refreshWorkspaceWatchers(projectPath)`: one recursive watcher per active workspace's `.frame/specs` (created if missing) next to main's, closed when the workspace goes, all funnelled into the same debounced `pushSpecData`; `startWatching` ends with it (which also pushes the initial snapshot) and `stopWatching` closes them. `syncAllSpecTasks` now walks every checkout's slugs, so a workspace spec's tasks.md imports into main's tasks.json. `workspaceManager.notify` calls `refreshWorkspaceWatchers` after every mutation (lazy require). Smoke-tested with a fake window: a spec written into a new workspace pushed as `watched@peach:2` with its T01/T02 imported into main's tasks.json, and after archive it pushed as `watched@main:2` (local-mode hand-back).

_Captured: 2026-11-10 · 2 file change(s)_

---

## T05 — Stage spec prompts where the agent runs

`buildSpecCommandFile` / `getCommandPrompt` take a root (explicit for a new spec, else the slug's checkout via `specRoot`), write the prompt to `<root>/.frame/runtime/prompts`, provision tooling into a workspace root right after staging, and fill `{project_path}` with that root and the new `{tasks_path}` with main's tasks.json (`frameStore.resolvePath`, through `commandPaths`); `BUILD_SPEC_COMMAND_FILE` accepts `root`. This fixes the shipped bug where a lane in a worktree was told a relative prompt path that only existed in main. `spec.implement.md` (context line plus every tasks.json reference) and `spec.tasks.md` now name `{tasks_path}`, and the placeholder table in `frameTemplates.js` documents it. Divergences outside the plan's file list, both forced by template contracts: `scripts/spec-command-hint.js` (the terminal `/spec.*` hook that mirrors specManager's interpolation) fills `tasks_path` from the main checkout found through `git rev-parse --git-common-dir`, and `test/codexTemplates.test.js` gained `tasks_path` in its re-render vars — that test compares against the HEAD-committed templates, so it is verified after this commit.

_Captured: 2026-11-10 · 7 file change(s)_

---

## T06 — Send spec work to the right workspace

`agentDispatch.js` gained `_selectSpecWorkspace` (GET_SPEC's new `workspace` decides: select that workspace, or main, before staging) used by `dispatchSpecCommand` and therefore `_dispatchImplement`, and `_workspaceForNewSpec`: from main a new spec first creates a workspace (`WORKSPACE_CREATE`), selects it and runs its setup script without an agent; `dispatchSpecNew` passes that `root` to `BUILD_SPEC_COMMAND_FILE`. `workspaceSection.select` now fires `WORKSPACE_PROVISION`. Live over CDP on the scratch project: New Spec from main created and selected workspace `denim`, ran setup, staged `spec.new__*.md` in the worktree with Project root = the worktree, and opened the Spec Creator lane there; staging `spec.plan` for a spec that lives in `denim` (IPC, no root given) landed in `denim` too. Not exercised live: the renderer re-selecting an existing spec's workspace from main — the test's leftover Spec Creator lane had bound the hand-made spec (existing single-new-slug binding) and kept its action button locked; the path is the same `select` call the new-spec flow exercised.

_Captured: 2026-11-10 · 2 file change(s)_

---
