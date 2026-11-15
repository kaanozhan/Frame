---
keywords: frame server, multiple servers, remote, ssh, server workspace, connection, hosts, routing
related: server-workspaces, server-workspace-panels, server-hardening, server-install-update, server-onboarding, workspaces
---
Frame keeps any number of Frame Servers connected at once.

**How it works.**
- `serverLink.js` is one server's connection: today's loop moved line for line, with its own tunnel, local socket dir, backoff and install busy flag, plus `server.info` after hello.
- `serverConnection.js` is the registry over the saved list: `servers: [{ key, host, serverId, autoConnect }]` in user settings, rules in `src/shared/serverList.js`, migrated once from `server`, which is left in place for downgrades.
- Every server workspace row, root and location carries `serverKey`. Panels, git state (`serverAccess` by key), PR / update actions, `tools.check`, installs, the agent consent and terminals all go through `of(serverKey)`. A down server answers "<host> is offline" and never falls back to local or to another server.
- Server terminal ids on the desktop are `srv-<key>.<boot>-<n>`: the key is added on the way in and stripped on the way out.
- UI:
  - the Servers dialog (list + add form + per-server detail);
  - the status bar (connected/total, worst live state);
  - a Remote sub-header per server in the workspace switcher, plus "Add server…";
  - New Workspace locations per server, last used per project (`frame-nw-location`);
  - offline view and terminal banners per server.

**Why this path.**
- The server's own id (`server.info`, `~/.frame-server/server-id`) catches the same machine under two aliases; SSH alias as identity was rejected.
- A desktop key that never changes keeps routing stable when an old server starts reporting an id.
- Desktop-side id namespacing makes a terminal id clash impossible; relying on the 3-byte boot nonce was rejected.
- One REMOTE group with server sub-headers; a group per server was rejected.
- The existing Connect dialog was extended; a Settings section was rejected.

**Rules for future work.**
- Never call a server without a key: `of(key)`, there is no keyless `call` left.
- Events arrive as `fn(payload, key)`. Filter by key and listen for `removed`.
- New server-bound IPC resolves `{ serverKey }` through `serverPanels.resolve` / `serverLocation`.

**Gaps.**
- Not yet run against two real servers.
- Windows and macOS hosts are out of scope.
- `getStatus` / `onChange` still report a "default" server for legacy callers.

Chain: spec.md → plan.md → tasks.md → outcome.md
