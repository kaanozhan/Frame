---
keywords: queue, work queue, chief, delegate, worktree, start queue, play, drag and drop, run specs, run tasks
related: lead-agent, server-tasks, server-specs, spec-in-workspace, full-auto-spec-flow, tasks-list-view, agent-orchestration
---
Each machine now has its own work queue for the project:
- The Mac's queue is in the main checkout's `.frame/runtime/queue.json`. Each Frame Server's queue is in its clone (`src/server/queue.js`, mirroring server-tasks).
- Queue items are references to a task id or a spec slug.
- Ways to add an item:
  - Play → "Add to queue";
  - the task drawer;
  - dragging a task tile or spec card onto the sidebar Queue row or the Queue view;
  - the queue icon on a spec card.
- The Queue view (`queueView.js`) merges every queue, the Mac's first, with host tags; offline items are read-only. It handles reorder, Remove, Done/Continue/Reset, and the spec mode (full auto by default, or step).
- Start queue on the Chief, or the palette, has the Chief run the loop `queue_list` → `queue_start` → `terminal_wait`/`terminal_read` → `queue_update` (review / needs-you / failed).
- `queue_start` (leadHost, one approval in user-guided mode) does the mechanical work:
  - prepares the item (`queueRunner`): its own git worktree `.frame/worktrees/queue-<key>` on `frame/queue/<key>`, Frame tooling provisioned, an uncommitted spec copied in, then `spec.auto` / next phase / the Play prompt with the auto flags;
  - opens a visible terminal: a renderer lane on the Mac; on a server, a PTY plus `lead.terminalOpened` → re-adopt;
  - starts Claude and pastes the prompt once OSC 7501 reports ready.
- Specs in queue worktrees stay visible on the Specs screen (specManager queue-roots provider).
- Restarts mark running items interrupted; they resume in the same worktree.

Why this path:
- The Chief chooses and judges, and Frame does the mechanics. Rejected: a scheduler with no LLM, and letting the LLM run git or the CLI.
- A single agent starter in the host. Rejected: the renderer's agentDispatch, because the server has no renderer.
- One writer per queue file, with no fallback to the Mac.

Deviations found while building, all recorded in outcome.md:
- The queue file lives in `.frame/runtime/` because a new `.gitignore` entry would not reach existing clones.
- Claude asks "trust this folder?" in every new worktree. By the user's decision, Frame answers Yes only for queue worktrees of a project Claude already trusts (read-only check of `~/.claude.json`); otherwise the item waits and its prompt follows once the user answers.
- `mergeSpecLists` now keeps `serverKey` and `serverProjectPath`.
- `queued → failed` is a legal transition.

Rules for later work:
- Add queue mechanics in queueRunner and leadHost, never in the Chief's prompt.
- Route every queue change through its home's writer: `queueManager.macChange`, or the server's `queue.*` methods.
- Merging and cleaning up finished worktrees is the next Chief spec.

Chain: spec.md → plan.md → tasks.md → outcome.md
