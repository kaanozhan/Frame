---
keywords: frame cloud, start work, begin, frame server, server workspace, brief part, location, cloud-starts
related: frame-cloud-start-workspace, frame-cloud-brief-start, frame-cloud-start-places, server-workspaces, server-specs, server-tasks, multi-server-connections, server-copy-files
---
Start Work and Begin can open a brief part in a workspace on a connected Frame Server (phase 2 of frame-cloud-start-workspace). The Mac path and `cloudDone` are unchanged.
Server order in `cloudStart.handleStartRequest`: the service first makes sure the project is on the server (`workspaceManager.serverProject({ ensure })`, clone or bundle, answers `sent`), then calls one `workspaces.preflight { projectPath, branch, base }` → `{ branchTaken, baseOnOrigin, fetch, tasksPath }` before `brief.start`, so every server refusal happens there. Then `workspaceManager.create({ from: 'new', branch })` cuts the branch from the fetched `origin/<base>` and opens the worktree in one call, answering `startSha` (the begun `baseSha`).
A spec part is written by the new `specs.create` (spec.md + status.json only, create-only, refuses `gitSharing: local`), a task row by the new `tasks.insert` (rows kept whole, `totalCreated` bumped), followed by `tasksManager.refreshServerTasks`. The task part's `tasksPath` comes from the preflight answer; a server start skips the Mac's `branchTaken` and relies on the server's.
An older server answers "Unknown method" to the preflight and Start refuses with "Update Frame Server on <host>". Rejected: disabling older servers up front (it pushes an update that restarts the server and ends its agents), and a protocol bump (it cuts off every older server).
Rejected: a separate server method to cut the branch (one more failure point), reusing `files.receive` for spec files (SSH upload, overwrites, writes the main copy), a keep-id flag on `tasks.add` (mints a new id, drops criteria and notes).
A server base must be `origin/<x>` (`baseNotOnOrigin`); the dialog offers only remote bases there.
The begun entry gains `serverKey` (none = This Mac). `begunLive` checks liveness per server through `git.branches` on the server clone: offline or unknown counts as live, and a server no longer saved does not stand. Begin's guard uses `deps.begunStands`/`hostOf`, and Begin of a server part is refused naming the host.
The card chip reads `name · host`; while the server is offline it is dashed, not clickable and adds `· offline`.
T12, added after T10: Begin on a server workspace offers Send files (`sendFilesModal`, context `create`) before setup, and `sent` reaches `copy.sentNotice`.
Later: frame-cloud-start-places overturned D2 (This Mac preselected) and replaced the Location radio row with three place cards.

Chain: spec.md → plan.md → tasks.md → outcome.md
