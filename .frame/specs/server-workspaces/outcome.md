
## T01 — Shared server rules: protocol, security, routing

Added src/shared/serverProtocol.js (hello/req/res/event validate, decode, builders, checkHello naming both versions, createPending with timeouts and rejectAll), src/shared/serverSecurity.js (256-bit token, constant-time compare, upgrade check requiring Bearer token and no Origin or 'frame-desktop', bindRule warning off localhost) and src/shared/serverRouting.js (srv- ids, remote URL normalization across scp/https/ssh, clone dir names unique by owner, ~/.ssh/config Host parsing), with three test files. Methods are restricted to 'namespace.name' so a request can never name anything else.

_Captured: 2026-11-10 · 6 file change(s)_

---

## T02 — Frame Server skeleton

Added src/server/electronShim.js (Electron stubs via Module._load, analytics and the prompt log replaced by no-ops, electron-log suppressed so the logger falls back to the console, and a fake window whose sends reach onSend listeners) and src/server/index.js (--port/--bind, token kept 0600 in ~/.frame-server/token across restarts, connection.json 0600 removed on SIGTERM, WebSocket-only HTTP server with checkUpgrade before handleUpgrade, hello/version handshake, method registry with server.ping, broadcast). Added ws and the 'server' npm script. FRAME_SERVER_HOME overrides ~/.frame-server for tests.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T03 — Screen mirror for server terminals

Added src/server/screenMirror.js: a headless xterm (xterm-headless 5.3.0) with the serialize addon (0.11.0) per PTY; snapshot() waits for pending writes to parse, then returns { screen, cols, rows } to replay into a reset renderer xterm. test/screenMirror.test.js replays snapshots into fresh terminals and compares visible lines, cursor and buffer type for plain output, a TUI on the alternate screen, split escape sequences and a resize. Both packages added to package.json (pinned to the renderer's xterm 5.3 generation).

_Captured: 2026-11-10 · 4 file change(s)_

---

## T04 — Server terminals with screen persistence

Added src/server/terminals.js: Frame's ptyManager runs inside Frame Server through the shim's fake window, its term-<n> ids exposed as srv-<n>; each PTY feeds a screen mirror; terminals.create/input/resize/destroy/list/attach plus terminal.output/process/destroyed events broadcast to connected desktops; stop() kills every PTY. Wired into src/server/index.js and its shutdown. NOT verified on Linux: Docker Desktop was not running and no Linux host was available, so node-pty on Linux stays to be proven on the user's server — deviation from the plan's step 3.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T05 — Server projects, workspaces and tool checks; install notes

Added src/server/projects.js: projects.ensure clones by remote into ~/frame/projects/<dir> once and registers it in the server's project registry (a project without a usable remote is refused), projects.list, workspaces.list/create/archive/rename through Initiative 1's workspaceManager, tools.check, and a workspaces.updated event; wired into src/server/index.js. Extracted aiToolManager.checkToolAvailable from the CHECK_AI_TOOL_AVAILABLE handler (it may take the tool definition, so the server can check a desktop custom tool). Deviation: serverRouting.normalizeRemoteUrl now keeps path remotes as file:/abs/path (needed for a server on the same machine and for tests). Wrote src/server/README.md (requirements, install, systemd user unit with linger, Connect, security, files).

_Captured: 2026-11-10 · 6 file change(s)_

---

## T06 — Desktop connection to Frame Server over SSH

Added src/main/serverConnection.js: a connect loop that runs the user's ssh with BatchMode (read ~/.frame-server/connection.json, open ssh -N -L to a free local port, WebSocket with Bearer token and the desktop Origin, hello/version check, server.ping), call/send/on for main modules, status pushed as SERVER_STATUS_CHANGED, reconnect with 1–30 s backoff, disconnect that turns auto-connect off, and ~/.ssh/config host suggestions; auto-connects on launch when left connected and closes the tunnel on will-quit. Added the SERVER_* channels and wiring in src/main/index.js. Deviation: src/main/userSettings.js needed no change (its generic get/set stores the 'server' key). FRAME_SSH lets tests substitute ssh.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T07 — Connect to Server in the UI

Added src/renderer/serverConnect.js and its #server-connect-modal in index.html (SSH host with ~/.ssh/config suggestions, live status line with the server's version and platform, the error under it, Connect/Reconnect, Disconnect, closes itself once its connect succeeds; toasts on connect and on a lost link), File ▸ Connect to Server… in src/main/menu.js, server.connect / server.disconnect palette commands and init in src/renderer/index.js, and a status-bar button in src/renderer/statusBar.js (server glyph, host, state dot; hidden until a server is used; click opens the dialog). Styles went to workspaces.css.

_Captured: 2026-11-10 · 6 file change(s)_

---

## T08 — Location-aware workspaces

workspaceManager now lists the connected server's workspaces next to local ones (location 'server', host; last known rows stay as offline while disconnected), finds a project's server clone by remote URL, and routes create (location 'server' ensures the clone first), status, rename and archive to the server; WORKSPACES_UPDATED follows server events and connect/disconnect. The New Workspace dialog gained a Location field (This Mac / Server · host, disabled when not connected); server rows carry a host tag or 'offline', offer only rename/archive, and show no PR badges; PR/review/update palette commands use selectedLocalWorkspace; selecting a server workspace unwatches git status and puts a 'later update' note in the file tree. Added workspaces.status on the server. Deviations: workspaceRegistry.createRecord did not need a location (the server keeps its own records; the desktop tags rows), and src/main/gitBranchesManager.js (outside the plan's footprint) now treats ENOENT from a missing working directory as 'folder not found' instead of latching 'git is not installed' for the session — a pre-existing bug that turned git off on the server after the first archive (and on the desktop after any call in a deleted folder).

_Captured: 2026-11-10 · 9 file change(s)_

---

## T09 — Route terminals to the server in main

ptyManager's IPC now sends a server workspace's TERMINAL_CREATE to terminals.create (cwd defaulting to the server worktree) and routes srv- input/resize/destroy through serverConnection, holding input and resizes while the link is down; the server's terminal.output/process/destroyed events come back as TERMINAL_OUTPUT_ID / TERMINAL_PROCESS_DATA / TERMINAL_DESTROYED. destroyExcept and destroyAll needed no change: they only ever iterate local PTYs, so srv- terminals are already out of reach (plan expected guards). CHECK_AI_TOOL_AVAILABLE takes the lane's workspaceId and, for a server workspace, asks tools.check with this side's tool definition; agentDispatch passes it and words a miss as 'not found on <host> — install it and sign in there'.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T10 — Adopt server terminals in the renderer

Added TERMINAL_ADOPT: main lists the connected server's live terminals of a local project's server workspaces, attaches each (screen snapshot), remembers them and re-sends their last process info so lane detection sees running agents. terminalManager adopts them on connect, on reconnect and when a project is opened (new ones get an xterm and restored names, known ones are reset), writes each snapshot, then fits so the server PTY takes this window's size; while the link is down every srv- terminal shows a 'Reconnecting to <host>…' banner (or 'Disconnected…' after a manual disconnect), and main already holds input. Banner style in workspaces.css.

_Captured: 2026-11-10 · 5 file change(s)_

---
