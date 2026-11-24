## T01 — Pure rules for tasks in server workspaces

Added `src/shared/serverTasks.js`: `mergeTaskLists` (the Mac's tasks first, unchanged; server tasks tagged with location, host, serverKey, serverProjectPath, tasksPath, offline; the Mac copy wins a duplicate id), `taskChipLabel`, `homeOf`, `splitOrder` (reorder entries `{ id, status? }` split by home) and `runTarget` (a task runs where its tasks.json lives; a server task off its home yields the live workspaces of that server and project to choose from, or `offline` / `no-workspace`). Added `isServerTask` beside them for the callers. Tests in `test/serverTasksModel.test.js`.

_Captured: 2026-11-24 · 2 file change(s)_

---

## T02 — Frame Server tasks methods

Added `src/server/tasks.js` with `tasks.list/add/update/delete/reorder` over the server clone's `.frame/tasks.json` through `tasksManager`, and registered it in `src/server/index.js`. Every call names a registered server project; local sharing mode is refused, as `specs.stage` refuses it. Beyond the plan: a project without Frame (no `.frame/config.json`) lists no tasks and takes no change, because `loadTasks` creates a missing `tasks.json` and the server must not write a `.frame` into such a project. Tests in `test/serverTasks.test.js`, including a server spec's `tasks.md` synced by `specs.list` and then listed, with the workspace's branch clean.

_Captured: 2026-11-24 · 3 file change(s)_

---

