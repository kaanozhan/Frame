## T01 — Pure rules for tasks in server workspaces

Added `src/shared/serverTasks.js`: `mergeTaskLists` (the Mac's tasks first, unchanged; server tasks tagged with location, host, serverKey, serverProjectPath, tasksPath, offline; the Mac copy wins a duplicate id), `taskChipLabel`, `homeOf`, `splitOrder` (reorder entries `{ id, status? }` split by home) and `runTarget` (a task runs where its tasks.json lives; a server task off its home yields the live workspaces of that server and project to choose from, or `offline` / `no-workspace`). Added `isServerTask` beside them for the callers. Tests in `test/serverTasksModel.test.js`.

_Captured: 2026-11-24 · 2 file change(s)_

---

## T02 — Frame Server tasks methods

Added `src/server/tasks.js` with `tasks.list/add/update/delete/reorder` over the server clone's `.frame/tasks.json` through `tasksManager`, and registered it in `src/server/index.js`. Every call names a registered server project; local sharing mode is refused, as `specs.stage` refuses it. Beyond the plan: a project without Frame (no `.frame/config.json`) lists no tasks and takes no change, because `loadTasks` creates a missing `tasks.json` and the server must not write a `.frame` into such a project. Tests in `test/serverTasks.test.js`, including a server spec's `tasks.md` synced by `specs.list` and then listed, with the workspace's branch clean.

_Captured: 2026-11-24 · 3 file change(s)_

---

## T03 — Frame Server tasks watch

Added `tasks.watch { projectPath }` and `tasks.unwatch` to `src/server/tasks.js`: the server watches the clone's `.frame` folder, not the file, because `tasks.json` is written atomically (tmp file then rename), and pushes a 300 ms debounced `tasks.changed { projectPath }` only for `tasks.json`. A new watch replaces the old one (the desktop follows one project), and `idle`/`stop` drop every watch when the last desktop leaves. A project without Frame watches nothing. Tests in `test/serverTasks.test.js` cover a desktop change, an agent's atomic write, another file ignored, replacement, unwatch and idle.

_Captured: 2026-11-24 · 2 file change(s)_

---

## T04 — Desktop cache and merged TASKS_DATA

Added a desktop-only server-tasks section to `src/main/tasksManager.js`: one cache entry per serverKey + serverProjectPath (from `workspaceManager.serverRoots`), read with `tasks.list`, watched with `tasks.watch`, and followed through `tasks.changed`, connect, disconnect, removed and `workspaces.updated`. Every TASKS_DATA push — the five in tasksManager and the two in `specManager.js` — now goes through `tasksPayload`, which adds the merged list, the Mac's `tasksPath` and `serverNotes` (offline / update). Beyond the plan: LOAD_TASKS, which several surfaces send as they open, refreshes the servers at most once every 2 s with one refresh in flight, and a server that refuses (local mode there) is dropped without a note.

_Captured: 2026-11-24 · 3 file change(s)_

---

## T05 — Route changes to the task's home

In `src/main/tasksManager.js` the task IPC handlers now route: update and delete by the task's home in the merged list (`homeOf`), reorder split by home (`splitOrder`) with a down server's part refused while the rest applies, and add by the selected `workspaceId` (`workspaceManager.serverLocation`). A server change goes through that server's link only and then re-lists that server so the board shows it at once; while the server is down, or when it answers with an error, the change is refused with the host named and nothing falls back to the Mac or another server. TASK_UPDATED keeps its shape and gains `error`; the renderer shows it in T09. Tests extend `test/tasksServerRouting.test.js`.

_Captured: 2026-11-24 · 2 file change(s)_

---

## T06 — Play names the task file by absolute path

`src/renderer/tasks/runPrompt.js` names the task file through `taskFileRef(opts)`: with `opts.tasksPath` the prompt reads and completes the task in "the task list at <absolute path>" and adds that the file can be outside the working folder and the worktree's `.frame/tasks.json` must not be edited; without it the prompt is byte-for-byte as before. `src/renderer/tasksPanel.js` keeps the Mac's `tasksPath` from TASKS_DATA and passes `task.tasksPath` (a server task's clone) or it to the builder. Tests in `test/taskRunPrompt.test.js`; the new one fails on main.

_Captured: 2026-11-24 · 3 file change(s)_

---

