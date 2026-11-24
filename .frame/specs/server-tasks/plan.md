# Plan — Tasks in server workspaces

## Architecture

### Resolved plan-time decisions

- **B1 Where a new task goes:** the same way specs do it (server-specs).
  - With a server workspace selected, it goes to that server clone's `tasks.json`.
  - With the main checkout or a local workspace selected, it goes to the Mac's, as today.

  Rationale: work started in a server workspace keeps its state on that server (server-specs B1), and the user asked for tasks to match specs. Rejected: always the Mac. The agent on the server could not then complete the task, and a second writer would be needed.
- **B2 Which workspace Play uses for a server task:** the selected workspace when it is on that server and project. Otherwise the Task Run dialog asks for one of that server's workspaces of this project. Rejected: always ask.
- **B3 How the board shows server tasks:** one merged list, with a host chip (`host`, plus `· offline` while the server is down), as the Specs board shows server specs. Rejected: a group per server.
- **B4 Play's task-file path:** fixed here for every workspace. The prompt names the task's `tasks.json` by absolute path: the Mac's main checkout for a Mac task, the server clone for a server task. Local workspaces had the same gap: the agent could edit the worktree's tracked copy, and the task state then rode the branch. Rejected: a separate spec.
- **T1 Test posture:** everything testable (testing record: `src/main`, `src/shared`, `src/server`, plus pure renderer logic). DOM surfaces are checked live.
- **T2 (silent) Where task state is merged and routed:** in the main process, as `specManager` does for specs. Each `TASKS_DATA` push carries the merged list, so all eight renderer consumers see the same tasks. Update, delete and status keep their IPC signatures; main resolves a task's home by its id. Add gains `workspaceId`.
- **T3 (silent) Cache key:** one entry per `serverKey + serverProjectPath`, not per workspace. All workspaces of a project on one server share that clone's `tasks.json`; server specs, by contrast, are per worktree.
- **T4 (silent) Live updates:** `tasks.watch { projectPath }` on Frame Server watches the clone's `.frame/tasks.json` and pushes a debounced `tasks.changed { projectPath }`. This mirrors `specs.watch`; the desktop never polls.
- **T5 (silent) Duplicate ids:** a spec's tasks (`task-spec-<slug>-Tnn`) are imported into the Mac as completed after merge and pull, while the server clone still holds them. The Mac copy wins and the server duplicate is hidden. After merge, the Mac is the record (server-specs B1). Other ids are random and cannot collide.
- **T6 (silent) Reorder across homes:** the order is split by home, and each part goes to its own file. A move never transfers a task between homes (Out of Scope).
- **T7 (silent) Down or older servers:**
  - A down server's tasks stay listed, tagged offline, and a change refuses with "<host> is offline — reconnect to change its tasks."
  - A Frame Server without `tasks.list` ("Unknown method") gets a board notice: "Update Frame Server on <host> to see its tasks." Mirrors server-specs.
- **T8 (silent) Local sharing mode:** refused on the server, as `specs.stage` refuses it. Such a project's `.frame` never reaches git, so a server clone of it has no task file worth trusting.
- **T9 (silent) Play's branch choice:** the Task Run dialog hides "new branch" whenever a workspace (local or server) is selected; the task runs on the workspace's branch (#208, #209). The branch list is still main's, for the main checkout.
- **T10 (silent) A Mac task while a server workspace is selected:** it runs in a Mac checkout. The agent on a server cannot write the Mac's `tasks.json`, so the dialog says so and offers the main checkout.
- **Note (not a collision):** spec-context flags `src/main/tasksManager.js` as IN-FLIGHT for `audit-q3-performance-resources`. That comes from a locally modified `status.json` that reads "implementing"; in git the spec is done, and the `loadTasks` cache it planned is already in the file.

### Data shapes

```
Merged task entry (TASKS_DATA tasks[]): the task's own fields, plus for server tasks
  { location: 'server', host, serverKey, serverProjectPath, tasksPath, offline }
  (Mac tasks carry none of these; their file is payload.tasksPath)

TASKS_DATA payload:
  { projectPath, tasks: { ...macFile, tasks: merged[] }, tasksPath, serverNotes: [{ host, kind: 'offline' | 'update' }] }

Frame Server methods (src/server/tasks.js):
  tasks.list    { projectPath }                → { tasks: [...], tasksPath }
  tasks.add     { projectPath, task }          → { task }
  tasks.update  { projectPath, taskId, updates } → { task }
  tasks.delete  { projectPath, taskId }        → { success }
  tasks.reorder { projectPath, order }         → { success }
  tasks.watch   { projectPath } / tasks.unwatch
  event: tasks.changed { projectPath }
```

### How it fits

```
renderer (unchanged consumers) ── LOAD/UPDATE/DELETE/REORDER, ADD(+workspaceId)
  └─ main tasksManager
       Mac tasks.json  ──┐
       server cache ─────┼─ shared/serverTasks.mergeTaskLists → TASKS_DATA (merged, tagged)
       route by id ──────┴─ local write | link.call('tasks.*') on the task's own server
  Frame Server tasks.js → tasksManager on the clone (needProject guard, local-mode refusal)
       watch clone .frame/tasks.json → tasks.changed → main refreshes that entry → push
Play: tasksPanel.openRunFlow → shared/serverTasks.runTarget(task, selected, serverWorkspaces)
       → workspace (or dialog choice) → runPrompt names task.tasksPath | payload.tasksPath
```

## Files

- `src/shared/serverTasks.js` — **New**: pure rules.
  - `mergeTaskLists` (Mac wins a duplicate id; tags server entries);
  - `taskChipLabel` (`host`, `host · offline`);
  - `homeOf(taskId, merged)`;
  - `splitOrder(order, merged)`;
  - `runTarget(task, selected, serverWorkspaces)`.
- `src/server/tasks.js` — **New**: the `tasks.*` methods and the watch on the clone's `tasks.json`, with the project guard and the local-mode refusal.
- `src/server/index.js` — **Modified**: registers `./tasks`.
- `src/main/tasksManager.js` — **Modified**:
  - the server task cache and the merged `TASKS_DATA` (with `tasksPath` and `serverNotes`);
  - routing of add, update, delete and reorder;
  - offline refusal;
  - refresh on connect, disconnect, `tasks.changed` and workspace changes.
- `src/renderer/tasks/runPrompt.js` — **Modified**: the prompt names the task file by absolute path (`opts.tasksPath`).
- `src/renderer/tasksPanel.js` — **Modified**:
  - Play resolves the target workspace and the task file;
  - Add sends `workspaceId`;
  - keeps the payload's `tasksPath`.
- `src/renderer/taskRunModal.js` — **Modified**:
  - no "new branch" while a workspace is selected;
  - a workspace chooser for a server task off its server;
  - the Mac-task note while a server workspace is selected.
- `src/renderer/tasksDashboard.js` — **Modified**:
  - host chip and offline state on server tasks;
  - the "update Frame Server" notice;
  - Add sends `workspaceId`.
- `index.html` — **Modified**: the workspace chooser and the note in `#task-run-modal`.
- `src/renderer/styles/components/workspaces.css` — **Modified**: the task host chip and offline row, reusing the spec chip's look.
- `test/serverTasksModel.test.js` — **New**: the pure rules in `src/shared/serverTasks.js`.
- `test/serverTasks.test.js` — **New**: Frame Server's `tasks.*` on a project received by bundle. Covers list, add, update, delete, reorder, watch push, the guard, local mode, and `/spec.tasks` tasks listed.
- `test/tasksServerRouting.test.js` — **New**: `tasksManager` with fake server links. Covers the merged push, routing by id and by workspace, offline refusal, the older-server notice, and the Mac copy winning a duplicate.
- `test/taskRunPrompt.test.js` — **Modified**: the prompt names the given task file, absolute, for a Mac task and a server task.

## Footprint

- src/shared/serverTasks.js
- src/server/tasks.js
- src/server/index.js
- src/main/tasksManager.js
- src/renderer/tasks/runPrompt.js
- src/renderer/tasksPanel.js
- src/renderer/taskRunModal.js
- src/renderer/tasksDashboard.js
- index.html
- src/renderer/styles/components/workspaces.css
- test/serverTasksModel.test.js
- test/serverTasks.test.js
- test/tasksServerRouting.test.js
- test/taskRunPrompt.test.js

## Dependencies

None.

## Sequencing

1. **Pure rules.** Add `src/shared/serverTasks.js` (`mergeTaskLists`, `taskChipLabel`, `homeOf`, `splitOrder`, `runTarget`) with `test/serverTasksModel.test.js`, covering:
   - Mac wins a duplicate;
   - server entries are tagged;
   - the offline label;
   - a reorder split by home;
   - Play's target for a Mac or server task with each kind of selection.
2. **Frame Server methods.** Add `src/server/tasks.js` and register it in `src/server/index.js`:
   - `tasks.list/add/update/delete/reorder` through `tasksManager` on the clone;
   - `tasks.watch/unwatch` with a debounced `tasks.changed`;
   - the registered-project guard and the local-mode refusal.

   `test/serverTasks.test.js` runs these against a project received by bundle, including tasks written by a `/spec.tasks` sync.
3. **Desktop merge and routing.** In `src/main/tasksManager.js`:
   - cache each server project's tasks;
   - push the merged list with `tasksPath` and `serverNotes`;
   - route update, delete and reorder by id, and add by `workspaceId`;
   - refuse changes offline;
   - refresh on connect, disconnect, `tasks.changed` and workspace updates;
   - an "Unknown method" becomes the update notice.

   `test/tasksServerRouting.test.js` uses fake links.
4. **Play.**
   - `runPrompt.js` names the task file by absolute path.
   - `tasksPanel.openRunFlow` resolves the workspace with `runTarget` and passes the file.
   - `taskRunModal.js` and `index.html`: hide "new branch" in a workspace; add the workspace chooser for a server task off its server; add the Mac-task note.
   - Extend `test/taskRunPrompt.test.js`.
5. **Board.**
   - `tasksDashboard.js`: the host chip, the offline state and the update notice, with CSS in `workspaces.css`.
   - Add sends `workspaceId` (`tasksDashboard.js`, `tasksPanel.js`).
   - Checked live in an isolated app with the fake ssh server: server tasks listed, a change routed, offline, and Play's dialog.
