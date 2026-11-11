---
keywords: frame server, onboarding, sign in, server terminal, git bundle, send project, clone, check-up
related: server-workspaces, server-install-update, server-hardening, server-workspace-panels
---

# Server onboarding: sign-ins and sending a project

## Problem

The first field test (2026-11-11, a fresh Ubuntu server, user `kaan`) stopped right after Frame Server installed. Two gaps make a first-time user leave Frame for a hand-made SSH session:

- **Sign-ins need a terminal Frame cannot open.** The check-up lists Claude Code, Codex and GitHub CLI as "not signed in" and offers commands to copy. Frame opens server terminals only inside a server workspace, and creating one needs the server to clone the project. That clone needs GitHub access on the server for a private repository, which is exactly what is not signed in yet.
- **A project reaches the server only by the server cloning its remote.** A private repository fails until the server has its own GitHub credentials, and a project with no remote cannot be used at all. The user expects to send a project from the Mac to the server.

Each workaround (making the repository public, SSHing in by hand) is something a new user cannot be expected to know.

## Goal

- **A server terminal without a workspace.** The Connect dialog and the check-up can open a terminal on the server in its home folder. Each missing check-up item has a button that opens it with that item's sign-in command typed in, ready for the user to run. After a sign-in, "Check again" shows the item ready.
- **Send a project to the server.** When a server workspace is created for a project the server does not have, the desktop sends the project's committed history as a `git bundle` over SSH. The server clones from the bundle into its project home and sets `origin` to the project's remote, when it has one. No credential on the server is needed for this. Later workspaces of the project start from the server's clone as today.

## Constraints

- **A recorded decision is changed deliberately.** server-workspaces (2026-11-09) chose "code never travels from the Mac". This spec reverses that for committed history only, sent over the user's own SSH. The other half stays: uncommitted changes and ignored files (`.env` and similar) never move.
- SSH remains the only access path (server-workspaces, server-hardening). There is no agent forwarding, no new port and no credential copied to the server.
- Upload uses the existing SSH-stream pattern of server-install-update (`serverInstaller.upload`). No new transport is added.
- A server terminal without a workspace runs as the connected user, in the home folder. It follows the same lifecycle and adopt rules as server workspace terminals (server-hardening T3/T4), and is never created locally.
- Protocol changes follow server-hardening: the number changes only if a message's meaning changes, desktop and server change together, and the mismatch reaches `needs-update`.
- Every reproducible behaviour gets its failing test first, in the existing harnesses (`test/serverConnection.test.js` with the fake ssh, the server tests, the installer scenarios).
- Commits only with the user's approval.

## Success Criteria

- When the check-up shows "Claude Code — installed, not signed in", then a button on that item opens a server terminal in the home folder with the sign-in command typed in, and after signing in, "Check again" shows it ready, without leaving Frame.
- When the user opens a server terminal from the Connect dialog, then it runs on the server as the connected user in the home folder, survives a desktop restart and a reconnect like workspace terminals, and is listed apart from any workspace.
- When a server workspace is created for a private repository and the server has no GitHub credentials, then the project arrives by bundle, the workspace is created, and the server clone's `origin` is the project's remote.
- When the project has no remote, then it still arrives by bundle and its workspace works. Push and PR say a remote is needed.
- When the project already exists on the server, then no bundle is sent again unless the open question below decides otherwise.
- When the project has uncommitted changes or ignored files, then none of them reach the server, and the user is told that only committed history was sent.
- When the upload fails or is interrupted, then nothing half-cloned remains on the server and the error names the cause.
- When `npm test` runs, then it passes, with harness tests for the bundle path (private repo, no remote) and the home terminal.

## Out of Scope

- Copying uncommitted changes or ignored files to the server
- Moving an existing local workspace to the server
- Port forwarding for browser-callback logins (Codex `localhost:1455`); device-code logins are used instead
- Editing server files, specs on the server (still deferred by server-workspace-panels)
- Running the test suite on Node 22 in CI (separate follow-up from the field test)

## Open Questions

- **Clone from the remote first, or always send a bundle?**
  - (a) Try the server's own clone from `origin`; send a bundle only when that fails or there is no remote.
  - (b) Always send a bundle the first time, then set `origin`.
- **Keeping a server clone current when the server cannot fetch** (no credentials yet):
  - (a) Send an incremental bundle of new commits before each workspace create.
  - (b) Leave it to `git fetch` once the user has signed in; fall back to the server's last known base as today.
- **Identifying a project with no remote on the server** (today projects are matched by normalized remote URL):
  - (a) The root commit's hash plus the folder name.
  - (b) A Frame project id stored with the project.
