# Plan — Specs in server workspaces

## Architecture

### Resolved plan-time decisions

The user accepted every recommendation on 2026-11-14 ("önerilerinle ilerleyelim").

Business:
- **B1 Where a server spec's task state lives.** In the server clone's `.frame/tasks.json`, the server's counterpart of the main checkout. The spec card shows progress read from the server. The Mac's `tasks.json` is untouched until the branch is merged and pulled; then the existing import (`syncTasksFromMarkdown` with `completedTaskIdsFromOutcome`) brings the tasks in as completed. One writer, no conflict. Rejected: mirroring server task changes into the Mac's `tasks.json` live (two writers, offline reconciliation).
- **B2 New Spec from main.** Unchanged: it creates a local workspace. To write a spec on the server, the user selects or creates a server workspace first. Rejected: a "local or server?" prompt when connected (a new chooser for a choice the workspace picker already makes).

Technical:
- **T1 Frame Server stages spec commands itself.** The desktop sends only `{ projectPath, root, slug, command, aiTool, description }`. The server:
  - provisions its clone with the same modules the desktop uses (`structureBootstrap.stageParserScripts`, `commandStaging.stageCommandFiles`, the spec index), then copies into the worktree (`workspaceTooling.provision`);
  - builds the prompt from its packaged templates (`getCommandPrompt`, `tasks_path` = the server clone's `tasks.json`);
  - writes it under the worktree's `.frame/runtime/prompts/`.

  The server package already carries `src/` (minus the renderer), `src/templates` and `scripts/` (`scripts/build-server-package.js:64`). Templates follow the server's version; Connect already offers an update when versions differ. Rejected: the desktop builds and uploads the prompt and tooling (files moved on every command; the flow depends on the desktop).
- **T2 Test posture: everything testable.**
  - Server `specs.*` against temp repos.
  - The desktop's server spec cache, routing and staging with a stubbed connection.
  - Pure merge and chip rules in `src/shared`.
  - DOM-coupled renderer code stays untested (testing record: no DOM harness). Rejected: pure logic only.
- **T3 (silent) Live updates.** Frame Server watches `.frame/specs/` in each worktree a desktop asked about and pushes `specs.changed`, as `git.status` does. This is set by the constraint "the server watches and pushes"; no desktop polling.
- **T4 (silent) What the desktop may do to a server spec.**
  - Status updates are routed: phase and `implement_mode`, which the spec flow and the implement modal need.
  - Rename and delete are refused with "Renaming or deleting a spec on a server workspace comes in a later update.", the same read-only rule as server files.
- **T5 (silent) Offline.** The desktop keeps the last known slug, title and phase of each server spec, tagged `offline`. Cards show "<host> · offline". Opening one says "<host> is offline — reconnect to open this spec." No spec content is served from cache.
- **T6 (silent) Old server.** The new methods return "Unknown method" on an older server. The desktop turns that into "Update Frame Server to run specs on this server (File ▸ Connect to Server…)." The protocol number stays 2 (server-hardening rule).
- **T7 (silent) `gitSharing: local`.** A spec in a local-mode project is never committed, so it would vanish with the server worktree. `specs.stage` refuses with "This project keeps Frame files out of git (local mode), so a spec on the server would be lost when the workspace is archived — write it in a local workspace." There is no hand-back from server worktrees.
- **T8 (silent) Desktop `getSpec` stays synchronous.** `workspaceGitState.js:299` calls it synchronously. Server specs are served by the IPC handlers (`GET_SPEC`, `READ_SPEC_REPORT`, `UPDATE_SPEC_STATUS`), which route by the slug's location before falling back to the local readers.
- **T9 (silent) Per-checkout readers.** On the server, `specManager`'s readers take an explicit checkout root and tasks project (`listSpecsIn`, `getSpecIn`, `readSpecReportIn`, `updateSpecStatusIn`). The server keeps no project registry for its worktrees, so slug → checkout lookup (`specLocation`) cannot be used there. The desktop's existing exports keep their signatures and call the same core.

### Components

Server (`src/server/specs.js`, **New**), registered in `src/server/index.js`:

```
specs.list   { projectPath, root }                       → [spec]   (listSpecs item shape)
specs.get    { projectPath, root, slug }                 → getSpec shape (paths are server paths)
specs.report { root, slug, kind }                        → readSpecReport shape
specs.status { projectPath, root, slug, partial }        → { status } | { error }
specs.stage  { projectPath, root, slug, command, aiTool, description }
                                                         → { success, relPath, instruction, launchFlags } | { error }
specs.watch  { roots: [root] }  / specs.unwatch          → event specs.changed { root }
```

`projectPath` is the server clone (`serverProjectPath`); `root` is the worktree. `specs.list` first syncs each spec's `tasks.md` into the server clone's `tasks.json` (as `pushSpecData` does locally), so task counts are real. Paths are checked against the server's own projects folder; nothing outside it is read or written.

Desktop (`src/main/specManager.js`):
- **Cache.** `serverSpecs: Map<workspaceId, { host, root, workspace, specs, offline }>`, filled for the watched project's server workspaces (`workspaceManager.serverRoots()`):
  - `specs.list` on watch start, on `connected` and on workspace changes;
  - refreshed per root on `specs.changed`;
  - marked `offline` on `disconnected`.
- **Listing.** `listSpecs` merges the cache through `mergeSpecLists`. A server entry's `workspace` carries `{ id, name, branch, root, host, offline }`. The precedence is unchanged: a workspace copy beats main, and the first listed workspace wins.
- **Routing.** `remoteLocationOf(projectPath, slug)` returns the server entry for a slug held by a server workspace. `GET_SPEC`, `READ_SPEC_REPORT`, `UPDATE_SPEC_STATUS` route through it via `serverPanels.call`. `RENAME_SPEC` refuses, and `deleteSpec` refuses a server slug (T4).
- **Staging.** `BUILD_SPEC_COMMAND_FILE` with a `workspaceId` that `serverPanels.resolve` maps to a server workspace (or a slug whose location is a server workspace) calls `specs.stage` instead of writing locally.

Renderer:
- `agentDispatch` passes the target `workspaceId` with `BUILD_SPEC_COMMAND_FILE`. It is the selected workspace for `spec.new`, and the spec's workspace for the other commands. The lane already opens in the selected server workspace.
- `workspaceSection.workspaceChipHtml` shows `<name> · <host>`, plus `offline` when the server is not connected. The label comes from a pure `chipLabel` in `src/shared/workspaceSpecs.js`.
- `specPanel` shows the offline message when `GET_SPEC` answers `{ offline: host }`.

### Flows

Server spec list:
1. Watch start or reconnect → `specs.list` per server workspace → cache → `pushSpecData`.
2. An agent on the server writes `status.json` or a report → the server watcher → `specs.changed { root }` → `specs.list` for that root → cache → `pushSpecData` (skip-unchanged gate as today).

Spec command on a server workspace:
1. `dispatchSpecCommand` selects the spec's workspace and invokes `BUILD_SPEC_COMMAND_FILE { …, workspaceId }`.
2. specManager → `specs.stage` on the server: provision, then prompt, then the write.
3. The instruction "Read .frame/runtime/prompts/<file> and follow its instructions exactly." goes to a lane in that server workspace, where the relative path resolves.

## Files

- `src/server/specs.js` — **New**: `specs.list/get/report/status/stage/watch/unwatch` and the `specs.changed` push
- `src/server/index.js` — **Modified**: register the specs methods; stop their watchers on idle
- `src/server/README.md` — **Modified**: document the specs methods
- `src/main/specManager.js` — **Modified**: per-checkout readers (`listSpecsIn`, `getSpecIn`, `readSpecReportIn`, `updateSpecStatusIn`, `buildSpecCommandFileIn` with an explicit tasks project); server spec cache; routed IPC handlers; rename and delete refusal for server slugs; staging route
- `src/shared/workspaceSpecs.js` — **Modified**: `mergeSpecLists` carries `host` and `offline`; `chipLabel(ws)`
- `src/renderer/agentDispatch.js` — **Modified**: send `workspaceId` with `BUILD_SPEC_COMMAND_FILE`
- `src/renderer/workspaceSection.js` — **Modified**: chip with host and offline via `chipLabel`
- `src/renderer/specPanel.js` — **Modified**: the offline message for a server spec
- `test/serverSpecs.test.js` — **New**: server specs methods on temp repos (list with task sync, get, report, status, stage provisioning and prompt, local-mode refusal, path guard, watch push)
- `test/specManagerServer.test.js` — **New**: the desktop cache, merge, offline, routed handlers, rename and delete refusal, staging route, old-server message, with a stubbed connection
- `test/workspaceSpecs.test.js` — **Modified**: `mergeSpecLists` with server entries, `chipLabel`

## Footprint

- src/server/specs.js
- src/server/index.js
- src/server/README.md
- src/main/specManager.js
- src/shared/workspaceSpecs.js
- src/renderer/agentDispatch.js
- src/renderer/workspaceSection.js
- src/renderer/specPanel.js
- test/serverSpecs.test.js
- test/specManagerServer.test.js
- test/workspaceSpecs.test.js

## Dependencies

None.

## Sequencing

1. **Per-checkout readers.**
   - Split `specManager`'s readers into `listSpecsIn`, `getSpecIn`, `readSpecReportIn`, `updateSpecStatusIn` and `buildSpecCommandFileIn`, each taking `(root, tasksProject)`.
   - The existing exports keep their signatures and resolve the root through `specLocation` as today.
   - Cases in `test/serverSpecs.test.js` exercise the readers on a temp checkout, failing first; existing spec tests stay green.
2. **Frame Server reads specs.**
   - `src/server/specs.js` with `specs.list` (syncing `tasks.md` into the server clone's `tasks.json`), `specs.get`, `specs.report`, `specs.status`, and the projects-folder path guard.
   - `specs.watch` / `specs.unwatch` with the `specs.changed` push.
   - Register them in `src/server/index.js` and stop the watchers on idle.
   - Tests in `test/serverSpecs.test.js`, failing first.
3. **Frame Server stages spec commands.**
   - `specs.stage`: provision the clone (parser scripts, command files, spec index), then `workspaceTooling.provision` into the worktree; prompt with `tasks_path` = the server clone; write under the worktree's `.frame/runtime/prompts/`.
   - The local-mode refusal (T7).
   - Tests in `test/serverSpecs.test.js`: the prompt file exists, the relative path resolves from the worktree, the tooling is present, `tasks_path` names the server clone; failing first.
4. **Desktop lists server specs.**
   - The cache in `specManager`: list on watch, `connected` and workspace changes; refresh on `specs.changed`; offline on `disconnected`.
   - `mergeSpecLists` with `host` and `offline`, and `chipLabel`, in `src/shared/workspaceSpecs.js`.
   - The routed `GET_SPEC`, `READ_SPEC_REPORT` and `UPDATE_SPEC_STATUS`; the rename and delete refusal.
   - Tests in `test/specManagerServer.test.js` and `test/workspaceSpecs.test.js`, failing first.
5. **Desktop runs spec commands on the server.**
   - The `BUILD_SPEC_COMMAND_FILE` route to `specs.stage` by `workspaceId` or slug location.
   - "Unknown method" → the update message.
   - `agentDispatch` sends `workspaceId`.
   - Tests in `test/specManagerServer.test.js`, failing first.
6. **Renderer: chip and offline.**
   - `workspaceChipHtml` uses `chipLabel`.
   - `specPanel` shows the offline message.
   - Live check in an isolated app against a locally built server package: New Spec on a server workspace stages on the server, and the spec appears on the board.
   - Document the methods in `src/server/README.md`.
