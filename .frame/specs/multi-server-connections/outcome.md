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

## T06 — Server workspaces per server

Rewrote the server half of `src/main/workspaceManager.js` around per-server links: rows cached per project and server key, listed across every saved server, `serverKey`/`host` on rows, roots and locations, calls and creates through the row's own link, bundles uploaded to the chosen host, removed servers dropped. `test/serverHost.test.js` (two servers, same name, one down, one removed) and `test/serverSendProject.test.js` (create on a chosen server) were moved to the registry API. Divergence: `create` without `serverKey` uses the first connected server until T12 sends the key.

_Captured: 2026-11-15 · 3 file change(s)_

---

## T07 — Panels, git state and agent checks per server

Routed `src/main/serverPanels.js`, `src/main/gitStatusManager.js`, `src/main/workspaceGitState.js` and `src/main/aiToolManager.js` by `serverKey`. `mergeGitStatePayloads` in `src/shared/serverRouting.js` now merges several servers, with `serverAccess` by key. Updated `test/serverPanelsRefuse.test.js` (two servers, offline names its host) and `test/serverRouting.test.js`. Divergences: the registry's keyless fallback stays until T08, because `ptyManager` is its last user, and the `workspacePr.access` change moved here from T12, because the payload shape changes in this task.

_Captured: 2026-11-15 · 8 file change(s)_

---

## T08 — Terminals per server

Routed server terminals per server in `src/main/ptyManager.js`: desktop ids `srv-<key>.<boot>-<n>`, calls through the terminal's own link, events re-keyed, pending closes per server, adopt across links, removal clears lanes, home terminals with `serverKey`. Added `desktopTerminalId` / `splitDesktopTerminalId` and a keyed `parseServerTerminalId` in `src/shared/serverRouting.js`, and covered them in `test/ptyTerminals.test.js` and `test/serverRouting.test.js`. Divergences: the keyless `call` / `send` left `serverConnection.js` here (planned for T07), and `serverInstaller.runningAgents` now uses a link without a key. Followup: `src/renderer/terminalManager.js` still keeps one server status (reconnect banner, adopt trigger) — not in plan.md's Files.

_Captured: 2026-11-15 · 7 file change(s)_

---

## T09 — Servers dialog: list + detail

Rebuilt the Servers dialog in `index.html` and `src/renderer/serverConnect.js` as a list with an add form plus a detail pane for the selected server, with actions by key, per-server models, progress routed by key, Remove with confirmation, and a duplicate notice. Styled it in `src/renderer/styles/components/workspaces.css`, and added per-key model helpers plus `summary` / `pickSelected` to `src/renderer/serverConnectModel.js` (tests in `test/serverConnectModel.test.js`). The home-terminal request now passes `serverKey`, which terminalManager forwards in T13. Divergence: the dialog is titled "Servers" rather than "Connect to Server".

_Captured: 2026-11-15 · 5 file change(s)_

---

## T10 — Status bar: connected / total servers

Rewrote the server item in `src/renderer/statusBar.js` to draw from the saved-server list: host for one server, `connected/total servers` for several, the worst live state as the dot (`serverConnectModel.summary`), and one tooltip line per server. No divergence from plan.md.

_Captured: 2026-11-15 · 1 file change(s)_

---

## T11 — Workspace switcher: a sub-header per server

Replaced the single-host Remote group in `src/renderer/workspaceSection.js` with one sub-header per saved server (host, link dot, '+' or Connect / Set up), its own rows or compact empty state, and an 'Add server…' row. Buttons carry `data-key`, and the group re-renders on every server's state change. Styled it in `src/renderer/styles/components/workspaces.css`. No divergence from plan.md.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T12 — New Workspace locations, offline view, Disconnect

Made `src/renderer/newWorkspaceModal.js` list every saved server as a location, pick the opened-for server or the project's last location (`frame-nw-location`), and send `serverKey` with the create. In `src/renderer/index.js`, the offline view follows the workspace's own server and Disconnect from Server covers every server. Divergence: the `workspacePr.js` change planned here shipped in T07.

_Captured: 2026-11-15 · 2 file change(s)_

---

