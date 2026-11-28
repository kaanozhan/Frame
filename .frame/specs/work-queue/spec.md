---
keywords: queue, work queue, chief, delegate, play, drag and drop, backlog, run tasks, run specs
related: lead-agent, tasks-list-view, center-specs-tasks-views, server-tasks, server-specs, sidebar-nav-groups, agent-dispatch
---
# Work queue

## Problem

The user has many relatively small pieces of work in a project, written up as
tasks and specs. Each one is started by hand today: Play on a task opens one
agent, and a spec needs its phase commands run one after another. The Chief
(lead-agent spec) can read and write to terminals, but it has no list of work
to go through and cannot open a terminal itself. Asked to "do the queued
work", it cannot.

## Goal

A per-project **work queue** of existing tasks and specs, plus the Chief tools
to work through it.

- **Adding.** Work goes into the queue from where it already lives. It is not
  a new kind of item.
  - Tasks: drag a task row onto the sidebar's Queue item or onto the queue
    screen. Play also offers a second choice, "Add to queue", next to running
    it in a terminal now.
  - Specs: drag a spec card the same way, or use a queue icon on each spec
    card.
- **Sidebar.** A **Queue** item in the Work group under Terminals, with a count.
- **Queue screen.** The queued items in order, each with its source (task or
  spec), state (queued, running, needs review, done, failed) and the terminal
  working it. The user can reorder, remove and open the source.
- **Starting the queue is the user's call.** The Chief's screen gets a
  **Start queue** button. It is visible while
  the Chief runs and the queue has items for its machine. The Chief never
  starts the queue on its own, including when items are added.
- **Specs continue from their current phase.** The Chief does not restart a
  spec. It picks up from where the spec is (specified → plan, planned →
  tasks, tasks_generated or implementing → implement) and runs the rest.
  - Each queued spec has a flow mode: **full auto** (the default) or step by
    step, settable per item on the queue screen.
  - Full auto reuses Frame's `spec.auto` run, which already resumes a spec
    from its phase (full-auto-spec-flow).
  - In step-by-step mode the Chief runs one phase and then marks the item as
    "needs you" until the user lets it continue.
- **Parallel, each item in its own git worktree.** The Chief can run several
  items at once. Each item gets its own plain git worktree and branch, and its
  terminal opens there, so parallel agents never share a checkout.
  - These are plain git worktrees, not Frame workspaces.
  - Limits: the 9-terminal cap and a parallel limit the user sets on the
    Chief's screen (default 9, so the cap is the only limit until changed).
  - The queue screen shows each running item's worktree and branch.
  - When an item finishes, its worktree and branch stay as they are for the
    user to review and merge. Merging and cleanup are not part of this spec;
    the Chief will manage them later.
- **Chief tools**, added through `leadHost.register()`:
  - read the queue and take the next item;
  - open a terminal and start an agent on an item;
  - report an item's state and result.
- **Approvals.** In user-guided mode, opening a terminal and starting an item
  raise approval cards like `terminal_send` does.
- **The queue works on Frame Server too.** Each machine keeps its own queue:
  - The Mac's queue is in the main checkout's `.frame/queue.json`.
  - Each server's queue is in its clone's `.frame/queue.json`.
  - Frame Server gets `queue.list/add/update/remove/reorder` and
    `queue.watch` → `queue.changed`, the way server-tasks added `tasks.*`.
  - The server Chief reads and updates its queue on the server, so it keeps
    working through the queue while the Mac is closed or disconnected.
  - The queue screen shows all queues merged: the Mac's first, then each
    server's, each item tagged with its host. Items on an offline server are
    dimmed, as on the tasks board.

## Constraints

- A queue item is a reference to a task id or a spec slug, never a copy. The
  task or spec stays the source of truth for its content and status
  (tasks.json, the spec's status.json).
- **One Chief per (project, machine), and no local ↔ server reach**
  (lead-agent C4). A task or spec runs where its file lives (server-tasks
  `runTarget`, server-specs B1). So each Chief only works items whose home is
  its own machine. An item for an unconnected server waits; it never falls
  back to the Mac.
- One writer per queue file (server-specs B1, server-tasks). An item goes into
  the queue of the machine that holds its task or spec. The desktop routes
  each change to that machine and never mirrors a server queue into the Mac's
  file. When a server is down, changes to its queue are refused with the host
  named.
- The server's queue methods follow server-tasks' limits: registered projects
  only, and nothing is written into a project without Frame.
- New Chief tools go through `leadHost.register()`, and new approvals use the
  generic `{ action, target, summary, payload }` record (lead-agent rules).
- The hard refusals stay in both modes. The Chief never answers another
  agent's prompt.
- A terminal the Chief opens must appear in the renderer like any other
  terminal. A PTY created only in main is invisible to the renderer, so the
  renderer must create it. It counts toward the 9-terminal cap; the Chief does
  not.
- Context hygiene: the Chief keeps no item history in its own session. State
  lives in the queue, so a fresh Chief can pick up where the last one stopped.
- Running a spec reuses Frame's spec commands (`spec.auto`, `/spec.plan`,
  `/spec.tasks`, `/spec.implement`) and `specFlow`'s phase rules; there is no
  second spec runner. A queued spec's flow mode is written to its own
  `status.json` as `flow_mode` (full-auto-spec-flow), not kept only in the
  queue.
- Parallel items never share a checkout; each runs in its own git worktree.
  `main` is never touched (Agent Orchestration rules). The worktree path and
  branch name follow one convention, settled in the plan. The conductor's
  `.frame/worktrees/<slug>` with `frame/<slug>/work` is the existing
  precedent.
- A worktree must work like the main checkout for Frame's tooling. Hooks,
  `.frame/bin` and the staged spec prompts must be present (as
  spec-in-workspace copies them into Frame workspaces). Task state still goes
  to the main checkout's tasks.json, never to the branch.
- While a spec runs in a worktree, its folder is written on that branch.
  Frame must still show the spec's live phase and status from the worktree,
  in the queue and on the Specs screen.
- On a server, worktrees are created in the server's clone by Frame Server.
- The conductor stays untouched. Its retirement is a separate spec.
- Drag and drop and the queue icon follow the existing tokens and both themes.
  Every action is also reachable without a mouse (keyboard or palette).

## Success Criteria

- When a pending task is dropped on the sidebar's Queue item, it appears at
  the end of the queue and the Queue count goes up by one.
- When the user presses Play on a task and picks "Add to queue", the task is
  queued and no terminal opens.
- When the user clicks the queue icon on a spec card, the spec is queued. The
  icon shows that it is queued, and a second click does not queue it twice.
- When an item is already in the queue, adding it again changes nothing and
  says so.
- When the queue screen is open, the user can reorder and remove items, and
  the order survives a restart of Frame.
- When the user presses Start queue on the Chief's screen, the Chief takes items
  whose home is its machine in queue order, opens a terminal for each, starts
  an agent on it, and each item shows "running" with its terminal.
- When items are added while the Chief is idle, nothing starts until the user
  presses Start queue.
- When two items run at once, each has its own worktree and branch, and
  neither agent's changes show up in the other's checkout or in `main`.
- When an item finishes, its worktree and branch are still there and the queue
  screen names them.
- When the parallel limit is 3 and five items are queued, three run at once.
  The fourth starts when one of them finishes. The terminal cap is never
  exceeded.
- When a queued spec is at `planned`, the Chief continues it with tasks and
  implement; it does not re-run the plan.
- When a spec is queued without a mode choice, it runs in full auto. When the
  user switches it to step by step, the Chief stops after each phase and the
  item shows "needs you".
- When the Chief is in user-guided mode, starting an item raises one approval
  card first, naming the item, its worktree and the terminal it will open.
- When the agent finishes and the Chief reports the result, the item moves to
  needs review, done or failed, and the task or spec status reflects it.
- When a queued task is deleted or a spec folder disappears, its queue item
  shows as missing instead of breaking the queue.
- When a task whose home is a server is queued, it lands in that server's
  `.frame/queue.json`, and the queue screen shows it tagged with the host.
- When the Mac is closed while the server Chief works its queue, the server
  Chief still takes the next server item, runs it and records the result.
  When the Mac reconnects, the queue screen shows that progress.
- When a server is offline, its items are shown dimmed and cannot be changed.
  Its Chief does not move them to the Mac.
- When Frame restarts while an item is running, the item is not lost. It comes
  back in a state the Chief can resume or the user can reset.

## Out of Scope

- Retiring the conductor
- Live test of the server Chief over SSH (lead-agent follow-up)
- Queues spanning several projects
- Scheduled or unattended runs on a timer
- Starting the queue automatically when items are added
- Merging finished worktrees and removing them (later, managed by the Chief)
- Creating Frame workspaces for queue items
