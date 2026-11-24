---
keywords: tasks, server workspace, frame server, tasks board, play, tasks.json, self-hosted, routing
related: server-specs, spec-in-workspace, tasks-list-view, multi-server-connections, agent-dispatch
---

# Tasks in server workspaces

## Problem

server-specs made specs work in server workspaces. Tasks did not get the same treatment, so on a server they break in four places:

- **The board only sees the Mac.** `tasksManager` reads only the Mac's `.frame/tasks.json`. Tasks that live on a server never appear: ones an agent adds there, and ones `/spec.tasks` generates for a server spec (server-specs B1 keeps those in the server clone's `tasks.json`). The spec card shows only their counts.
- **Editing only reaches the Mac.** Add, edit, status, delete and reorder all write to the Mac's file. A server task cannot be changed from the desktop.
- **Play gives no file path.** The prompt says only "update this task in tasks.json (task id …)". On a server, the agent may edit the worktree's tracked `.frame/tasks.json`, so task state rides the branch (against spec-in-workspace B1), and the Mac never learns the task finished. A local workspace may have the same gap; the plan should confirm.
- **No live updates.** Specs push changes from the server (`specs.watch`); tasks have no counterpart, so the board never refreshes for server tasks.

The Task Run dialog's "new branch" option also moves a workspace off its branch. Push now refuses that (#209), and spec.implement no longer does it (#208).

## Goal

A task in a server workspace behaves the way a local one does:

- the Tasks board lists the server clone's tasks next to the Mac's, marked with their host, and shows them offline while the server is down;
- add, edit, status, delete and reorder of a server task are done on that server;
- Play runs a server task in a workspace on its server, with a prompt that names the server clone's `tasks.json` by absolute path;
- changes made on the server reach the board without a reload.

## Constraints

- **server-specs B1:** a server project's task state lives in the server clone's `tasks.json`, which has one writer. Nothing is mirrored live into the Mac's `tasks.json`. After merge and pull, the existing import brings spec tasks in as completed.
- **spec-in-workspace B1:** a workspace branch never carries `tasks.json` changes. Task state lives only in the project home: the Mac's main checkout, or the server clone.
- **multi-server-connections:** every call is routed by the workspace's own `serverKey`. A down server is named, and a call never falls back to the Mac or to another server.
- **#208 / #209:** Frame never switches a workspace's branch, so a Play started inside a workspace does not offer "new branch".
- **Older Frame Server:** a server without the new methods must degrade to the Mac's tasks plus an "update Frame Server" notice. Nothing fails.
- **Local sharing mode** (`.frame` kept out of git) is refused for server tasks, as it is for server specs.
- Only Frame's own files are written on the server.

## Success Criteria

1. When a server project's clone holds tasks, the Tasks board lists them next to the Mac's tasks, each marked with its host.
2. When that server is down, its tasks stay listed as offline, and changing one says "<host> is offline" without writing anywhere.
3. When a task is added, edited, has its status changed, is deleted or is reordered on a server, only that server clone's `tasks.json` changes, and the Mac's file is untouched.
4. When Play is used on a server task:
   - the agent starts in a workspace on that server;
   - the prompt names that clone's `tasks.json` by absolute path;
   - when the agent marks the task completed, the board shows it within a few seconds without a reload.
5. When `/spec.tasks` runs on a server spec, its generated tasks appear on the board as that server's tasks.
6. When the server runs an older Frame Server, the board shows the Mac's tasks and a notice to update Frame Server on that host, with no error.
7. After any of the above, the workspace's branch has no `.frame/tasks.json` change.

## Out of Scope

- Mirroring server tasks into the Mac's `tasks.json`, and moving tasks between the Mac and a server.
- Importing spec tasks after merge (exists: `syncTasksFromMarkdown`).
- Codex hook parity on servers.
- Task kinds or board views that don't exist locally today.

## Open Questions

- **Where a new task goes while a server workspace is selected:**
  - (a) that server's clone;
  - (b) always the Mac, with Play running it remotely.
- **Which workspace Play uses for a server task:**
  - (a) the selected workspace when it is on that server, otherwise ask;
  - (b) always ask.
- **How the board shows server tasks:**
  - (a) one merged list with a host chip, as the Specs board does;
  - (b) a group per server.
- **Play's missing task-file path in local workspaces:**
  - (a) fix it here for every workspace;
  - (b) a separate spec.
