# Plan — Server workspaces with remote terminals

## Architecture

### Resolved plan-time decisions

The user asked for the plan to go ahead on the recommended options without a decision round ("karar alınması gerekirse önerilerinle devam et"). Every fork below was decided that way and is recorded with its rationale.

Business:
- **B1 How the window reaches the server.** The desktop **main process** holds the server connection and routes each call by the workspace's location. The renderer keeps talking only to local main through the same IPC channels, with server terminals and workspaces arriving as ordinary ones that carry `location: 'server'`. Rejected: the renderer talking to the server through an `ipcRenderer` shim (the PoC). That would mean two IPC worlds in one window: 55 renderer files `require('electron')`, and every one of them would have to know which side it talks to.
- **B2 How the server starts.** The user installs Frame Server once by hand: clone the repo on the server, install production dependencies, and enable a documented systemd **user** unit. Connect only connects. If the server is not running, Connect says so and links the install notes. Rejected: Connect starting it over SSH on demand. A service that survives logout is what "keeps running when the laptop closes" needs, and installing and updating from the desktop is its own later spec.
- **B3 One server at a time.** v1 connects to one server. The host is an SSH alias or `user@host`, saved in user settings, and Frame reconnects automatically on launch. Several servers can come later without changing the protocol.
- **B4 Where projects live on the server.** Under `~/frame/projects/<repo>`, cloned from the desktop project's `origin` URL on the first server workspace. A desktop project is matched to its server clone by the normalized remote URL. A project without a remote is refused with "push it to a remote first"; push-over-SSH is later.
- **B5 Panels for a server workspace.** Terminals are this spec. Checkout-bound panels (file tree, Changes, diff, review, PR flow, update-from-base) show "Available for server workspaces in a later update" instead of reading a local path that does not exist. The row menu hides Review, Push, PR and Update for server workspaces, and keeps rename and archive, which are routed to the server.
- **B6 While disconnected.** Server workspaces stay in the sidebar marked offline. Their terminals stay on screen with a "Reconnecting to <host>…" banner, and input is held back. On reconnect each screen is redrawn from the server and input resumes.

Technical:
- **T1 What the Frame Server is.** A headless entry `src/server/index.js` in this repo, run with the system Node (≥ 18). It loads the existing main-process managers (`ptyManager`, `workspaceManager`, `gitBranchesManager`, `projectRegistry`, `aiToolManager`'s availability check) behind `src/server/electronShim.js`. The shim provides `app`, `BrowserWindow` and `ipcMain` stubs through a `Module._load` hook, and a **fake window** whose `webContents.send(channel, payload)` turns every manager event into a protocol event. Rejected: a separate reimplementation, which would fork PTY, worktree and naming logic that Initiative 1 just settled.
- **T2 Transport.**
  - `ws` (new dependency) over an SSH local forward started by the desktop: `ssh -N -o ExitOnForwardFailure=yes -L <localPort>:127.0.0.1:<serverPort> <host>`.
  - The token and port are read with `ssh <host> cat ~/.frame-server/connection.json`. That file is written by the server on start, mode 0600.
  - The server binds `127.0.0.1` unless `--bind` is given, in which case it prints a warning.
  - The upgrade must carry the token (`Authorization: Bearer`) and either no `Origin` or `Origin: frame-desktop`, so browsers are refused.
  - Token comparison is constant-time.
- **T3 Protocol.**
  - Messages are JSON:
    - `hello { protocol, frameVersion }`
    - `req { id, method, params }`
    - `res { id, ok, result | error }`
    - `event { channel, payload }`
  - A protocol mismatch is refused with both versions named.
  - Methods are namespaced: `terminals.*`, `projects.*`, `workspaces.*`, `tools.check`.
- **T4 Screen persistence.**
  - Each server PTY feeds a mirror terminal: `xterm-headless` plus `xterm-addon-serialize`, matching the renderer's `xterm` 5.3.
  - `terminals.attach(id)` returns the serialized screen and size; the renderer resets its xterm and writes it.
  - PTYs sit behind `src/server/terminals.js`, the one interface a later pty-host can replace.
- **T5 Ids.**
  - Server terminal ids are `srv-<n>`, so local main, `destroyExcept` (renderer reload) and quit teardown (`destroyAll`) never touch them.
  - Server workspace ids come from the server's `workspaceManager` (8 hex). The router keeps the current set of server workspace ids to tell routes apart.
- **T6 Agents on the server.**
  - `agentDispatch`'s pre-flight (`CHECK_AI_TOOL_AVAILABLE`) gains an optional `workspaceId`. For a server workspace, main asks the server (`tools.check`), so the CLI is checked where it will run.
  - The CLIs are the user's own, logged in on the server. Frame passes no credentials.
- **T7 Test posture.** Pure logic and the Node-runnable server pieces (protocol, security, routing, ssh config parsing, the screen mirror), following the testing record. The desktop UI is verified live.
- **T8 Linux.** node-pty on Linux is proven in step 3 by running the server in a Linux container (`node:20`) or on the user's server, before the desktop work builds on it.
- **In-flight overlap.** `ptyManager.js`, `index.js`, `pollGate.js`, `terminalManager.js`, `agentDispatch.js`, `aiToolManager.js` and `package.json` are in the footprints of `audit-q3-cross-platform` (planned 2026-07-20) and `audit-q3-performance-resources` (implementing since 2026-08-26, stalled). Changes here are additive: routing guards, new optional parameters and new dependencies. They are noted for whoever resumes those audits.

### Data shapes

```
connection.json (server, 0600)  = { port, token, protocol, frameVersion, pid }
userSettings.server             = { host } | null
ServerStatus                    = { state: 'off'|'connecting'|'connected'|'reconnecting'|'error', host, error?, frameVersion? }
Workspace (as the renderer sees it) += { location: 'local'|'server', host?, offline? }
Protocol: hello | req { id, method, params } | res { id, ok, result?, error? } | event { channel, payload }
Methods: terminals.create { projectPath, workspaceId, cwd, cols, rows } → { terminalId }
         terminals.input / resize / destroy / list / attach → { screen, cols, rows }
         projects.ensure { originUrl } → { projectPath }
         workspaces.list / create / archive / rename (same payloads as the local IPC)
         tools.check { toolId } → same shape as CHECK_AI_TOOL_AVAILABLE
```

## Files

- `package.json` — **Modified**: dependencies `ws`, `xterm-headless`, `xterm-addon-serialize`; script `server`
- `src/shared/serverProtocol.js` — **New**: message encode/decode/validate, hello and version check, request correlation helpers
- `src/shared/serverSecurity.js` — **New**: token generation, constant-time compare, upgrade check (token + Origin), bind-address rule
- `src/shared/serverRouting.js` — **New**: `srv-` id rules, remote URL normalization and matching, server project dir name, `~/.ssh/config` Host parsing
- `test/serverProtocol.test.js` — **New**
- `test/serverSecurity.test.js` — **New**
- `test/serverRouting.test.js` — **New**
- `src/server/electronShim.js` — **New**: Electron stubs and the fake window that turns manager sends into protocol events
- `src/server/index.js` — **New**: entry, flags, `connection.json`, HTTP + WebSocket server, auth, hello, method dispatch
- `src/server/terminals.js` — **New**: server PTYs via `ptyManager` with `srv-` ids, the screen mirror per terminal, create/input/resize/destroy/list/attach
- `src/server/screenMirror.js` — **New**: headless xterm + serialize per terminal
- `test/screenMirror.test.js` — **New**
- `src/server/projects.js` — **New**: `projects.ensure` (clone by origin URL, register in the server's project registry), the `workspaces.*` methods through `workspaceManager`
- `src/server/README.md` — **New**: install, systemd user unit, Connect, security notes
- `src/main/serverConnection.js` — **New**: SSH tunnel, `connection.json` read, `ws` client, RPC with timeouts, events, reconnect with backoff, status, IPC
- `src/main/ptyManager.js` — **Modified**: terminal IPC routes server workspaces and `srv-` ids to `serverConnection`; `destroyExcept` and `destroyAll` skip `srv-` ids
- `src/main/workspaceManager.js` — **Modified**: `list` merges server workspaces (location, host, offline); `create` / `archive` / `rename` route by location; `reconcile` is not applied to server rows
- `src/shared/workspaceRegistry.js` — **Modified**: `createRecord` accepts a location
- `src/main/aiToolManager.js` — **Modified**: `CHECK_AI_TOOL_AVAILABLE` routes to `tools.check` for a server workspace
- `src/main/userSettings.js` — **Modified**: the `server` setting
- `src/main/index.js` — **Modified**: init `serverConnection` and its IPC
- `src/main/menu.js` — **Modified**: File ▸ Connect to Server…
- `src/shared/ipcChannels.js` — **Modified**: `SERVER_CONNECT`, `SERVER_DISCONNECT`, `SERVER_STATUS`, `SERVER_STATUS_CHANGED`, `TERMINAL_ADOPT`
- `index.html` — **Modified**: Connect to Server modal; Location field in the New Workspace modal
- `src/renderer/serverConnect.js` — **New**: Connect dialog (host with suggestions from `~/.ssh/config`), status
- `src/renderer/statusBar.js` — **Modified**: server status indicator
- `src/renderer/newWorkspaceModal.js` — **Modified**: Location (This Mac / server, disabled when not connected)
- `src/renderer/workspaceSection.js` — **Modified**: server tag and offline state on rows; menu items by location
- `src/renderer/workspacePr.js` — **Modified**: no review/PR/update items for server workspaces
- `src/renderer/terminalManager.js` — **Modified**: adopt server terminals (attach screen), reconnecting banner, held input
- `src/renderer/agentDispatch.js` — **Modified**: pass `workspaceId` to the pre-flight
- `src/renderer/index.js` — **Modified**: `server.connect` / `server.disconnect` palette commands; init `serverConnect`; placeholder for checkout panels on server workspaces
- `src/renderer/styles/components/workspaces.css` — **Modified**: server tag, offline row, connect modal, reconnecting banner

## Footprint

- package.json
- src/shared/serverProtocol.js
- src/shared/serverSecurity.js
- src/shared/serverRouting.js
- test/serverProtocol.test.js
- test/serverSecurity.test.js
- test/serverRouting.test.js
- src/server/**
- test/screenMirror.test.js
- src/main/serverConnection.js
- src/main/ptyManager.js
- src/main/workspaceManager.js
- src/shared/workspaceRegistry.js
- src/main/aiToolManager.js
- src/main/userSettings.js
- src/main/index.js
- src/main/menu.js
- src/shared/ipcChannels.js
- index.html
- src/renderer/serverConnect.js
- src/renderer/statusBar.js
- src/renderer/newWorkspaceModal.js
- src/renderer/workspaceSection.js
- src/renderer/workspacePr.js
- src/renderer/terminalManager.js
- src/renderer/agentDispatch.js
- src/renderer/index.js
- src/renderer/styles/components/workspaces.css

## Dependencies

- `ws` — WebSocket server (Frame Server) and client (desktop main). Electron 28's Node 18 has no stable WebSocket client, and the server needs upgrade-time auth.
- `xterm-headless` — the server-side mirror of each terminal, the same parser generation as the renderer's `xterm` 5.3.
- `xterm-addon-serialize` — turns the mirror into an escape-sequence snapshot that the renderer's xterm replays exactly (full-screen TUIs included).

## Sequencing

1. **Shared rules.**
   - `src/shared/serverProtocol.js`: messages, hello and version check, correlation.
   - `src/shared/serverSecurity.js`: token, constant-time compare, upgrade check, bind rule.
   - `src/shared/serverRouting.js`: `srv-` ids, remote URL normalization and matching, project dir name, `~/.ssh/config` Host parsing.
   - Tests in `test/serverProtocol.test.js`, `test/serverSecurity.test.js` and `test/serverRouting.test.js`.
2. **Frame Server skeleton.**
   - Add `ws` and the `server` script to `package.json`.
   - `src/server/electronShim.js` and `src/server/index.js`: flags `--port` / `--bind`, `~/.frame-server/connection.json` (0600), WebSocket upgrade auth (token + Origin), hello and version check, method dispatch, `ping`.
   - `src/server/README.md` with the install steps and the systemd user unit.
3. **Server terminals with screen persistence.**
   - Add `xterm-headless` and `xterm-addon-serialize`.
   - `src/server/screenMirror.js` with `test/screenMirror.test.js`.
   - `src/server/terminals.js`: `ptyManager` with `srv-` ids through the fake window, a mirror per terminal, `terminals.create/input/resize/destroy/list/attach`, and output/process/destroyed events.
   - Prove node-pty and the server on Linux (container or the user's server).
4. **Server projects and workspaces.** `src/server/projects.js`:
   - `projects.ensure` clones by origin URL into `~/frame/projects/<repo>` and registers it;
   - `workspaces.list/create/archive/rename` go through the server's `workspaceManager`;
   - `tools.check` uses `aiToolManager`'s availability check.
5. **Desktop connection.**
   - `src/main/serverConnection.js`: SSH tunnel, `connection.json` over SSH, `ws` client, RPC with timeouts, event stream, reconnect with backoff, status.
   - The `server` setting in `userSettings.js` with auto-connect on launch.
   - `SERVER_*` channels in `ipcChannels.js`; wiring in `src/main/index.js`.
6. **Connect to Server in the UI.**
   - `src/renderer/serverConnect.js` and its modal in `index.html`: host field with `~/.ssh/config` suggestions, connect/disconnect, errors such as "Frame Server is not running on <host>" with the install notes.
   - File menu item (`menu.js`).
   - `server.connect` / `server.disconnect` palette commands (`src/renderer/index.js`).
   - Status indicator in `statusBar.js`.
7. **Workspaces across locations.**
   - `workspaceRegistry.createRecord` takes a location.
   - `workspaceManager`: `list` merges the server's workspaces (location, host, offline); `create` / `archive` / `rename` route by location (`create` ensures the server project first).
   - New Workspace modal: Location field.
   - Workspace rows: server tag and offline state; menus by location (`workspaceSection.js`, `workspacePr.js`).
   - Checkout panels show the placeholder for a server workspace (`src/renderer/index.js`).
   - Styles in `workspaces.css`.
8. **Remote terminals in the window.**
   - `ptyManager` IPC routes server-workspace creates and `srv-` input/resize/destroy to `serverConnection`, and forwards output/process/destroyed events. `destroyExcept` / `destroyAll` skip `srv-` ids.
   - `TERMINAL_ADOPT`: on connect, the renderer adopts the server's live terminals with their attached screens (`terminalManager.js`). While disconnected, terminals show the reconnecting banner and hold input.
   - The pre-flight takes `workspaceId` and routes to `tools.check` (`agentDispatch.js`, `aiToolManager.js`).
