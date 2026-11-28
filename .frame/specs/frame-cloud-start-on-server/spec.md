---
keywords: frame cloud, start work, begin, frame server, server workspace, brief part, location, cloud-starts
related: frame-cloud-start-workspace, frame-cloud-brief-start, server-workspaces, server-specs, server-tasks, multi-server-connections, server-copy-files, spec-in-workspace
---

# Start Work on a Frame Server

## Problem

Start Work and Begin (`frame-cloud-start-workspace`, 2026-11-19) open each
begun part in a new workspace on this Mac. The dialog shows a server location
disabled, as Coming soon. That spec named starting a part on a Frame Server as
its phase 2.

Server workspaces, server specs and server tasks already work. A user can open
a workspace on a server and write a spec there. But in that flow the agent
writes the spec on the server. Start Work is different: the spec comes from
Shape, and Frame writes it itself. Every effect in `cloudStartService.js`
assumes the Mac:

- the branch is cut in the Mac's repository and never pushed;
- `writeSpec` writes to the Mac's disk under the workspace path;
- the task row goes to the Mac's `tasks.json`;
- `baseSha` is read from the Mac's branch;
- a begun part counts only while the Mac has its branch (`withBegunBranches`
  and the `alreadyBegun` check).

So if Frame only enabled the server location, it would send `brief.start`, then
fail to open the workspace on the server (the branch is in neither the server's
clone nor origin), and leave a partial start. A part meant to run while the
laptop sleeps has to be started on the Mac and moved by hand.

## Goal

The Start Work and Begin dialogs let the user choose where the part's workspace
is created: This Mac or one of the saved Frame Servers. Each part's location is
chosen when it is started or begun, so one brief can have parts on different
machines. With a server chosen:

- **Workspace.** The part's branch is cut on the server, from origin's copy
  of the base, fetched there first, under the part's branch name. The workspace
  opens the normal server way: the project is sent to the server if missing,
  then copyFiles, tooling, and the setup script.
- **Spec part.** Its `spec.md` and `status.json` are written into the server
  workspace, and only as new files.
- **Task part.** Its row is written into the server clone's `tasks.json` with
  its reserved id and every field Start Work builds (acceptance criteria,
  notes). The Mac's `tasks.json` is not touched.
- **Branch to the cloud.** `brief.recordBranch` carries the branch and the
  commit it was cut from, read from the branch on the server.
- **Where the part is.** The begun record in `<userData>/cloud-starts.json`
  also stores the location (the server's key). The card's row names the
  workspace with its host, and clicking it selects that workspace.
- **The lane** opens through today's paths: the setup script runs in a server
  terminal, `/spec.plan` is staged on the server, and the task runs where its
  `tasks.json` lives.

The dialog opens with This Mac selected; a server is chosen each time. With
This Mac chosen, Start Work works exactly as in phase 1.

## Constraints

- **Phase 1's rules stay** (`frame-cloud-start-workspace`): one part per
  branch, one workspace and one PR; no cross-workspace coordination
  (orchestration out of scope, 2026-11-09); the cloud contract does not change;
  `brief.recordCompletion` is not sent for a part begun in a workspace; main
  re-checks everything, because the renderer is not trusted.
- **Every check runs before `brief.start`** (`frame-cloud-brief-start`). For a
  server this includes: the server is connected and new enough; the project is
  on it (sent if missing); the branch name is free in the server's clone; the
  base exists on origin. A failure there writes nothing in the cloud. A failure
  after `brief.start` is `partial` and names the step.
- **No fallback** (`multi-server-connections`). If a server is offline or
  refuses, Frame says so with the host's name. It never falls back to the Mac or
  to another server.
- **A server part is cut from origin's copy only.** Frame never pushes a base
  branch (2026-11-09 git-flow decision). So a base that exists only on the Mac
  is not offered for a server, and nothing is pushed at start.
- **Task state has one writer** (`server-specs` B1, `server-tasks`). A server
  part's task row lives in the server clone's `tasks.json`. It is never
  mirrored into the Mac's.
- **`gitSharing: local` cannot use a server.** Server specs and server tasks
  refuse local mode, and the desktop is what decides it (`server-specs` rule).
  In that mode the server locations are shown disabled, with the reason.
- **Older servers.** New server methods ship without a protocol bump. A
  server without them answers "Unknown method" to Start's first server call,
  which comes before `brief.start`. Start Work then refuses with "Update Frame
  Server on <host>", as `server-tasks` handles "Unknown method". The dialog
  does not disable such a server up front (amended at plan time, D1).
- **Server methods stay guarded.** A server method acts only on a registered
  project and one of its active workspaces (`server-specs`). The spec write
  only creates files under `.frame/specs/<slug>`, with the slug validated.
  Branch names are validated before any git command runs (workspace-hardening
  X1).
- **The cloud stays on the Mac** (`frame-cloud-sign-in`). The token and every
  cloud call (`brief.start`, `brief.recordBranch`) stay in the desktop's main
  process. The server gets no cloud identity in this spec.
- **The core stays pure.** Location-specific effects go through `cloudStart.js`'s
  `deps`. The core does not import Electron, and its tests cover the server
  branches.
- **The begun record grows without a migration.** An entry without a location
  reads as This Mac.
- **This Mac is the default location, for now** (user, 2026-11-25: "Bence bu
  iyi default seçim This Mac olsun şimdilik ama onu da değiştireceğiz zaten
  ilerde"). Rejected for this spec: remembering the last location chosen for
  the project. The default is expected to change later.

## Success Criteria

- **SERVER START.** When the user chooses a connected server and runs Start
  Work on a shaped brief, then every part is reserved, and on that server a
  workspace on the chosen part's branch exists, cut from a freshly fetched
  `origin/<target>`. A spec part's files are in that workspace, and its
  `/spec.plan` lane opens there after the setup script. The Mac's checkout,
  branches and `tasks.json` are unchanged.
- **TASK PART.** When a task part is started or begun on a server, then its
  row is in the server clone's `tasks.json` with its reserved id, description,
  acceptance criteria and notes. Its task run opens in the server workspace,
  and the Mac's `tasks.json` is unchanged.
- **MIXED.** When one part of a brief is begun on the Mac and another on a
  server, then both workspaces run at once, and each row names its own
  workspace (the server's with its host).
- **BRANCH.** When a part is started on a server, then `brief.recordBranch`
  carries the part's branch and the commit read from that branch's tip on the
  server.
- **NO DOUBLE BEGIN.** When a part was begun on a server, then the card does
  not offer Begin for it again, even if the server is offline or the Mac lacks
  the branch. A Begin request for it is refused with the host named.
- **CARD.** When a part is begun on a connected server, then its row names
  the workspace and host, and clicking it selects that workspace. When the
  server is offline, the row says the host is offline.
- **IMPLEMENTED.** When a server part's spec or task finishes, then its row
  reads Implemented on the Mac while the server is connected, and keeps the
  last known state while it is offline.
- **CHECKS FIRST.** When the chosen server is offline or too old, cannot take
  the project, already has the branch, or origin lacks the base, then Start
  Work says why, and nothing is written in the cloud or on any machine.
- **LOCATION.** When the dialog opens and servers are saved, then Location
  lists This Mac, selected, and each server. A server that is offline is
  disabled with its reason; one too old to start parts is refused at Start
  (CHECKS FIRST). In `gitSharing: local`, every server is disabled
  with the reason. With no saved server, no Location line is shown, as today.
- **BASES.** When a server is chosen, then the base menu offers only origin's
  branches.
- **MAC UNCHANGED.** When This Mac is chosen, then Start Work and Begin behave
  as in `frame-cloud-start-workspace`.

## Out of Scope

- Starting a brief from the web, or a Frame Cloud runner on the server (the
  server's own cloud identity, dispatch, inbox)
- Sending `brief.recordCompletion` for a part begun in a workspace
- Moving a begun part between the Mac and a server
- Bases that exist only on the Mac
- Shape and Discuss lanes on a server
- Choosing a server automatically, or remembering the last location chosen
- Orchestration
- Stacked parts, `dependsOn` and overlap warnings (deferred by
  `frame-cloud-start-workspace`)

## Open Questions

1. **How the part's branch is cut on the server.** Resolved at plan time
   (D6): `workspaceManager.create({ from: 'new' })` takes the dialog's branch
   name, for the server path only.
   - (a) `workspaceManager.create({ from: 'new' })` takes an optional branch
     name. The server runs the same code, and `workspaces.create` already
     passes `branch` through. This overturns `frame-cloud-start-workspace`
     Open Question 1, where (b) was chosen because the call is shared with the
     server. The Mac path could move to the same call.
   - (b) A new server method cuts the branch, then `workspaces.create({ from:
     'branch' })` opens it, mirroring phase 1's two steps.
