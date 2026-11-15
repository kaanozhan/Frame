## T01 — Saved-server list rules

Added `src/shared/serverList.js` (validate/add with a desktop key, refuse a listed alias case-insensitively, remove, find by key or `serverId`, update with an immutable key, auto-connect keys, sanitize, one-time `server` → `servers` migration) and `test/serverList.test.js` (10 tests). No divergence from plan.md.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T02 — Server identity on Frame Server

Added the `server.info` method and `serverId(home)` to `src/server/index.js` (id in `<HOME>/server-id`, 16 hex, 0600, read on every call, malformed file replaced). Made `test/fixtures/fake-frame-server/index-ws.js` answer it, or answer Unknown method when there is no id file, and pinned stability in `test/serverSocket.test.js`. No divergence from plan.md.

_Captured: 2026-11-15 · 3 file change(s)_

---

## T03 — One link per server

Added `src/main/serverLink.js`: today's connection loop and install actions, held per instance, plus a `server.info` call after hello that stores `serverId` in the status. Reduced `src/main/serverConnection.js` to settings, window, IPC and one link behind the unchanged API. Divergence: a refused call now says "Not connected to <host>." from the link ("Not connected to a server." only when no link exists).

_Captured: 2026-11-15 · 2 file change(s)_

---

## T04 — Server registry, key-aware IPC, migration

Turned `src/main/serverConnection.js` into the registry of per-server links: saved list in `servers` (migrated from `server`), `of`/`all`/`list`/`add`/`remove`/`connect`/`disconnect`, `on(name, fn(payload, key))`, default-server fallback for keyless callers, duplicate `serverId` removal with a notice, and key-aware IPC plus `SERVERS_LIST`/`SERVER_ADD`/`SERVER_REMOVE` in `src/shared/ipcChannels.js`. `test/fixtures/fake-ssh.js` takes `FAKE_REMOTE_HOMES`, and `test/serverConnection.test.js` covers S1, S2, S6, S7, S8 and the duplicate case. Divergence: `connect` also accepts a host and adds it, and the status payload keeps the default server's fields, so the single-server renderer works until T09.

_Captured: 2026-11-15 · 4 file change(s)_

---

## T05 — Installs per server

Made `serverInstaller.runningAgents(key)` read one server's terminals and passed the link's key from `serverLink.runAction`. The fake server lists terminals from `<home>/fake-terminals`, and `test/serverConnection.test.js` covers S10: consent for boxb names only boxb's agents, and box stays connected while boxb's installer runs. Divergence: the test drives a rollback rather than an update, to avoid a network download.

_Captured: 2026-11-15 · 4 file change(s)_

---

