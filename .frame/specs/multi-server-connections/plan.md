# Plan — Multiple Frame Servers

## Architecture

### Resolved plan-time decisions

**Business** (asked, 2026-11-15)

- **How Frame tells servers apart.** Frame Server's own ID is used. Each
  Frame Server keeps a permanent ID and reports it through a new
  `server.info` method. The desktop uses it to drop a duplicate entry:
  adding a second SSH alias of a machine that is already in the list is
  refused, naming the existing entry. A server too old for `server.info`
  has no ID and is told apart by its SSH alias only. Rejected: using the
  SSH alias alone, because then two aliases of one machine show up as two
  servers.
- **Workspace switcher.** One REMOTE group with a sub-header per server
  (host + link dot). LOCAL / REMOTE from the 2026-11-15 switcher stay the
  top level. Rejected: one top-level group per server, which grows the
  dropdown with every server.
- **Server list UI.** The existing Connect to Server dialog is extended
  into a list (left) + detail (right). Detail holds status, Connect /
  Disconnect, Install / Update / Roll back and the check-up. Rejected: a
  separate Servers section in Settings, which would be a second place to
  look.
- **Default location in New Workspace.** The last used location, per
  project. Opening from a server's "New remote workspace" button always
  picks that server. Rejected: always This Mac, which is slower for
  server-heavy work.

**Technical**

- **Test posture** (asked): everything testable. This covers `src/main`
  and `src/shared` with stubs, the fake-ssh + fake-server connection
  tests, and the pure renderer model. DOM-coupled renderer code stays
  untested (no DOM harness; see `## Testing` in PROJECT_NOTES).
- **One link object per server** (silent). The connection code is split
  in two:
  - `serverLink.js` (New) is one server's connection loop, with the same
    state today's module-level variables hold.
  - `serverConnection.js` becomes the registry of links.
  - Rationale: callers keep the API they use today (`call`, `send`,
    `on`, `isConnected`, `getStatus`), only on a chosen link. The
    existing loop moves; it is not rewritten.
- **A Frame-generated `key` per saved server** (silent). Each saved
  server gets a random 8-hex `key` from the desktop, assigned when it is
  added. The `serverId` reported by the server is stored beside it and
  used only to catch duplicates.
  - Rationale: a key that never changes means routing, cached rows and
    remembered locations never need rewriting. This holds even when an
    old server is updated and starts reporting an ID.
- **Server terminal ids are namespaced on the desktop** (silent). Frame
  Server ids are `srv-<6-hex boot>-<n>` (`src/server/terminals.js:29`).
  At the `ptyManager` boundary the desktop maps them to
  `srv-<key>.<boot>-<n>` and strips the key again before sending a call.
  - Rationale: constraint C4 requires that the same id coming from two
    servers can never misroute. A random 3-byte nonce makes a clash
    unlikely, not impossible.
  - The `srv-` prefix rule is unchanged.
- **Settings migration** (silent). The setting `server: { host,
  autoConnect }` becomes `servers: [{ key, host, serverId: null,
  autoConnect }]` once, on the first read. The old `server` key is left
  as it was, so a downgraded build still finds its one server.
- **Install concurrency** (silent). Only one install / update / rollback
  runs per server (a per-key busy flag). Two servers can install at the
  same time. Rationale: the install script already refuses a second
  installer per home (exit 16). A global lock would make server B wait
  for A for no reason.
- **"Disconnect from Server" command** (silent). The palette / File menu
  command disconnects every server. Disconnecting a single server is done
  from that server's row in the dialog.
- **The `ptyManager.js` footprint collision is accepted** (silent).
  `audit-q3-cross-platform` (planned) also changes this file, but only in
  `getDefaultShell`. This plan changes the server routing, which is a
  different part of the file.

### Data shapes

```js
// userSettings 'servers' (src/shared/serverList.js owns the rules)
[{ key: 'a1b2c3d4', host: 'devbox', serverId: '3f…' | null, autoConnect: true }]

// SERVER_STATUS_CHANGED → renderer: the whole list on every change
{ servers: [{ key, host, serverId, autoConnect,
              status: { state, host, error, frameVersion, platform, install } }] }

// Server workspace row (workspaceManager → renderer): today's row + serverKey
{ id, name, branch, path, location: 'server', host, serverKey, serverProjectPath, offline? }

// serverRoots() / serverLocation() entries gain serverKey;
// serverPanels.resolve() returns { root, host, serverKey, id, projectPath, serverProjectPath }

// WORKSPACE_GIT_STATE payload: serverAccess per server
{ projectPath, access, serverAccess: { [serverKey]: { gh, authed, repoName } }, workspaces }
```

### Components

- **`serverLink.js` (New).** Today's connection loop, held per instance
  instead of module-level:
  - preflight → `connection.json` → `ssh -N -L` tunnel with its own
    local socket dir → WebSocket → hello, then reconnect with backoff;
  - `call` / `send` / `on` / `getStatus` / `isConnected`, plus
    `runAction` (install, update, rollback) with its own busy flag;
  - after hello, it calls `server.info` and reports the `serverId`.
    "Unknown method" means `serverId: null`.
- **`serverConnection.js` (Modified)** becomes the registry:
  - `of(key)` returns that server's link;
  - `all()` returns every link;
  - `on(name, fn)` passes each event as `fn(payload, key)` for every link;
  - `add(host)`, `remove(key)`, `connect(key)`, `disconnect(key)`;
  - IPC: `SERVER_*` invokes take `{ key }`, plus new `SERVERS_LIST`,
    `SERVER_ADD` and `SERVER_REMOVE`;
  - `init` auto-connects every server saved with `autoConnect: true`;
  - when a link reports a `serverId` that another entry already holds,
    the new entry is removed and the renderer is told which existing
    entry it duplicates.
- **Routing (Modified).**
  - `workspaceManager` keeps
    `serverRows: Map<projectPath, Map<serverKey, entry>>`.
  - `list` merges the rows of every saved server. A server that is down
    contributes its last known rows as `offline`.
  - `createOnServer` takes `serverKey`.
  - `serverPanels.call`, `gitStatusManager` (remote watch),
    `workspaceGitState` (state per server), `aiToolManager`
    (`tools.check`), `serverInstaller.runningAgents(key)` and `ptyManager`
    (a terminal → server map, adopt across every connected link, home
    terminals with a `serverKey`) all pick their link by `serverKey`.
  - A server that is offline answers with its own offline error. Nothing
    falls back to the local disk or to another server.
- **Renderer.**
  - `serverConnect.js` holds the list and its statuses:
    `getServers()`, `getStatus(key)`, `onChange(cb(list, prev))`,
    `open({ key? })`.
  - `serverConnectModel.js` keeps one model per key and gains the pure
    `summary(list)`. The status bar draws from it: connected / total and
    the worst state.
  - `workspaceSection.js` renders REMOTE as one sub-header per saved
    server. Each sub-header holds that server's rows, or its empty state
    from 2026-11-15 ("Connect" / "New remote workspace"). An "Add server…"
    row at the end opens the dialog's add form.
  - `newWorkspaceModal.js` lists This Mac plus every saved server (down
    ones disabled). It remembers the last location per project in
    localStorage `frame-nw-location`.

## Files

- `src/shared/serverList.js` — **New**: pure rules for the saved-server
  list (validate and add host, duplicate alias, remove, migrate from
  `server`, find a duplicate `serverId`, auto-connect keys).
- `src/main/serverLink.js` — **New**: one server's connection: today's
  connection loop and install actions, held per instance.
- `src/main/serverConnection.js` — **Modified**: the registry of links
  (`of`, `all`, `on(payload, key)`, add / remove / connect / disconnect),
  key-aware IPC, migration on init, auto-connect for every saved server.
- `src/main/serverInstaller.js` — **Modified**: `runningAgents(key)` reads
  that server's terminals and workspace names.
- `src/main/workspaceManager.js` — **Modified**: rows cached per server
  key, `list` across every server, `serverKey` on rows / `serverRoots()` /
  `serverLocation()`, `createOnServer` by key, events by key.
- `src/main/serverPanels.js` — **Modified**: `resolve` carries
  `serverKey`; `call` uses that server's link and offline error.
- `src/main/gitStatusManager.js` — **Modified**: the remote watch follows
  its entry's server; `git.status` / `connected` events are filtered by
  key.
- `src/main/workspaceGitState.js` — **Modified**: server state per
  (project, server key); `pr.state` matched by key;
  `refreshServer` / `onServer` route by key.
- `src/main/aiToolManager.js` — **Modified**: `tools.check` goes to the
  workspace's server.
- `src/main/ptyManager.js` — **Modified**: map terminal id → server key,
  namespaced ids at the boundary, create / input / resize / destroy /
  adopt per server, home terminals with `serverKey`.
- `src/shared/serverRouting.js` — **Modified**: namespaced terminal id
  helpers (`serverTerminalId` / `parseServerTerminalId` with a key), and
  `mergeGitStatePayloads` over several servers (`serverAccess` by key).
- `src/shared/ipcChannels.js` — **Modified**: `SERVERS_LIST`, `SERVER_ADD`,
  `SERVER_REMOVE`.
- `src/server/index.js` — **Modified**: the `server.info` method (stable
  `serverId` from `<HOME>/server-id`, created 0600 on first boot).
- `src/renderer/serverConnect.js` — **Modified**: the server list and its
  statuses, list + detail dialog, add / remove, actions per key.
- `src/renderer/serverConnectModel.js` — **Modified**: one model per key;
  pure `summary(list)` for the status bar.
- `src/renderer/statusBar.js` — **Modified**: the server item shows
  connected / total with the worst state's dot; click opens the dialog.
- `src/renderer/workspaceSection.js` — **Modified**: REMOTE sub-header per
  server with its rows or empty state; "Add server…" row.
- `src/renderer/newWorkspaceModal.js` — **Modified**: location per saved
  server, last used per project, `open({ location, serverKey })`.
- `src/renderer/workspacePr.js` — **Modified**: `access(ws)` reads
  `serverAccess[ws.serverKey]`.
- `src/renderer/index.js` — **Modified**: the offline view follows the
  selected workspace's own server; `onNew` passes `serverKey`; "Disconnect
  from Server" disconnects every server.
- `index.html` — **Modified**: Connect dialog markup becomes list + detail
  with an add form.
- `src/renderer/styles/components/workspaces.css` — **Modified**: REMOTE
  sub-headers, "Add server…" row, the dialog's list + detail layout.
- `test/serverList.test.js` — **New**: add / remove / duplicates /
  migration / auto-connect rules.
- `test/serverConnection.test.js` — **Modified**: two fake servers at once;
  drop one; relaunch auto-connect; migration of a single saved server;
  remove; install on A keeps B; duplicate `serverId` refused.
- `test/fixtures/fake-ssh.js` — **Modified**: one remote home per host
  (`FAKE_REMOTE_HOMES` JSON host → home; `FAKE_REMOTE_HOME` stays the
  fallback).
- `test/fixtures/fake-frame-server/index-ws.js` — **Modified**: answers
  `server.info` with the id in `<home>/server-id` (none → Unknown method).
- `test/serverSocket.test.js` — **Modified**: the real server answers
  `server.info`, with an id that stays the same across restarts.
- `test/serverRouting.test.js` — **Modified**: namespaced terminal ids;
  merged git state for two servers.
- `test/serverHost.test.js` — **Modified**: rows of two servers listed side
  by side; one offline keeps the other routed.
- `test/serverPanelsRefuse.test.js` — **Modified**: panel calls routed by
  `serverKey`; the offline server's error names its host.
- `test/serverSendProject.test.js` — **Modified**: the bundle goes to the
  chosen server's host.
- `test/ptyTerminals.test.js` — **Modified**: terminal input / output
  routed by server; the same server id from two servers stays apart.
- `test/serverConnectModel.test.js` — **Modified**: per-key models;
  `summary(list)`.

## Footprint

- src/shared/serverList.js
- src/main/serverLink.js
- src/main/serverConnection.js
- src/main/serverInstaller.js
- src/main/workspaceManager.js
- src/main/serverPanels.js
- src/main/gitStatusManager.js
- src/main/workspaceGitState.js
- src/main/aiToolManager.js
- src/main/ptyManager.js
- src/shared/serverRouting.js
- src/shared/ipcChannels.js
- src/server/index.js
- src/renderer/serverConnect.js
- src/renderer/serverConnectModel.js
- src/renderer/statusBar.js
- src/renderer/workspaceSection.js
- src/renderer/newWorkspaceModal.js
- src/renderer/workspacePr.js
- src/renderer/index.js
- index.html
- src/renderer/styles/components/workspaces.css
- test/serverList.test.js
- test/serverConnection.test.js
- test/fixtures/fake-ssh.js
- test/fixtures/fake-frame-server/index-ws.js
- test/serverSocket.test.js
- test/serverRouting.test.js
- test/serverHost.test.js
- test/serverPanelsRefuse.test.js
- test/serverSendProject.test.js
- test/ptyTerminals.test.js
- test/serverConnectModel.test.js

## Dependencies

None.

## Sequencing

1. **Saved-server list rules.** Add `src/shared/serverList.js`:
   - validate and add a host (refuse an alias already in the list);
   - remove by key;
   - migrate `server` → `servers`;
   - find an entry holding a given `serverId`;
   - list the keys to auto-connect.

   Write `test/serverList.test.js` with it.
2. **Server identity on Frame Server.** Register `server.info` in
   `src/server/index.js`. It reads `<HOME>/server-id`, or creates it once
   (16 random hex, 0600). Make the fake server answer it. Extend
   `test/serverSocket.test.js` so the id stays stable across restarts.
3. **One link per server.**
   - Move the connection loop and install actions from
     `serverConnection.js` into `serverLink.js` (per instance, own tunnel
     and local socket dir, own busy flag, `server.info` after hello).
   - Turn `serverConnection.js` into the registry (`of` / `all` /
     `on(payload, key)` / add / remove / connect / disconnect).
   - Make the IPC key-aware and add `SERVERS_LIST` / `SERVER_ADD` /
     `SERVER_REMOVE` in `ipcChannels.js`.
   - Migrate on init and auto-connect every saved server. A duplicate
     `serverId` drops the new entry.
   - Until step 5, main callers that have no key use the single saved
     server, so the app keeps working between steps.
   - Give `test/fixtures/fake-ssh.js` per-host homes. Extend
     `test/serverConnection.test.js` with these cases:
     - two servers connected at once;
     - dropping one leaves the other up;
     - relaunch reconnects only the servers left connected;
     - one old `server` setting migrates and reconnects;
     - removing a server closes only its tunnel;
     - a duplicate `serverId` is refused.
4. **Installs per server.**
   - `runAction(kind, { key })` installs, updates or rolls back that
     server only; the other servers stay connected.
   - `serverInstaller.runningAgents(key)` lists only that server's agents
     for the consent.
   - Test it in `test/serverConnection.test.js`: updating A keeps B
     connected, and the consent names only A's agents.
5. **Workspaces, panels and git state per server.**
   - `workspaceManager`: rows per server key, `list` across every server,
     `serverKey` on rows / roots / locations, `createOnServer` by key, the
     bundle sent to that server's host.
   - `serverPanels`, `gitStatusManager`, `workspaceGitState`
     (`mergeGitStatePayloads` over several servers in `serverRouting.js`)
     and `aiToolManager` route by `serverKey`.
   - Remove step 3's single-server fallback.
   - Update `test/serverHost.test.js`, `test/serverPanelsRefuse.test.js`,
     `test/serverSendProject.test.js` and the merge cases in
     `test/serverRouting.test.js`.
6. **Terminals per server.**
   - `ptyManager` maps each terminal id to its server key and namespaces
     ids at the boundary (`serverRouting` helpers).
   - Create, input, resize and destroy go to the terminal's own server.
   - Adopt runs across every connected link; home terminals carry
     `serverKey`.
   - Update `test/ptyTerminals.test.js`. Add id cases to
     `test/serverRouting.test.js`: the same server id from two servers
     stays apart.
7. **Server list dialog and status bar.**
   - `serverConnect.js` + `index.html` markup: the list (left, with an
     add form), the detail (right) for the selected server, and actions
     by key.
   - `serverConnectModel.js`: one model per key, plus `summary(list)`.
   - `statusBar.js` shows connected / total with the worst state's dot.
   - Extend `test/serverConnectModel.test.js`.
8. **Workspace switcher, New Workspace and offline views.**
   - `workspaceSection.js`: one REMOTE sub-header per saved server, with
     its rows or its own empty state, and an "Add server…" row
     (styles in `workspaces.css`).
   - `newWorkspaceModal.js`: location per saved server, last used per
     project, `open({ location, serverKey })`.
   - `workspacePr.access` reads `serverAccess[serverKey]`.
   - `index.js`: the offline view follows the selected workspace's own
     server, and "Disconnect from Server" disconnects every server.
