## T01 — Saved-server list rules

Added `src/shared/serverList.js` (validate/add with a desktop key, refuse a listed alias case-insensitively, remove, find by key or `serverId`, update with an immutable key, auto-connect keys, sanitize, one-time `server` → `servers` migration) and `test/serverList.test.js` (10 tests). No divergence from plan.md.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T02 — Server identity on Frame Server

Added the `server.info` method and `serverId(home)` to `src/server/index.js` (id in `<HOME>/server-id`, 16 hex, 0600, read on every call, malformed file replaced). Made `test/fixtures/fake-frame-server/index-ws.js` answer it, or answer Unknown method when there is no id file, and pinned stability in `test/serverSocket.test.js`. No divergence from plan.md.

_Captured: 2026-11-15 · 3 file change(s)_

---

