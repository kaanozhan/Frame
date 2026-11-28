# Plan — Work queue

## Architecture

### Resolved plan-time decisions

Business (asked):
- **D1. Button name.** **Start queue**; while it runs, the button shows "Queue running · n/m". Rejected: "Work the queue" (longer).
- **D2. Task permissions.** Queued tasks start with the same launch flags as full-auto specs: `getAutoLaunchFlags`, which is `--settings <implement permissions> --permission-mode auto`. Rationale: the queue runs while the user is away, and each item is in its own worktree, so it cannot reach `main`. Rejected: normal permissions, where the queue would stall on every prompt.
- **D3. Parallel limit.** The default is 9, and the user changes it from the Chief's screen, not the queue screen (user's call). The effective limit is the smaller of that number and the free terminal slots. The Chief is outside the 9-terminal cap and never counts toward it.
- **D4. Finished item.** A finished item stays as **review** until the user marks it Done on the queue screen. Its worktree and branch stay.

Business (decided earlier in this spec's conversation, recorded here):
- **D5. Storage.** One queue per machine: `.frame/queue.json` in the machine's main checkout or server clone. A server Chief works its queue while the Mac is away.
- **D6. Spec mode.** A spec item resumes from its current phase, in full auto by default; step by step is set per item.
- **D7. Trigger.** Only the user's Start queue press starts the queue. Adding an item never starts it.
- **D8. Isolation.** Every item runs in a plain git worktree (not a Frame workspace). Merging finished worktrees and cleaning them up come later, managed by the Chief.

Technical (silent: one defensible answer, recorded):
- **D9. `queue.json` is machine-local.** It is added to the `runtime` class in `FRAME_FILE_CLASSES` (`src/shared/frameConstants.js:65`), so Frame's managed `.frame/.gitignore` block ignores it. Rationale: it holds terminal ids and worktree paths. A tracked file would also dirty a server clone on every state change.
- **D10. The Chief drives the queue with deterministic tools.** The Chief, the LLM, picks items and judges results. Everything mechanical happens in the host's tools: create the worktree, provision it, stage the prompt, open the terminal, start the agent, record state. Rationale: this is the user's goal ("Chief delegates, monitors, checks"), and the LLM never improvises git or CLI commands. Rejected: a scheduler with no Chief, which would not be the user's vision.
- **D11. One agent starter, in the host. Only terminal creation differs per machine.**
  - The host's `startAgent` writes the CLI command into the new PTY, waits for the OSC 7501 `ready` status, then pastes the prompt (bracketed paste, `\r`).
  - On the desktop, `adapter.createTerminal` asks the renderer to create the lane. This is the `ORCH_SPAWN_WORKER` request/reply pattern, so the lane is visible, is filed under its project, gets its assignment chip, and does not steal focus. Main-created PTYs are invisible to the renderer, so that path was rejected.
  - On the server, `ptyManager.createTerminal` runs with a `queue` meta flag. The server broadcasts `lead.terminalOpened`, and the desktop re-adopts that project's server terminals.
  - Rejected: reusing the renderer's `agentDispatch` on the desktop, because the server has no renderer and that would leave two starters.
- **D12. Claude Code only, in v1.** Readiness and progress come from OSC 7501, which only Claude Code (≥2.1.295) reports. Items start with the `claude-code` tool. Codex queue runs are left for later.
- **D13. Approvals.**
  - `queue_start` raises one approval per item, `{ action:'queue_start', target:itemId, summary, payload:{ kind, ref, worktree, branch, command } }`. It names the item, its worktree and the terminal it will open.
  - Spec S7 was reworded from "each action raises a card" to "one card per item". Two cards for one start would only be noise.
  - `register()`'d tools get a `ctx = { requestApproval, needsApproval, mode }` third argument, because `requestApproval` is closure-internal today (`leadHost.js:313`).
- **D14. Worktree convention.**
  - Path: `.frame/worktrees/queue-<key>`. Branch: `frame/queue/<key>`. Both are created from the checkout's current HEAD.
  - `<key>` is the spec slug, or `task-<taskId>`, plus `-2`, `-3`… on a clash with an existing branch.
  - Prefixing with `queue-` keeps it apart from the conductor's `.frame/worktrees/<slug>` (`gitBranchesManager.js:764-797`), which force-removes stale paths.
  - An existing queue worktree for the same item, such as a spec resumed after an interruption, is reused, not recreated.
- **D15. Spec files in the worktree.** The worktree is created from HEAD, so an uncommitted spec folder (the usual case) would be missing there. The start copies `.frame/specs/<slug>/` from the main checkout into the worktree when the worktree has no newer copy. `workspaceTooling.provision(projectPath, worktreePath)` (`workspaceTooling.js:42`) copies Frame tooling, as spec-in-workspace does.
- **D16. Spec visibility.**
  - `specManager` adds the running and review queue worktrees of a project to its checkout map. `activeWorkspaceRoots` (`specManager.js:90`) gains a `queueRoots` provider, and a worktree's copy wins over `main`, as a workspace's does.
  - On the server, `specs.js` `checkout()` (`src/server/specs.js:57`) also accepts the project's queue worktrees.
- **D17. Task state never forks.**
  - The task prompt is `buildTaskPrompt` (`src/renderer/tasks/runPrompt.js`, pure; main and server can require it). It carries the main checkout's absolute `tasksPath`.
  - Starting an item sets the task `in_progress` through `tasksManager` on its machine, as Play does after dispatch.
- **D18. A spec in a Frame workspace.** A spec whose folder already lives in a Frame workspace runs in that workspace's checkout, not in a new worktree, so the spec never forks across two branches.
- **D19. Restart recovery.** On load, a `running` item whose terminal no longer exists becomes `interrupted`. Its worktree stays. Start queue resumes it in the same worktree; a spec resumes from its phase. The user can also reset it to `queued` or remove it.
- **D20. Step by step.**
  - The item runs one phase command, picked by `specFlow`: specified → `spec.plan`, planned → `spec.tasks`, tasks_generated or implementing → `spec.implement`.
  - When the phase ends, the item becomes `needs-you`. **Continue** on the queue screen puts it back in `queued`.
  - Full auto runs `spec.auto` and writes `flow_mode:'full-auto'` and `implement_mode:'autonomous'` into the worktree copy's `status.json`. This is what `_startFullAutoRun` (`agentDispatch.js:721`) records.
- **D21. Tests: pure logic only (asked).** This matches the testing record. Covered: queue rules, worktree keys, list merge, server queue methods, store round-trip. No DOM tests.

### Data shapes

`.frame/queue.json`, one file per machine:

```json
{ "version": 1, "parallel": 9,
  "items": [ { "id": "q_ab12cd", "kind": "task|spec", "ref": "<taskId|slug>",
    "title": "snapshot for a missing source", "addedAt": "ISO",
    "state": "queued|running|needs-you|review|done|failed|interrupted|missing",
    "flowMode": "full-auto|step-by-step", "worktree": { "path": "...", "branch": "..." },
    "terminalId": null, "startedAt": null, "finishedAt": null, "note": null } ] }
```

- `flowMode` is only present on spec items.
- `missing` is derived on read, never stored. It applies when the task id or spec slug is gone.

The desktop pushes `QUEUE_DATA` = `{ projectPath, items: [...macItems, ...serverItems], parallel, serverNotes }`.
- Each server item carries `host`, `serverKey`, `serverProjectPath` and `offline`, the same model as `tasksPayload` (`tasksManager.js:493`).
- Changes route by item id to their home queue.
- An offline home refuses the change and names the host.

### Components

- **`src/shared/queueRules.js` (pure).**
  - `add` refuses duplicates, spec tasks and completed tasks.
  - It also provides `remove`, `reorder`, `setState` (with a legal-transition table), `nextRunnable(items, { parallel, freeSlots })`, `worktreeKey`, `markInterrupted`, `deriveMissing`, `mergeQueues`, `homeOf` and `nextPhaseCommand`.
- **`src/main/queueStore.js`.** Reads and writes `.frame/queue.json` atomically (fsSafe) for one checkout. It is used by the desktop and by Frame Server.
- **`src/main/queueRunner.js` (machine-agnostic).** `prepare(item)` does: worktree (D14), provision plus spec copy (D15), command (D2/D20), staged prompt via `buildSpecCommandFileIn(worktree, mainCheckout, …)` or `buildTaskPrompt`.
- **`leadHost` (`src/main/leadHost.js`).**
  - It gains `ctx` for registered tools and `startAgent(chief, terminalId, command, prompt)`.
  - It also gains the queue tools:
    - `queue_list`: this machine's items with live state.
    - `queue_start(itemId)`: approval, then prepare, then `adapter.createTerminal`, then `startAgent`; the result is the state `running`.
    - `queue_update(itemId, state, note)`: review, failed or needs-you.
  - A terminal exit on a `running` item marks it `interrupted`, unless the Chief already moved it.
- **`queueManager` (`src/main/queueManager.js`, desktop).**
  - It provides store access, server routing and merging.
  - IPC: `QUEUE_LOAD/ADD/REMOVE/REORDER/SET/PARALLEL`, plus the `QUEUE_DATA` push. `QUEUE_SET` handles Done, Continue and Reset.
  - It forwards `queue.changed` from servers.
  - It registers the `queueRoots` provider with `specManager`.
- **`src/server/queue.js`.**
  - Methods `queue.list/add/remove/reorder/set/parallel` and `queue.watch`, which emits `queue.changed`.
  - It mirrors `src/server/tasks.js`: registered projects only, folder watch, 300 ms debounce.
- **Start queue.**
  - The Chief lane button sends a fixed prompt into the Chief's own session, using the same bracketed paste.
  - The prompt says to work this machine's queue now, with up to N in parallel, then report.
  - `CHIEF.md` gains a short "Queue" section, staying within the 4096-character hello limit: the loop is list, start, wait, judge, update. Keep the context lean: judge from `terminal_read` summaries, never from full transcripts.
- **Renderer.**
  - A `Queue` row under Terminals in the Work group, with a count of items not in done. It is a drop target for task tiles and spec cards.
  - A `queue` center view (`queueView.js`, mounted like the dashboards through `_renderDashView`).
    - It lists items in order, with drag reordering through `dnd/reorder.js`.
    - Each row shows its state chip, host chip, worktree and branch, and terminal link.
    - Row actions: Remove, Open source, and Done, Continue or Reset depending on state.
    - A spec row has a mode toggle.
  - Task tiles become draggable. The run modal gets an **Add to queue** button beside Run. The detail drawer gets an "Add to queue" action.
  - Spec cards get a queue icon (filled when queued) and are draggable.
  - The Chief lane gets Start queue plus a parallel stepper.
  - Palette: "Go to Queue" and "Start queue".

## Files

- `src/shared/queueRules.js`: **New.** Pure queue rules, merge, next-runnable, worktree keys, phase command.
- `src/main/queueStore.js`: **New.** Atomic read/write of one checkout's `.frame/queue.json`.
- `src/main/queueRunner.js`: **New.** Prepares an item: worktree, provisioning, spec copy, command and prompt.
- `src/main/queueManager.js`: **New.** Desktop store, server routing and merge, IPC, `QUEUE_DATA` push, `queueRoots` provider.
- `src/server/queue.js`: **New.** Frame Server `queue.*` methods and the `queue.changed` watch.
- `src/shared/frameConstants.js`: **Modified.** Adds `queue.json` to the runtime class (D9).
- `src/shared/ipcChannels.js`: **Modified.** `QUEUE_*`, `LEAD_OPEN_TERMINAL_REQUEST/REPLY`, `LEAD_QUEUE_START`.
- `src/main/leadHost.js`: **Modified.** `ctx` for registered tools, `startAgent`, queue tools, exit → interrupted.
- `src/main/leadManager.js`: **Modified.** Desktop `createTerminal` via a renderer request, Start queue IPC, forwards `lead.terminalOpened`.
- `src/server/lead.js`: **Modified.** Server `createTerminal` with the `queue` flag, plus the `lead.terminalOpened` broadcast and `lead.queueStart`.
- `src/server/terminals.js`: **Modified.** `queue` flag in create, meta and list.
- `src/server/specs.js`: **Modified.** `checkout()` accepts queue worktrees (D16).
- `src/server/index.js`: **Modified.** Wires `queue.js`.
- `src/main/specManager.js`: **Modified.** `queueRoots` provider in the checkout map (D16).
- `src/main/gitBranchesManager.js`: **Modified.** `createQueueWorktree` / `queueWorktreePath` (D14).
- `src/main/ptyManager.js`: **Modified.** `adoptFrom` accepts `queue` terminals of the server project.
- `src/main/index.js`: **Modified.** Init and IPC for `queueManager`.
- `src/templates/lead/CHIEF.md`: **Modified.** Queue section.
- `src/renderer/queueView.js`: **New.** Queue center view.
- `src/renderer/styles/components/queue.css`: **New.** Queue view, drop highlight, queue icon.
- `src/renderer/styles/main.css`: **Modified.** Imports `queue.css`.
- `src/renderer/projectListUI.js`: **Modified.** Queue row, count, drop target.
- `src/renderer/multiTerminalUI.js`: **Modified.** `showQueue()`, `queue` view mode in render and `getActiveSurface`.
- `src/renderer/terminalManager.js`: **Modified.** `queue` view mode, plus the `LEAD_OPEN_TERMINAL_REQUEST` listener (create lane, set assignment, reply).
- `src/renderer/tasksDashboard.js`: **Modified.** Draggable tiles, "Add to queue" drawer action.
- `src/renderer/taskRunModal.js`: **Modified.** `onQueue` option and Add to queue button.
- `index.html`: **Modified.** Add to queue button in the run modal's footer.
- `src/renderer/tasksPanel.js`: **Modified.** `openRunFlow` passes `onQueue`.
- `src/renderer/specsDashboard.js`: **Modified.** Queue icon on cards, draggable cards.
- `src/renderer/chiefLane.js`: **Modified.** Start queue button, running label, parallel stepper.
- `src/renderer/styles/components/chief.css`: **Modified.** Start queue and stepper styles.
- `src/renderer/paletteSources.js`: **Modified.** "Go to Queue".
- `src/renderer/index.js`: **Modified.** "Start queue" command, `queueView` init.
- `test/queueRules.test.js`: **New.** Add, dedupe, reorder, transitions, next-runnable with slots, keys, merge, phase command.
- `test/queueStore.test.js`: **New.** Round-trip on a temp dir; corrupt-file recovery; interrupted on load.
- `test/serverQueue.test.js`: **New.** Server queue methods: registered-only, no-Frame refusal, `changed` debounce.

## Footprint

- src/shared/queueRules.js
- src/main/queueStore.js
- src/main/queueRunner.js
- src/main/queueManager.js
- src/server/queue.js
- src/shared/frameConstants.js
- src/shared/ipcChannels.js
- src/main/leadHost.js
- src/main/leadManager.js
- src/server/lead.js
- src/server/terminals.js
- src/server/specs.js
- src/server/index.js
- src/main/specManager.js
- src/main/gitBranchesManager.js
- src/main/ptyManager.js
- src/main/index.js
- src/templates/lead/CHIEF.md
- src/renderer/queueView.js
- src/renderer/styles/components/queue.css
- src/renderer/styles/main.css
- src/renderer/projectListUI.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/tasksDashboard.js
- src/renderer/taskRunModal.js
- index.html
- src/renderer/tasksPanel.js
- src/renderer/specsDashboard.js
- src/renderer/chiefLane.js
- src/renderer/styles/components/chief.css
- src/renderer/paletteSources.js
- src/renderer/index.js
- test/queueRules.test.js
- test/queueStore.test.js
- test/serverQueue.test.js

## Dependencies

None.

## Sequencing

1. **Queue rules.** `src/shared/queueRules.js` with `test/queueRules.test.js`.
2. **Store.** `queueStore.js` and the `queue.json` runtime class in `frameConstants.js`, with `test/queueStore.test.js`.
3. **Desktop queue manager and IPC.** `queueManager.js`, the `QUEUE_*` channels, wiring in `src/main/index.js`. The Mac queue is readable and writable over IPC, and `QUEUE_DATA` is pushed.
4. **Server queue.** `src/server/queue.js` and `src/server/index.js`, with `test/serverQueue.test.js`. Then the desktop merge and routing of server queues in `queueManager.js`, with offline refusal.
5. **Queue view and sidebar row.**
   - `queueView.js`, `queue.css`, the `main.css` import.
   - `showQueue` and the `queue` view mode in `multiTerminalUI` and `terminalManager`.
   - The Queue row with its count in `projectListUI`, and "Go to Queue" in the palette.
   - In the view: list, reorder, remove, open source, Done, Continue, Reset, and the spec mode toggle.
6. **Adding from tasks.**
   - The run modal's Add to queue (`taskRunModal.js`, `index.html`, `tasksPanel.js`).
   - The drawer action, and draggable tiles in `tasksDashboard.js`.
   - The Queue row as a drop target.
7. **Adding from specs.** Queue icon and draggable cards in `specsDashboard.js`.
8. **Worktree and preparation.** `createQueueWorktree` in `gitBranchesManager.js`, and `queueRunner.prepare` (provision, spec copy, command, prompt; D14, D15, D17, D18, D20). Worktree-key tests extend `queueRules.test.js`.
9. **Spec visibility.** The `queueRoots` provider in `specManager.js`, registered by `queueManager`, and `src/server/specs.js` `checkout()` accepting queue worktrees.
10. **Host: tool context, agent starter and queue tools.**
    - `leadHost` gets `ctx`, `startAgent`, `queue_list/start/update` and exit → interrupted.
    - The desktop `createTerminal` goes through `LEAD_OPEN_TERMINAL_REQUEST/REPLY` (`leadManager.js`, plus a `terminalManager.js` listener).
11. **Server Chief opens terminals.**
    - `src/server/terminals.js` gets the `queue` flag.
    - `src/server/lead.js` gets `createTerminal` and the `lead.terminalOpened` broadcast.
    - `ptyManager.adoptFrom` accepts queue terminals.
    - `leadManager` forwards `lead.terminalOpened` so the renderer re-adopts.
12. **Start queue.**
    - The Chief lane's Start queue button, running label and parallel stepper (`chiefLane.js`, `chief.css`).
    - `LEAD_QUEUE_START` (desktop) and `lead.queueStart` (server) paste the start prompt into the Chief.
    - The "Start queue" palette command in `src/renderer/index.js`.
    - The Queue section in `CHIEF.md`.
13. **Restart recovery.** Interrupted on load (`queueStore`/`queueManager` and `src/server/queue.js`), and resume in the existing worktree through `queue_start`.
