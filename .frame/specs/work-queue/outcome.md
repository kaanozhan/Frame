## T01 — Pure queue rules

Added src/shared/queueRules.js (pure) and test/queueRules.test.js (17 tests): add with refusals, remove, reorder, transition-checked setState, setParallel (1–9, default 9), setFlowMode, nextRunnable(min(parallel − running, freeSlots)), markInterrupted, deriveMissing, mergeQueues/homeOf, worktreeKey/queueBranch/queueWorktreeRel and startCommand (spec.auto in full auto, the next phase in step by step). Beyond the plan, interrupted items are startable so a resume needs no separate path, and a done item may be queued again.

_Captured: 2026-11-25 · 2 file change(s)_

---

## T02 — Queue store and machine-local queue.json

Added src/main/queueStore.js: load/save/update/reconcile over .frame/queue.json, with atomic writes and .bak/corrupt recovery through fsSafe. A refused rule writes nothing. Added 'queue.json' to FRAME_FILE_CLASSES.runtime (src/shared/frameConstants.js), so the managed .frame/.gitignore block lists it the next time Frame regenerates it. test/queueStore.test.js has 6 tests; 'interrupted on load' is reconcile(checkout, liveIds), which the owners call with their live terminal ids.

_Captured: 2026-11-25 · 3 file change(s)_

---

## T03 — Desktop queue manager and IPC

Added src/main/queueManager.js (Mac queue, QUEUE_DATA push per change, missing derived from loadTasks/listSpecs) and the QUEUE_LOAD/DATA/ADD/REMOVE/REORDER/SET/PARALLEL channels, wired in src/main/index.js. The source facts (task status/source, spec phase) come with the add request and queueRules decides; refusals return REFUSAL_TEXT. Smoke-tested in Node with a stubbed electron; no unit test, as the plan puts tests on the pure rules and the store.

_Captured: 2026-11-25 · 3 file change(s)_

---

## T04 — Server queue and desktop merge

Added src/server/queue.js and test/serverQueue.test.js (5 tests), and the server merge/routing in src/main/queueManager.js (refreshServerQueues, per-home add/remove/reorder/set/parallel, offline refusal 'host is offline — reconnect to change its queue.'). Deviation from plan D9: the queue file is .frame/runtime/queue.json, not .frame/queue.json, because a new gitignore entry would not reach existing clones; the queue.json entry added to FRAME_FILE_CLASSES in T02 was removed. A source names its server home with source.home = { location:'server', serverKey, serverProjectPath, host }.

_Captured: 2026-11-25 · 7 file change(s)_

---

## T05 — Queue view and sidebar row

Added src/renderer/queueView.js and queue.css, the 'queue' view mode (multiTerminalUI.showQueue/_renderQueueView, terminalManager comment), the Queue row with its count in projectListUI's Work group, and 'Go to Queue' in paletteSources. Checked in an isolated Frame instance: rows, the missing state, the Step toggle written to queue.json, reorder, Remove and Open spec all worked. The view adds a header note ('Start it from the Chief'); the Start queue button itself is T12.

_Captured: 2026-11-25 · 7 file change(s)_

---

## T06 — Queue tasks: Play choice, drawer action, drag

Added 'Add to queue' to the Run task dialog (index.html, taskRunModal.js onQueue, tasksPanel.js), to the task drawer's pending actions, and as drag-and-drop of pending non-spec tiles onto the sidebar Queue row or the Queue view (tasksDashboard.js, projectListUI.js, queueView.sourceForTask). Checked in an isolated Frame instance; drops were exercised with synthetic DragEvents.

_Captured: 2026-11-25 · 6 file change(s)_

---

## T07 — Queue specs: card icon and drag

Added the queue icon and card drag to specsDashboard.js (queueButtonHtml, wireQueue, canQueue), sourceForSpec to queueView.js and the icon's styles to queue.css. Beyond the plan's file list for this step, specManager.js's server spec workspace object gained serverProjectPath (the file is in the plan's footprint for T09). Checked in an isolated Frame instance.

_Captured: 2026-11-25 · 4 file change(s)_

---

## T08 — Queue worktrees and item preparation

Added createQueueWorktree and friends to gitBranchesManager.js and src/main/queueRunner.js (prepare for specs and tasks), and exported getAutoLaunchFlags from specManager.js. Changed worktreeKey so a task id that already reads task-… is not prefixed again (queueRules.js and its test). Smoke-tested on a temp git repo; the staged implement prompt names the main checkout's tasks.json. A spec copied into a worktree is copied only when the worktree has none, so a resumed item keeps its own progress.

_Captured: 2026-11-25 · 5 file change(s)_

---

## T09 — Specs running in queue worktrees stay visible

Added the queue-roots provider to specManager.js (registered by queueManager.js and src/server/queue.js), queue worktrees as accepted roots in src/server/specs.js, and queueRules.worktreeRoots. Deviations: src/shared/workspaceSpecs.js mergeSpecLists now keeps serverKey, serverProjectPath and a queue flag (it dropped them, which broke T07's server-spec routing), src/renderer/workspaceSection.js skips selecting a queue worktree, and test/specManagerServer.test.js's pinned workspace shape gained the two server fields; none of the three files was in the plan. A server spec always lives in a server workspace (server-specs), so on servers only tasks get queue worktrees.

_Captured: 2026-11-25 · 9 file change(s)_

---

## T10 — Chief queue tools and the agent starter

Added ctx for registered tools, startAgent and the queue_list/queue_start/queue_update tools to src/main/leadHost.js; the desktop terminal round trip in leadManager.js and terminalManager.js (LEAD_OPEN_TERMINAL_REQUEST/REPLY); the queue and task-status adapter; and the restart reconcile in queueManager's QUEUE_LOAD. Deviations: queued → failed is now a legal transition (queueRules.js + test), and a start that hits a Claude question (trust this folder) returns started-waiting and delivers the prompt once the user answers. Followup: every new worktree asks Claude's trust question, so an unattended queue needs a decision on pre-trusting queue worktrees.

_Captured: 2026-11-25 · 7 file change(s)_

---

## T10 — follow-up: Claude's trust question in queue worktrees

The end-to-end run showed Claude asks "trust this folder?" in every new queue worktree, defaulting to "No, exit". By the user's decision, startAgent now answers Yes (↓ ⏎) only for a queue worktree under the project's .frame/worktrees/ and only when Claude already trusts the project folder or a parent (read-only check of ~/.claude.json); otherwise the item stays started-waiting and the prompt follows once the user answers. Verified end to end: trusted parent → "started", hello.txt written unattended; untrusted folder → "started-waiting", no answer sent. Recorded in PROJECT_NOTES.md.

_Captured: 2026-11-25 · 1 file change(s)_

---

