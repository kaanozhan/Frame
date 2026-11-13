---
keywords: self-hosted, frame server, remote, ssh, server workspace, remote terminal, persistence, headless
related: workspaces, spec-in-workspace, workspace-pr-flow, update-from-base
---
First slice of self-hosted Frame (Initiative 2): a workspace can live on the user's own server, and its terminals and agents keep running there while the Mac is away.
- Frame Server (`src/server/`, `npm run server`) runs Frame's own main-process managers headless behind `electronShim` (Electron stubs; analytics and prompt log off; a fake window whose sends become protocol events). It listens on 127.0.0.1 with a 0600 token and refuses browser Origins (`serverSecurity`).
- The protocol is JSON hello/req/res/event (`serverProtocol`, protocol 1).
- Server methods: `terminals.*` (ptyManager with `srv-` ids plus a `screenMirror` per PTY: xterm-headless + serialize), `projects.ensure/list` (clone by remote into ~/frame/projects/<repo>), `workspaces.list/status/create/archive/rename` (Initiative 1's workspaceManager), `tools.check`.
- The desktop's `serverConnection` runs the user's ssh in BatchMode: it reads connection.json, opens an `-N -L` tunnel, connects over WebSocket, reconnects with backoff and auto-connects on launch. Main routes by location: `workspaceManager` lists and routes server workspaces (found by remote URL; offline rows while down), and `ptyManager` routes creates and `srv-` input/resize/destroy and forwards events. `TERMINAL_ADOPT` redraws the server's live terminals exactly after connect, reconnect or reload.
- UI: Connect to Server (File menu, palette, status-bar dot), a Location field in New Workspace, host/offline tags on rows, a file-tree placeholder, and a reconnecting banner.
Why this path: main-side routing keeps one IPC world (rejected: a renderer shim). Reusing the managers keeps Initiative 1's rules (rejected: a separate server). Serialized screens redraw TUIs exactly (rejected: byte replay). Manual install + systemd user unit (rejected: start over SSH on demand).
Rules for future work:
- Server terminal ids start `srv-` and local teardown never touches them.
- A desktop project maps to its server clone only by normalized remote.
- Agent pre-flight runs where the agent runs (`workspaceId` → `tools.check`).
- Every git call must survive a missing cwd: `gitBranchesManager` no longer latches "git missing" on a missing folder.
Gaps: node-pty on Linux is NOT yet verified (no Docker daemon or Linux host during the run); server checkout panels, install/update from the desktop, copyFiles/sync and moving workspaces are the next specs.

Chain: spec.md → plan.md → tasks.md → outcome.md
