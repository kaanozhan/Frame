---
keywords: frame cloud, roles, admin, developer, viewer, permissions, role forbidden, read-only
related: frame-cloud-projects, frame-cloud-no-workspace, frame-cloud-sign-in, frame-cloud-briefs-create, frame-cloud-brief-done
---

# Frame Cloud roles

## Problem

FrameCloud's `workspace-invites-and-roles` (PR #28) gave workspaces three
roles, `admin | developer | viewer`, and two permissions: `work` (admin,
developer) and `manage` (admin). The server refuses a call the role does not
allow with `FORBIDDEN` `ROLE_FORBIDDEN`. Its spec leaves the Frame side to a
Frame spec, and its digest records the result: "Frame desktop only shows a
generic error for `ROLE_FORBIDDEN`".

Until #28 every workspace held one person who could do everything, so Frame
was built without roles:

- **The role is stored and never read.** `device.register` and `device.me`
  carry `workspace.role`, and `cloudSession.js` keeps the workspace, but
  `getAuth()` passes on only its name and slug.
- **A viewer sees every write control.** New brief, Decide, Discuss, Shape,
  Start Work, Begin, Move to Done and Connect all show, and each one fails.
- **A developer sees Create.** `link.create` needs `manage`; `link.claim` and
  `link.release` need `work`.
- **Frame writes on its own.** After every Briefs read, `cloudDoneService`
  sends `brief.recordBranch` and `brief.recordCompletion`, both `work`. On a
  viewer's machine each read ends in refused calls.
- **The refusal has no words.** `classifyTrpcError` maps `ROLE_FORBIDDEN` to
  `other`, so the user reads a generic failure.

## Goal

Frame knows the signed-in user's role and offers only what that role can do.

- **One map in Frame,** mirroring the protocol's `WORKSPACE_PERMISSIONS`:
  `work` for admin and developer, `manage` for admin. A pure `can(role,
  permission)` in main; the renderer receives the two answers, not the map.
- **Viewer (no `work`).**
  - Briefs is read-only: no New brief, Decide, Discuss, Shape, Start Work,
    Begin, Run, Move to Done or Move back.
  - A line in the panel says why: the role, and that an admin can change it.
  - Frame Cloud's On this device tab lists folders without Connect, Create or
    Disconnect.
  - `cloudDoneService` sends nothing.
- **Developer (`work`, no `manage`).** Everything except creating a cloud
  project from a folder: Create is replaced by a line saying an admin adds
  projects.
- **Admin.** As today.
- **The role is shown** beside the workspace in the Frame Cloud window.
- **`ROLE_FORBIDDEN` is its own refusal.** Wherever it arrives, Frame shows
  one sentence, re-reads `device.me` and redraws with the new role. Nothing
  is retried.

## Constraints

- The server enforces; hiding a control is not protection (FrameCloud
  workspace-invites-and-roles). Main still checks before a call, as it does
  for a workspace (frame-cloud-no-workspace: guard in main, not the renderer).
- The role is read per request on the server, so it can change under a
  running Frame. Frame learns it from `device.me` (window open, focus while
  there is no workspace) and from a `ROLE_FORBIDDEN`. No timer
  (frame-cloud-projects: no timer refreshes).
- No query is role-gated: a viewer reads briefs, milestones, events and
  projects in full.
- A removed member's next request has no workspace. That path already ends
  in the no-workspace card (frame-cloud-no-workspace) and must keep doing so.
- The renderer is untrusted: it sends paths and ids, and main re-checks
  (frame-cloud-brief-start).
- Local Frame is unaffected. Specs, tasks, lanes and git in a connected
  folder work for a viewer as for anyone; only cloud writes are held back.
- Copy lives in one renderer module, in English, matching the web's wording
  where the web has one.
- Unit tests cover the pure core and copy (project convention: DOM untested).

## Success Criteria

- When a viewer opens Briefs, then the board, cards, detail and history show,
  and no write control does.
- When a viewer opens Briefs, then no `brief.recordBranch` or
  `brief.recordCompletion` is sent.
- When a viewer opens the Frame Cloud window, then On this device shows each
  folder's state and no Connect, Create or Disconnect.
- When a developer opens On this device, then Connect and Disconnect show,
  and a folder with no cloud project says an admin can add it.
- When an admin uses Frame, then nothing differs from today.
- When a call is refused with `ROLE_FORBIDDEN`, then Frame shows the role
  sentence, re-reads `device.me`, and the controls follow the new role
  without a restart.
- When an admin makes a viewer a developer on the web and the viewer returns
  to Frame and reloads Briefs, then the write controls appear.
- When a member is removed from the workspace, then Frame's next request
  ends in the no-workspace state.
- When the palette's cloud commands are run by a role that cannot use them,
  then they say why rather than fail.

## Out of Scope

- The members page, invites and role changes in Frame (web only)
- Several workspaces with a role in each (FrameCloud `workspace-scoping`,
  not built yet)
- Project-level access
- Plan, seats and trials
- A viewer adding comments (FrameCloud decided viewers are strictly
  read-only)

## Open Questions

- **A role Frame does not know** (an older server's `pm`, or no role at all).
  - (a) Hide nothing and let the server refuse.
  - (b) Treat it as viewer.
- **Hidden or disabled.**
  - (a) Write controls are absent for a role that cannot use them, as on the
    web.
  - (b) They stay, disabled, with the reason as a tooltip.
- **A viewer's own machine.** A viewer can still create a spec by hand in a
  connected folder; the cloud never hears of it.
  - (a) Accept it: local Frame is nobody's business.
  - (b) Say so once in the Briefs panel.
