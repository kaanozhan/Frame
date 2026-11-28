---
keywords: frame cloud, start work, begin, workspace, worktree, brief part, parallel parts, cloud-starts, workspace chip, base, fetch, origin
related: frame-cloud-brief-start, frame-cloud-brief-done, workspaces, spec-in-workspace, update-from-base
---
Start Work and Begin now open each brief part in a new workspace on this Mac (phase 1), so parts can run side by side.
Order in `cloudStart.handleStartRequest`: every check, then `brief.start` (Start only), then cut the branch with `git branch` (the main checkout is never switched), read `baseSha` from the new branch's tip (`git.branchTipSha`, not HEAD), then `workspaceManager.create({ from: 'branch', base: workspaceBase(base) })`. A spec part is written into the worktree, a task row into the main checkout's tasks.json. Then recordBegun, then recordBranch.
The default base is `origin/<target>`, else the local target. An `origin/` base is fetched (`fetchBase` → `git.fetchBranch`) after the checks and before `brief.start`; a failed fetch cuts from the last fetched copy and the result's `fetch` drives a notice. A local base is never fetched. This overturns frame-cloud-brief-start's "Frame does not fetch" (T11, added after T10).
Partial steps are `branch | workspace | files`. A failed workspace leaves the branch cut. The dirty check and the stash are gone from main, the dialog and the copy.
Rejected: a branch-name option on `create({ from: 'new' })` (it always cuts from origin/<base> and is shared with the server protocol), and storing the workspace in `cloud-starts.json` (stale on archive or rename). The card finds the workspace by branch instead (`cloudBriefsCopy.partWorkspace`), matching the active, local, non-missing record on `begunBranch`, else the cloud `branch`.
The renderer (`openBeginLane`) selects the workspace, awaits its setup script (`runSetupThenAgent`, openAgent false), re-selects it, then opens /spec.plan or the task run. The task prompt names the main tasks.json via `buildTaskPrompt({ tasksPath })`, in both the completion line and the format step.
Ref allocation unions the main `.frame/specs` folders with `specManager.listSpecs` slugs, so slugs in workspaces count.
The dialog shows the workspace name (`beginWorkspaceName`, same rule as create) and, only with a saved server, Location: This Mac plus "Server · Coming soon" disabled.
`workspaceSection.onChange(fn)` fires after each load that lands, and the card rows redraw on it. An archived workspace's chip just drops.
Rules: `brief.recordCompletion` is never sent for a workspace part (rows are not on the branch). Phase 2 (server location) is a separate spec. `workspaceManager.create` is called outside its IPC `serialize` queue: a followup is a `createQueued` export.

Chain: spec.md → plan.md → tasks.md → outcome.md
