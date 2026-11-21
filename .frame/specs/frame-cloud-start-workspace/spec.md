---
keywords: frame cloud, start work, begin, workspace, worktree, brief part, parallel parts, cloud-starts
related: frame-cloud-brief-start, frame-cloud-brief-done, workspaces, spec-in-workspace, workspace-pr-flow, update-from-base, server-specs
---

# Start Work in workspaces

## Problem

Start Work (`frame-cloud-brief-start`, 2026-09-25) predates workspaces. It works
in the folder that is open, usually the main checkout: it stashes uncommitted
changes if the user agrees, cuts the part's branch from the brief's target or a
picked base, writes the part's `spec.md` + `status.json` (or its `tasks.json`
row) there, and opens the lane there. Begin does the same for a later part.

So one checkout holds one part at a time. Running two parts of a brief side by
side means setting up worktrees by hand, although Frame now has workspaces for
exactly that.

## Goal

Each part that is started gets its own new workspace on this Mac, so different
parts can run at the same time, each started when the user decides. This is
phase 1; phase 2 brings the same to a Frame Server.

- **Start Work** reserves every part's spec slug or task id in one
  `brief.start`, as today (the brief goes Active). It then creates a new
  workspace whose branch is the chosen part's branch, cut from the brief's
  target or the picked base. A spec part's files are written into that
  workspace; a task part's row goes to the main checkout's `tasks.json`. The
  part's lane (`/spec.plan` or the task run) opens in the workspace. Frame
  sends the branch and the commit it was cut from (`brief.recordBranch`).
- **Begin** does the same for any other part, under its reserved ref, with no
  cloud write beyond `recordBranch`.
- **The stash goes away.** The "uncommitted changes" check and the stash offer
  leave the Start Work dialog, because the main checkout is no longer touched.
- **Where the part is.** The begun record in `<userData>/cloud-starts.json`
  also stores the workspace. The card's part row names the workspace instead
  of only "On `<branch>`", and clicking it selects that workspace.
- **Server is Coming soon.** The Start Work and Begin dialogs show where the
  workspace will be created: This Mac. A server location is shown, disabled,
  as Coming soon.
- **The base is fresh** (added 2026-11-19, T11). The part's branch is cut
  from origin's copy of the brief's target, fetched first, as New Workspace
  cuts its branch. The local branch is the default only when origin has no
  copy, and a local branch the user picks is cut as it is. This overturns
  `frame-cloud-brief-start`'s "Frame does not fetch: the base is what this
  machine has", which predates workspaces.

## Constraints

- **Two phases** (user, 2026-11-19). This spec is phase 1: the workspace is
  always on this Mac. Starting a part on a Frame Server is phase 2, a separate
  spec on its own branch. Phase 1 only shows it as Coming soon.
- **Frame opens the work; the user coordinates it.** Which part starts when, the
  merge order and conflicts between parts stay with the user, through the
  existing Update from base, conflict dialog and Resolve with agent
  (`update-from-base`). User, 2026-11-18: "diğer parçaları başlatmak vs
  kullanıcının inisiyatifine kalır, isterse begin diye başlatır ama merge etmesi
  vs onun inisiyatifinde olur".
- **No cross-workspace coordination.** This follows the 2026-11-09 decision that
  orchestration is out of scope. `frame-cloud-brief-start` left parallel parts
  to Orchestrate (shown, disabled). This spec allows parallel parts through
  workspaces instead, and leaves the Orchestrate button as it is.
- **One part per branch stays** (`frame-cloud-brief-start`): one workspace, one
  part, one PR.
- **The cloud contract does not change.** `brief.start`, `brief.recordBranch`
  and the part refs work as they do now.
- **Implemented stays on this Mac** (agreed 2026-11-19). Task state stays in the
  main checkout's `tasks.json`, as `spec-in-workspace` decided. The card reads
  Implemented from the spec list and that file. `brief.recordCompletion` is not
  sent for a part begun in a workspace, since its rows are not on the branch.
  PR and merge reach Frame Cloud from GitHub through the part's branch, so they
  do not need it. Accepted: another machine does not see Implemented, and a
  merge without a PR is not caught on its own (Link commit still covers it).
- **Start Work's ordering rules stay** (`frame-cloud-brief-start`). Every local
  check runs before `brief.start`. A failure after it is `partial` and names the
  missing step, with workspace creation as a new step. Main re-reads the brief
  and re-checks the base and branch, because the renderer is untrusted.
- **Workspaces are created the normal way**, through `workspaceManager.create`
  (`workspaces`): naming, the registry, copyFiles, tooling provisioning and the
  setup script all apply. The setup script runs before the lane opens, as for a
  spec created from main (`spec-in-workspace`).
- **The spec folder lives on the part's branch** (`spec-in-workspace`): it is
  written in the workspace and lands in the part's PR.
- **Ready for phase 2.** The begun record stores the workspace with its location
  (`local`), so phase 2 adds servers without a migration, as `workspaces`
  records do.

## Success Criteria

- **START.** When the user runs Start Work on a shaped brief, then every part is
  reserved, a new workspace exists on the chosen part's branch, a spec part's
  files are in that workspace (a task part's row is in the main checkout's
  `tasks.json`), and its lane is open there. The main checkout stays on its
  branch and nothing is stashed.
- **BEGIN.** When the user Begins another part of a started brief, then a second
  workspace is created for that part the same way, and both workspaces can run
  at once.
- **BRANCH.** When a part is started or begun, then `brief.recordBranch` carries
  the part's branch and the commit that branch was cut from, read from the
  branch itself and not from the main checkout's HEAD.
- **IMPLEMENTED.** When a part's spec or task finishes in its workspace, then
  its row on this Mac reads Implemented.
- **CARD.** When a part has been begun on this Mac, then its row names the
  workspace, and clicking it selects that workspace.
- **NO STASH.** When the Start Work dialog opens with uncommitted changes in the
  main checkout, then it neither warns about them nor offers to stash them.
- **COMING SOON.** When the Start Work or Begin dialog opens, then the location
  reads This Mac, and a server location is shown disabled as Coming soon.
- **BASE.** When the dialog opens on a brief whose target exists on origin,
  then the base reads `origin/<target>` with origin's icon. When the user
  starts the part, then `origin/<target>` is fetched first and the branch is
  cut from it. If the fetch fails, the branch is cut from the last fetched copy
  and the user is told. A local base the user picks is not fetched.

## Out of Scope

- Phase 2: starting a part on a Frame Server (writing the spec files and the
  task row there, reading the base commit there, Implemented for a server task
  part)
- Sending `brief.recordCompletion` for a part begun in a workspace
- Basing a part on a sibling part's branch (stacked work) and its PR target
- Warning that another part of the same brief is already running
- A live overlap indicator between workspaces' changed files
- Part dependencies (`dependsOn`) written at Shape time
- Giving Resolve with agent the sibling part's spec and outcome
- Shape and Discuss lanes on a server; a Frame Cloud runner on the server
- Orchestration
- Bases on remotes other than `origin` (such as a fork's `upstream`)

## Open Questions

1. **Naming the part's branch.** `workspaceManager.create` either makes a new
   branch with an automatic `<prefix>/<color>` name (`from: 'new'`) or opens an
   existing one (`from: 'branch'`). Start Work needs a new branch with the
   part's own name (`<prefix>/<key>`).
   - (a) Give `create` a branch-name parameter for `from: 'new'`.
   - (b) Cut the branch first, as today, then call `create` with
     `from: 'branch'`.
2. **A part whose workspace is archived.** Merge can archive the workspace
   (`archiveOnMerge`), and the branch stays.
   - (a) The row falls back to "On `<branch>`".
   - (b) The row offers Restore.
