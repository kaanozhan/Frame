
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
