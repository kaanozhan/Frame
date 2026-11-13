---
keywords: self-hosted, frame server, remote, ssh, server workspace, remote terminal, persistence, headless
related: workspaces, spec-in-workspace, workspace-pr-flow, update-from-base
---

# Server workspaces with remote terminals

## Problem

Frame's agents only run on the machine Frame runs on. When the laptop closes, the agents stop. Users who want "keep working when the laptop closes" and "parallel agents on a bigger box" build it themselves with a VPS, Tailscale, tmux and mosh. Conductor, the closest workspace tool, is shutting down (Cloud read-only 2026-11-13, off 2026-11-20). This is the top demand found in the 2026-11-08 research.

Frame now has workspaces (branch + worktree + terminals), the review and the PR flow, all local (Initiative 1). The self-hosted decisions of 2026-11-09 say the server only **adds a location to workspaces**: same window, and the location belongs to the workspace, never to a spec.

This spec is the first slice of Initiative 2. A workspace can live on the user's own server, and its terminals and agents run there and keep running while the Mac is away.

## Goal

- **A Frame Server process.** It runs headless on the user's Linux server (or another Mac) and hosts what a server workspace needs:
  - the project's checkout;
  - git worktrees;
  - PTYs running the user's own CLIs (Claude Code, Codex…), logged in on the server by the user.

  It listens on `127.0.0.1` only, checks the WebSocket `Origin`, and requires a random token generated on first run.
- **Connect to Server.** From the desktop app, the user picks an SSH host (from their `~/.ssh/config` or typed in). Frame uses the user's own `ssh` to forward a local port to the server, reads the token over SSH and connects. The connection state is visible, and a dropped connection reconnects on its own.
- **A project home on the server.** For a project with a git remote, Frame clones it on the server under a fixed root on the first server workspace. The clone is the server's "project home", like the main checkout locally.
- **New Workspace → Location.** The New Workspace dialog offers "This Mac" or the connected server. A server workspace is a branch and worktree created on the server, from the fetched `origin/<base>` as locally. Its row shows where it lives.
- **Remote terminals that persist.** A server workspace's terminals and agents run on the server and appear in the same window as local ones. When the desktop disconnects (lid closed, network lost, app quit), they keep running. On reconnect, each terminal's current screen is restored correctly, including full-screen TUIs like Claude Code.

## Constraints

- **Security (2026-11-09 decision):**
  - Access is the user's SSH (or Tailscale); Frame stores no SSH keys or passwords and runs the user's `ssh`.
  - The server binds `127.0.0.1` unless an explicit flag says otherwise, and then it warns.
  - The WebSocket upgrade checks `Origin` and the token; there are no default secrets.
  - This guards against the claudecodeui class of hole (CVE-2026-31975).
- **Agents and credentials.** Frame handles no model tokens and calls no model API. Agents are the official CLIs, logged in on the server by the user.
- **Same window.** Server workspaces sit in the same sidebar and terminal surfaces as local ones (rejected 2026-11-09: a separate remote window). The location is a property of the workspace (and its terminals), not of the project or a spec.
- **Terminal persistence (2026-11-09):**
  - PTYs live in the server process.
  - Screens are restored from a server-side headless terminal (`@xterm/headless` + serialize), not by replaying raw bytes.
  - PTYs sit behind one interface so a separate pty-host can come later.
  - A server restart is accepted to end the PTYs; the CLIs' own resume (`restore-ai-sessions-on-relaunch`) brings sessions back.
- **What does not move.** Uncommitted changes never move between locations (2026-11-09). Code reaches the server by cloning from the remote.
- **Builds on Initiative 1.** It reuses the workspace registry, naming, settings, setup script and archive rules (`workspaces`), `workspaceManager` and `gitBranchesManager` logic, and `pollGate`. Local workspaces keep working unchanged when no server is connected.
- **Out of scope by decision.** Orchestration (2026-11-09 decision). Multi-user, OIDC, licences, relays and managed VMs (single-user, free and open first).
- **Server platforms.** The server must run on Linux x64 (Hetzner-style VPS). Linux arm64 and macOS are desirable. node-pty on Linux is unverified and must be proven early.

## Success Criteria

- When the Frame Server starts on a Linux host, then it listens only on `127.0.0.1`, has written a random token readable only by its user, and refuses a WebSocket without the token or with a foreign `Origin`.
- When the user chooses Connect to Server and picks an SSH host where the server runs, then Frame connects through the user's `ssh` (no password or key stored by Frame) and shows the server as connected.
- When the connection drops and returns, then Frame reconnects without user action and the server state shows correctly again.
- When the user creates a workspace with Location = server for a project with a git remote, then the server clones the project once (if not already there), creates the branch and worktree from the fetched `origin/<base>`, runs the setup script there, and the row shows it as a server workspace.
- When the user opens a terminal or starts an agent in a server workspace, then it runs on the server in the worktree, and typing, output and resize work in the same terminal UI as local terminals.
- When the desktop app quits or loses the connection while an agent runs in a server workspace, then the agent keeps running, and after reconnecting the terminal shows the current screen (including Claude Code's full-screen UI) and accepts input.
- When no server is configured or connected, then local projects and workspaces behave exactly as before.
- When `npm test` runs, then existing tests pass and the new pure logic (protocol messages, token and Origin checks, location routing, headless screen serialization) has unit tests.

## Out of Scope

- Server workspace panels beyond terminals: file tree, diff, review, PR flow and update-from-base on server workspaces (next spec)
- Installing and updating the server from the desktop (VS Code Remote-SSH model, versioned installs)
- Copying gitignored files (`copyFiles` checklist, secrets warning) and the manual file sync
- Moving a workspace between locations ("Open locally")
- Specs written in server workspaces and the spec list across locations
- A browser / phone client
- A Linux desktop package (#159)
- Multi-user, OIDC, licences, relay, managed VMs
- Orchestration

## Open Questions

- **How the window reaches the server.** Options:
  - (a) the desktop main process holds the server connection and routes each call by the workspace's location, so the renderer keeps talking only to local main;
  - (b) the renderer talks to the server directly through an `ipcRenderer`-shaped shim (the PoC's approach).
- **What the Frame Server is.** Options:
  - (a) a headless entry point in this repo that loads the existing main-process managers (`ptyManager`, `workspaceManager`, `gitBranchesManager`) behind an Electron-free shim;
  - (b) a separate, smaller server package that reimplements only the PTY, git and worktree operations it needs.
- **How the server is started in this spec.** Options:
  - (a) the user installs it once by hand (documented command plus a systemd user unit); Connect only connects;
  - (b) Connect starts it over SSH on demand when it is not running (still a manual install).
