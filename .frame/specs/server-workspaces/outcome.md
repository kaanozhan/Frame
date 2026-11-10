
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
