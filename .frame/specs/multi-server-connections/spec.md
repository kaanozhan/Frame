---
keywords: frame server, multiple servers, remote, ssh, server workspace, connection, hosts, routing
related: server-workspaces, server-workspace-panels, server-hardening, server-install-update, server-onboarding, workspaces
---

# Multiple Frame Servers

## Problem

Frame connects to exactly one Frame Server at a time. `serverConnection.js` is
a module-level singleton (one `status`, one tunnel, one socket, one saved
`server` setting), and every caller (`workspaceManager`, `ptyManager`,
`serverPanels`, `workspaceGitState`, `gitStatusManager`, `aiToolManager`,
`serverInstaller`) asks "the" server. Server rows are cached for the
"current host" only. Connecting to a second machine disconnects the first, so
its workspaces go offline and its terminals stop streaming.

Users have more than one machine: a Linux dev box, a second Linux box, a
GPU machine. They want workspaces on all of them side by side, with agents
running on each at the same time. Today they have to pick one and keep
switching.

## Goal

Frame keeps any number of servers connected at once.

- **Server list.** The user adds, removes, connects and disconnects each
  server independently. Each server has its own status, install / update /
  rollback, check-up and auto-connect.
- **One identity per server.** Every server workspace, server terminal and
  panel call is tied to the server it lives on. Calls route to that server's
  connection and never to another one.
- **Workspace switcher.** The REMOTE group lists the workspaces of every
  server, under a sub-header per server (host + link dot). The empty states
  added on 2026-11-15 still apply, per server: "Connect" on a server that is
  down, "New remote workspace" on one that is up. A separate "Add server" row
  adds another server.
- **New Workspace.** The Location field lists This Mac plus every saved
  server. Servers that are down are disabled.
- **Status bar.** The server item shows how many servers are connected. It
  opens a server list, and each server has its own dot and actions.

## Constraints

- **SSH model unchanged** (server-workspaces): the user's own `ssh` in
  `BatchMode`, no stored secrets, Unix-socket forward (protocol 2,
  server-hardening). Each server gets its own tunnel and local socket dir.
- **Routing stays main-side and explicit** (server-workspace-panels,
  server-hardening). Every server-bound call resolves to
  `{ server, workspaceId }` through `serverPanels.resolve` /
  `workspaceManager.serverLocation`, never a generic forwarder.
  - The rule "another host's clone and workspaces never list or route here"
    (server-hardening T2) becomes per server: each server's rows route only
    to that server.
- **Offline never falls back to local**, and never to another server. A
  server that is down answers "offline" for its own rows, while the other
  servers keep working.
- **Terminal ids.** Server terminal ids keep the `srv-` prefix
  (server-workspaces). The desktop maps each id to its server, so the same id
  arriving from two servers cannot misroute.
- **Workspace records.** Workspace records keep `location`. Server rows also
  carry a stable server key (`serverId`). Records and settings migrate once
  from today's single `server` setting; the one saved server must reconnect
  with no user action.
- **Protocol additions** follow server-onboarding: new methods, not new
  parameters on old methods.
- **Tests.** Connection work extends `test/serverConnection.test.js` (fake
  ssh + fake server) to run two fake servers at once.
- **Installer.** The install script stays the only installer
  (server-install-update). Installs run one at a time per server.

## Success Criteria

- When the user adds server B while server A is connected, A stays
  connected, and both servers' workspaces are listed and usable.
- When server A drops, A's rows show offline and A's terminals reconnect on
  their own. B's rows and terminals are unaffected.
- When the user types in a terminal on server B, the input reaches B only.
  When a terminal's output arrives, it is drawn in the lane of the server it
  came from.
- When the user opens the file tree, Changes, Review or the PR flow of a
  workspace on B, every call goes to B.
- When two servers have a workspace with the same name (e.g. both "violet"),
  both are listed under their own server header, and each one opens its own
  folder.
- When Frame starts, every server the user left connected reconnects. Servers
  the user disconnected stay off.
- When a user upgrades from a build with one saved server, that server
  appears in the list and reconnects with no user action.
- When the user removes a server, its tunnel closes, its rows and cached
  state disappear, and nothing else changes. Its remote folders are not
  deleted.
- When the user creates a workspace from a server's "New remote workspace",
  it is created on that server.
- When the user installs or updates server A, B stays connected. The
  running-agents consent names only A's agents.
- When `npm test` runs, a two-server connection test passes.

## Out of Scope

- Frame Server on Windows hosts
- Frame Server on macOS hosts
- Moving a workspace between servers (or between a server and the Mac)
- File sync between the Mac and servers
- Orchestration across servers (orchestration stays local, per
  server-hardening)
- Browser / web access to Frame Server

## Open Questions

- **Server identity.** What makes two entries "the same server"?
  - (a) The SSH host alias the user typed. Simple, but two aliases of one
    machine show up twice.
  - (b) An id Frame Server generates once and reports in `hello`. One machine
    is one entry, whatever alias reaches it.
- **Workspace switcher with many servers.**
  - (a) One REMOTE group with a sub-header per server.
  - (b) One top-level group per server, next to LOCAL.
- **Server list UI.**
  - (a) Extend the Connect dialog into a list + detail view.
  - (b) Add a "Servers" section in Settings and keep Connect for a single
    server.
- **Default location in New Workspace.**
  - (a) The last used location.
  - (b) Always This Mac.
