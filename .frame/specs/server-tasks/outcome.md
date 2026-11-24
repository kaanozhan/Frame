## T01 — Pure rules for tasks in server workspaces

Added `src/shared/serverTasks.js`: `mergeTaskLists` (the Mac's tasks first, unchanged; server tasks tagged with location, host, serverKey, serverProjectPath, tasksPath, offline; the Mac copy wins a duplicate id), `taskChipLabel`, `homeOf`, `splitOrder` (reorder entries `{ id, status? }` split by home) and `runTarget` (a task runs where its tasks.json lives; a server task off its home yields the live workspaces of that server and project to choose from, or `offline` / `no-workspace`). Added `isServerTask` beside them for the callers. Tests in `test/serverTasksModel.test.js`.

_Captured: 2026-11-24 · 2 file change(s)_

---

