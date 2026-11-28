---
keywords: frame cloud, sign-in, no workspace, empty state, G-A, noWorkspace, create workspace, cloud hub
related: frame-cloud-sign-in, frame-cloud-projects, frame-cloud-project-link, frame-cloud-briefs-read-only
---

# Frame Cloud no workspace

## Problem

Signing in to Frame Cloud from Frame fails for anyone who has no workspace.
`device.register` answers `NO_WORKSPACE`, so the sign-in ends in `failed`
with "Create a workspace on the web first." and the token is discarded
(frame-cloud-sign-in). Since FrameCloud's onboarding-profile, the web's
`/device` page catches this earlier: it sends such a user to `/new` before
they can approve. Either way, the only way into Frame Cloud from the desktop
is to create a workspace first.

The Team direction ("Team Erişim Akışı",
https://claude.ai/artifact/YNbsFDQn7PNShtmBiC1CLU) makes signing in free and
owning a workspace a paid choice that an invited person never has to make.
Its desktop answer is **G-A**:

- Sign-in always completes.
- The Frame Cloud window shows an empty state with the way on.
- Creating a workspace (and, later, paying) happens on the web.

FrameCloud's `desktop-no-workspace` spec makes the server answer
`workspace: null` instead of refusing. This spec is the desktop half: Frame
must treat that answer as a signed-in state, not an error.

## Goal

- **Sign-in completes without a workspace.**
  - `device.register` and `device.me` answering `workspace: null` lead to
    `signedIn`.
  - The stored session keeps `workspace: null`, and `getAuth().cloudWorkspace`
    is null.
  - A 412 `NO_WORKSPACE` from an older server still ends in `failed`
    (`noWorkspace`) as today.
- **The Frame Cloud window shows the G-A empty state.**
  - Account header:
    - Name, login and Sign out stay.
    - The Workspace row reads "No workspace" with a "Create a workspace ↗"
      link. The link opens `/new` on the web origin.
  - The tabs are hidden, and one panel takes their place (decided at
    plan time). It shows a card "A workspace for your own projects". The
    card says:
    - how many folders on this device are Frame projects;
    - that a workspace lets them be added to the cloud and their briefs seen
      from the web;
    - a "Create a workspace ↗" button.
  - One line says local Frame needs no account and works as before.
  - No trial, plan or price is named.
- **Nothing calls workspace procedures without a workspace.**
  - The projects service does not call `project.list` or `link.candidates`
    while `cloudWorkspace` is null.
  - It shows no error or stale note for that reason.
  - Connect and Create are not offered anywhere, because the tabs that hold
    them are hidden.
- **Every surface keyed to a workspace stays quiet.**
  - The Connected mark, the Project Settings Frame Cloud row, the Briefs view
    and the palette's `cloud.connectProject` read "no workspace" as "nothing
    connected".
  - Project Settings offers "Open Frame Cloud" rather than Connect.
- **Frame notices when a workspace appears.**
  - After the user creates one on the web, the next session re-read
    (`device.me`) stores it.
  - The window then switches to today's signed-in view with the list
    loaded, with no new sign-in.
  - The session is re-read when the window opens, as today. While there is
    no workspace, it is also re-read when Frame's window regains focus
    (decided at plan time).

## Constraints

- **The server contract comes from FrameCloud `desktop-no-workspace`.**
  `workspace` is `{ name, slug } | null` on `device.register` and
  `device.me`. `workspaceProcedure` calls keep answering `NO_WORKSPACE`, and
  this side must not make them.
- **frame-cloud-sign-in's state machine holds.** The states and the token
  handling are unchanged. `signedIn` just no longer implies a workspace.
  - The `noWorkspace` failure reason stays for an old server.
  - "Open Frame Cloud" keeps pointing at the web origin, which lands on E0.
- **The session stays single-workspace.** `workspace` becomes nullable.
  There is no `memberships[]` list and no grouping; those belong to
  workspace-scoping and its desktop spec.
- **frame-cloud-projects' rules hold.**
  - The token never reaches the renderer.
  - Web links are built in main from the stored web origin.
  - The cache is keyed by server and workspace slug, and a null slug is
    never cached.
- **Plan Model rule** (Frame Plan Modeli, 2026-09-12): no modal on launch,
  no sign-in wall, no upgrade badge. The workspace offer appears only in the
  Frame Cloud window the user opened.
- **Local Frame is untouched.** Nothing outside Frame Cloud surfaces changes
  for a signed-out user or a user who never opens the window.
- **Copy is English**, in the voice of the existing cloud copy
  (`cloudHubTabs.js`, `cloudBriefsCopy.js`).
- **Tests stay on the pure cores** (`deviceFlow.js`, `cloudProjects.js`,
  copy modules) with `node --test`, as the earlier cloud specs do.

## Success Criteria

- When a user without a workspace signs in, the window reaches `signedIn`.
  The header shows their name and login, and the Workspace row reads "No
  workspace" with "Create a workspace ↗".
- When that user relaunches Frame, the session loads from disk with
  `workspace: null` and the same view appears. No `project.list` call is
  made.
- When the Frame Cloud window is open without a workspace, the tabs are
  hidden and the G-A panel shows this device's Frame project count and
  "Create a workspace ↗". Pressing it opens `<web origin>/new` in the
  browser. No Connect or Create action is offered.
- When the open folder is a Frame project and there is no workspace, the
  Connected mark is absent, the Briefs view does not appear, and Project
  Settings shows "Open Frame Cloud".
- When the user creates a workspace on the web and reopens the Frame Cloud
  window, the Workspace row shows its name and the Cloud projects tab loads
  its list, without signing in again.
- When the user creates a workspace on the web and switches back to Frame
  with the Frame Cloud window still open, the window leaves the G-A panel
  for the list on its own.
- When a user with a workspace signs in, everything behaves as it does today.
- When the server is an older one that still answers 412 `NO_WORKSPACE`,
  sign-in ends in `failed` with the `noWorkspace` message, as today.
- When the user signs out without a workspace, `device.signOut` is called
  and the window returns to `signedOut`.

## Out of Scope

- The FrameCloud server and web change (FrameCloud spec
  `desktop-no-workspace`)
- The pending-invitation card from G-A (workspace-invites)
- Several workspaces: `memberships[]`, grouped Cloud projects (P-A), the
  target picker in Add to Frame Cloud (C-A/C-C), one folder in two
  workspaces (U-A)
- Viewer role behaviour on the desktop (workspace-roles)
- Trial and plan wording (plan-layer)
