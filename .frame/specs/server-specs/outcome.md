
## T01 — Per-checkout spec readers

Added `listSpecsIn`, `getSpecIn`, `readSpecReportIn`, `updateSpecStatusIn` and `buildSpecCommandFileIn` to `src/main/specManager.js`. Each runs the existing reader under `inCheckout(root)`, which maps every slug of that one checkout to itself for the duration of the synchronous call and then restores the project's map. `listSpecs` now delegates to `listSpecsCore(projectPath, tasksProject, locations)`, and `getCommandPrompt` / `buildSpecCommandFile` take an optional trailing `tasksProject`; the existing signatures are unchanged. Tests in `test/serverSpecs.test.js`.

_Captured: 2026-11-14 · 2 file change(s)_

---

## T02 — Frame Server reads specs

Added `src/server/specs.js` with `specs.list` (which first imports each spec's tasks.md into the server clone's tasks.json through the new `specManager.syncSpecTasksIn`), `specs.get`, `specs.report` and `specs.status` (phase and implement_mode only), registered in `src/server/index.js`; `syncTasksFromMarkdown` gained an optional tasks project. Deviation: the guard checks that `root` is the server project or one of its active workspaces in the server's project registry, not that it sits under the projects folder — server worktrees live in `~/frame/workspaces`, outside it — so `specs.report` also takes `projectPath`. Tests in `test/serverSpecs.test.js` against a project received by bundle and a real server workspace.

_Captured: 2026-11-14 · 4 file change(s)_

---

## T03 — Frame Server watches specs and pushes changes

Added `specs.watch { projectPath, roots }` (replaces the watched set; every root passes the same project/workspace guard) and `specs.unwatch` to `src/server/specs.js`. A recursive `fsSafe.safeWatch` on each root's `.frame/specs` pushes one debounced (300 ms) `specs.changed { root }` per burst. The part's `idle`/`stop` close every watcher when the last desktop leaves. Tests in `test/serverSpecs.test.js` settle before asserting, because macOS FSEvents replays writes made just before a watch starts, and an `after` hook closes watchers so the run cannot hang.

_Captured: 2026-11-14 · 2 file change(s)_

---

## T04 — Frame Server stages spec commands

Added `specs.stage` to `src/server/specs.js`. It provisions the server clone from this package (`structureBootstrap.stageParserScripts`, `commandStaging.stageCommandFiles`, `spec-index.ensureFresh`), copies the tooling into the worktree with `workspaceTooling.provision`, then calls `buildSpecCommandFileIn(worktree, clone, …)`, so `{tasks_path}` names the clone's tasks.json. Unknown commands, bad slugs and `gitSharing: local` projects are refused before anything is written. `module-hint.js` is staged only for projects with the STRUCTURE map, as locally. Also hardened the T03 burst test to settle before measuring; it flaked once under full-suite load, when FSEvents replayed the fixture's setup writes.

_Captured: 2026-11-14 · 2 file change(s)_

---

## T05 — Desktop lists server specs

specManager now caches each server workspace's `specs.list` for the watched project. The cache fills after the workspace-watch push and on `connected`, refreshes one root on `specs.changed`, is re-listed 1.5 s after the server's `workspaces.updated` (server rows reach workspaceManager only when the renderer re-lists), and is tagged offline on `disconnected`. The cache is merged into `listSpecs` through `listSpecsCore(…, extraLists)`. An older server's 'Unknown method' lists nothing. `stopWatching` also sends `specs.unwatch` and is now exported for tests. `mergeSpecLists` carries `host`/`offline` for server entries only, and `chipLabel` gives `name · host [· offline]`. Deviation: the workspace's branch is `null` for server specs, because `serverRoots` does not expose it. Tests in `test/specManagerServer.test.js` and `test/workspaceSpecs.test.js`.

_Captured: 2026-11-14 · 4 file change(s)_

---

## T06 — Route server spec reads and status updates

The `GET_SPEC`, `READ_SPEC_REPORT` and `UPDATE_SPEC_STATUS` handlers now go through `handleGetSpec` / `handleReadSpecReport` / `handleUpdateSpecStatus`. These look up the slug with `remoteSpecEntry`, which follows listSpecs' precedence: a local workspace's copy, then a server workspace's, then main. A server slug is called on Frame Server via `serverPanels.call`. Offline, `GET_SPEC` answers `{ offline: host, workspace }` and the report and status say '<host> is offline — reconnect to open this spec.' A status update re-lists that root. The synchronous `getSpec` / `readSpecReport` / `updateSpecStatus` are unchanged for in-process callers. `renameSpec` refuses a server slug, and `deleteSpec` returns false for one, so a same-named main copy is never removed in its place. Tests in `test/specManagerServer.test.js`.

_Captured: 2026-11-14 · 2 file change(s)_

---
