---
keywords: frame server, hardening, install script, systemd, reconnect, consent, token, terminals, routing
related: server-workspaces, server-workspace-panels, server-install-update
---

# Frame Server hardening

## Problem

A review of the three Frame Server specs on 2026-11-11 (independent read-throughs, with the most severe findings confirmed in the code) found defects that would surface on the first real Linux install and in everyday use. The work so far ran only on one Mac with an SSH stand-in. The install script's systemd branch has never executed, and no test runs the script. Two findings break rules the user set: never kill running agents without consent, and access is only the user's SSH. These must be fixed before the server is installed on a real machine or the branches reach `main`.

Findings, by id (file:line as of commit `2a592fd`):

**Install, update and service**
- **S1 A progress line corrupts the result line on systemd hosts.** `start_server` runs inside a command substitution, so its "linger is off…" message is captured into the service name. The desktop cannot parse `FRAME_INSTALL_RESULT` and reports a failed install although the server is running. (`install-frame-server.sh:149`, `serverInstaller.js:151`)
- **S2 Packages are built on ubuntu-24.04 (glibc 2.39).** node-pty is compiled there, so on Debian 11, Ubuntu 20.04 or RHEL 8 the server may crash on load. (The bundled Node 20 itself needs glibc 2.28, so Amazon Linux 2 cannot be supported at all; corrected at plan time.) A released desktop has no fallback. The smoke test only runs on the build runner, so it cannot see this. (`server-package.yml:35`)
- **S3 A failed first install leaves the systemd unit crash-looping.** With no version to go back to, the unit is never stopped or disabled. (`install-frame-server.sh:203`, `:326`)
- **S5 A failed rollback loses the rollback target.** `previous` is repointed before the health check and never restored. Reinstalling the version that equals `previous` deletes it up front. (`install-frame-server.sh:220`, `:309`)
- **S6 `stop_server` ignores `--home`.** On a systemd host, any run against another home stops the user's real service and its agents. (`install-frame-server.sh:126`)
- **S7 A stale pid file can kill an unrelated process.** The reused pid also makes `status` report "running", so the server is never started again. (`install-frame-server.sh:131`, `bin/frame-server`)
- **S9 Agent consent fails open.** When `terminals.list` errors or times out, the update or rollback proceeds as if no agent were running. (`serverInstaller.js:283`, `serverConnection.js:386`)
- **S10 Two installers can run at once.** `busy` is set after an await, and the script takes no lock. (`serverConnection.js:383`)
- **S12 The Connect dialog clears progress and the check-up before main answers.** A double click wipes a running install's progress. (`serverConnect.js:265`)

**Connection and security**
- **S4 The reconnect loop never recovers from a stale `connection.json`.** After a kill -9, OOM or reboot the file remains, so the loop retries a dead port forever without probing or starting the server. (`serverConnection.js:289`)
- **S8 The token can reach another local user on a shared host.** The port is fixed and the token persistent. While the server is down, another user can listen on the port and receive the desktop's `Authorization` header. The fixed port also prevents two users on one host from running the service. (`server/index.js:42`, `serverConnection.js:157`)
- **S11 The link can get stuck.** Close and exit listeners attach only after the first ping, and `openSocket` never settles when the socket closes after the upgrade but before hello. (`serverConnection.js:204`)

**Routing and terminals**
- **T1 Terminal-create replies cross.** The renderer matches `TERMINAL_CREATED` by channel only, and the server path now answers after a round trip. A concurrent local create initialises the wrong lane, and the server terminal runs unseen. (`ptyManager.js:620`, `terminalManager.js:357`)
- **T2 The server workspace cache is not invalidated when the host changes.** The project never resolves on the new host until the app restarts, and new workspaces are filed under the old host. (`workspaceManager.js:170`)
- **T3 Dead server terminals are never pruned, and `srv-` ids are reused after a server restart.** Zombie lanes remain, and a new `srv-1` inherits the old lane's workspace. (`terminalManager.js:905`, `ptyManager.js:547`)
- **T4 Closing a server terminal while offline is lost.** It keeps running and reappears on reconnect. Input and resize are dropped, not held as the comment says. (`ptyManager.js:636`)
- **T5 Orchestration lanes follow the selected workspace onto the server.** (`orchestrator.js:125`, `ptyManager.js:500`)
- **T6 Path-only routing cannot tell a local workspace from a server one with the same absolute path.** This can happen when both machines share the home path. (`serverRouting.js:105`, `serverPanels.js:35`)
- **T7 File-tree replies are uncorrelated and server errors are swallowed.** An error gives an empty tree with no message, a late reply overwrites another workspace's tree, and the offline note is wiped. (`fileTree.js:172`, `index.js:267`)
- **T9 The server keeps watching and polling for a desktop that has left.** There is one watcher and one polled project for all clients. (`panels.js`, `workspaceGitState.js:45`)
- **T10 Some consumers of a server root are not routed.** The sessions panel reads the desktop's store, and create/delete branch and worktree handlers run locally. (`sessionsPanel.js:129`, `gitBranchesManager.js`)

**Coverage**
- **C1** No test runs `install-frame-server.sh`. Its systemd branch has never executed anywhere.

## Goal

Every finding above is either fixed or explicitly accepted with its reason recorded. The server rules then hold on a real machine:

- **An install reports what happened.** The result line is always valid, whatever the script prints. A successful install is reported as success, and a failed one leaves nothing running or restarting.
- **Rollback is always possible.** `current` and `previous` are consistent after every outcome, including a failed rollback.
- **The installer touches only its own home.** A run for one home never stops another home's service, and a recorded pid is used only after checking it is the Frame Server process.
- **Agents are never ended without consent.** When Frame cannot tell whether agents are running, it asks.
- **The connection recovers by itself.** A dead server with stale files is detected, started when installed, and reconnected to.
- **The token only reaches Frame Server.** Another local user on the server cannot receive it or squat the endpoint.
- **Packages run on the distributions users have,** or the install says clearly why not and what to do.
- **Terminals and panels stay matched to their workspace.** Replies are correlated to their requests, caches follow the connected host, and dead terminals disappear.
- **The install script is tested.** Its paths run in CI, including the systemd path on Linux.

## Constraints

- Behaviour that is correct today does not change: this spec fixes defects and adds no features.
- The decisions of the three server specs stay: SSH is the access path, the server binds localhost, there is no root and no Docker, there is one installer script, versions sit side by side, and the main process routes.
- The protocol number changes only if a message's meaning changes. If it does, desktop and server are updated together, and the mismatch path (`needs-update`) is exercised.
- Every fix that can be reproduced in a test gets the failing test first: pure rules in `src/shared`, and script scenarios against a temporary home (as in `server-install-update` T04), now kept in the repo and run in CI.
- Local workspaces are out of this spec (`workspace-hardening`). Fixes here must not change local behaviour, and the fast paths with no server connected stay untouched.
- Commits are made only with the user's approval.

## Success Criteria

- When the install script runs on a systemd host where linger cannot be enabled, then the last line is a parseable `FRAME_INSTALL_RESULT` with `service: systemd`, the linger advice reaches the user, and the desktop reports success.
- When a first install fails its health check, then no unit is left enabled or restarting, and the result says so.
- When a rollback fails, then `current` and `previous` point at the same versions as before it started.
- When the script runs with `--home` other than the default, then it does not stop, start or signal anything belonging to the default home.
- When a pid file names a process that is not Frame Server, then nothing is signalled and status reports "not running".
- When the list of running agents cannot be obtained, then update and rollback ask for consent in general terms and do not proceed without it.
- When the server dies leaving `connection.json` behind, then the desktop detects it within a retry, starts the installed server and reconnects without user action.
- When another process listens on the server's endpoint while it is down, then the desktop does not send it the token.
- When a package is installed on a supported older distribution (the baseline chosen at plan time), then the server starts. On an unsupported one the install fails with a message naming the requirement.
- When a server terminal create and a local create overlap, then each lane gets its own terminal id.
- When the desktop connects to a different host, then the previous host's workspaces and roots are gone from the list and routing.
- When the server restarts, then lanes of terminals that no longer exist are removed on reconnect, and a reused `srv-` id is not attributed to the old lane.
- When CI runs, then the install script's scenarios pass on Linux, including a systemd user session, and `npm test` passes.
- When the spec closes, then every finding id above is marked fixed or accepted-with-reason in `outcome.md`.

## Out of Scope

- New server features (editing server files, specs on the server, copyFiles/sync, moving workspaces)
- Windows servers, containers and sandboxes
- Multi-user servers as a product feature (S8 only makes single-user-on-a-shared-host safe)
- Local workspace defects (`workspace-hardening`)

## Open Questions

- **S8 How the token is kept from other local users.** Options:
  - (a) The server listens on a Unix socket in `~/.frame-server` (mode 0600), and SSH forwards to the socket (`-L <port>:<socket path>`). There is no TCP port to squat and no port conflict between users.
  - (b) Keep TCP, with a per-install random port plus a challenge in which the server proves it knows the token before the desktop sends it.
- **S2 The package baseline.** Options:
  - (a) Build node-pty in an older container (for example Debian 11 / glibc 2.31) so the packages run on current LTS distributions.
  - (b) Keep the runner build, state the minimum glibc, and let a released desktop fall back to building from source on the server.
- **T6 Telling local from server workspaces.** Options:
  - (a) Panel calls carry the workspace id (or a location flag) and are routed by it. Path matching stays only as a fallback.
  - (b) Keep path routing and make server workspace paths unmistakable. This needs a server-side layout change.
- **T5 Orchestration lanes while a server workspace is selected.** Options:
  - (a) Orchestration always creates its lanes locally in the main workspace.
  - (b) Refuse to start orchestration while a server workspace is selected.
