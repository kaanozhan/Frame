
## T01 — Add the install-script scenario harness; fix the result line, home scoping and pid checks

Added test/installScript.test.js, which runs the real install-frame-server.sh against a temporary HOME with packages built at test time (the real bin/frame-server plus a stand-in server from test/fixtures/fake-frame-server) and logging systemctl/loginctl stubs, so the systemd branch runs on any machine. Fixed S1: start_server sets SERVICE_USED instead of being captured by $(…) (the linger advice had been swallowed into the service name), and result() escapes every field with json_escape. Fixed S6/S7: uses_systemd() is true only for the default home, and is_frame_pid accepts a pid only when its command line runs from this home (raw or resolved path); both are used by start/stop/running_pid in the script and by service_mode/running_pid in bin/frame-server. No fake getconf yet: the glibc guard that needs it is T05.

_Captured: 2026-11-11 · 8 file change(s)_

---

## T02 — Leave a consistent state after failed installs and rollbacks; one installer at a time

Added quiesce() to the install script: when a version fails and nothing can run (first install, failed --service-only, or the fallback failing too) it disables and removes the user unit (systemd) or stops the detached server; a failed first install also removes the current and bin/frame-server links. Rollback now repoints `previous` only after the health check, and any installed copy of the version being installed (not only the running one) is moved aside and restored on failure. An atomic mkdir lock (`<home>/install.lock` with the pid) makes a second run exit 16 while one is live and takes over a dead holder's lock; one EXIT trap releases it with the stage. INSTALL_EXIT in src/shared/serverInstall.js names every exit code, with a test that every code documented in the script header is named.

_Captured: 2026-11-11 · 4 file change(s)_

---

## T03 — Ask for consent when the agent list is unknown; serialise desktop actions; Connect dialog model

runningAgents() now returns null when the server's terminals cannot be listed (not connected, error, timeout, non-array), and the new pure serverInstall.consentNeeded asks whenever agents are running, unknown, or the server cannot be asked while something is installed. serverConnection.runAction takes `busy` before its first await and releases it in one finally, so two clicks can no longer both pass while the agent list loads. New src/renderer/serverConnectModel.js holds the dialog's progress, check-up and in-flight action: progress and the check-up clear only when main reports `installing`, a second action while one is in flight does nothing, action buttons are disabled meanwhile, and the general consent text says Frame could not list the terminals; serverConnect.js draws from it. The harness test for concurrent actions moves to T04, where the connection harness is built.

_Captured: 2026-11-11 · 7 file change(s)_

---

## T04 — Recover from a dead server and a socket that closes before hello

runOnce now tags every failure after connection.json was read (tunnel, socket, hello) as `unreachable`, which resets `preflighted`, and a lost link resets it too, so the next attempt probes the host and starts an installed server instead of retrying a dead port forever. openSocket rejects when the socket closes before hello and after a 10 s hello timeout; the close/error/tunnel-exit handlers attach as soon as the socket exists (before the first ping), and `connected` is only announced if the link is still up after the ping. The probe's hand-run branch now checks the pid in connection.json (FRAME:ALIVE/DEAD), and preflight reports a stopped hand-run server instead of looping. New harness: test/fixtures/fake-ssh.js and test/serverConnection.test.js drive the real connection loop and installer against a remote home installed by the real script with a protocol-speaking fake server (fixtures/fake-frame-server/index-ws.js); it also carries T03's concurrent-action test.

_Captured: 2026-11-11 · 5 file change(s)_

---

## T05 — Build packages for glibc 2.28 and run the systemd path in CI

server-package.yml now builds each package inside quay.io/pypa/manylinux_2_28 (x64, aarch64) with node-gyp pointed at /opt/python, smoke-boots it there, then a new old-distros job boots it with its own Node and installs it with the real script on rockylinux:8, debian:11 and ubuntu:20.04 for both architectures; release upload moved to its own job after both. The installer refuses glibc older than 2.28 and musl before installing a package (exit 14, naming the requirement and supported distributions; builds from source are not checked), and the README states the floor. ci.yml gains a `systemd` job that enables linger, waits for a user session and runs the install-script tests with FRAME_TEST_SYSTEMD=1 (a new real-systemd scenario: unit runs, a broken update rolls back, cleanup), or warns that the runner has no session. Deviation: the harness exposed a real bug outside the task — serverInstaller.ssh crashed with an uncaught EPIPE when the remote `bash -s` exited before reading the whole (now larger) script; stdin errors are now ignored, since the exit code and result line carry the outcome. Followup: the workflows have not run yet; the first push shows whether the manylinux containers and the runner's systemd session behave as written.

_Captured: 2026-11-11 · 6 file change(s)_

---

## T06 — Correlate terminal-create replies and keep orchestration lanes local

The renderer's createTerminal now sends a `requestId` with every TERMINAL_CREATE and its reply handler ignores replies with another id; ptyManager echoes the id in every TERMINAL_CREATED (local, server, success and failure) through one reply helper. Orchestration's conductor and worker lanes are created with `workspaceId: 'main'`, so they never follow a selected server workspace; the spawn chain stays serial for lane order, and its comment no longer claims replies collapse. New test/ptyTerminals.test.js runs the real TERMINAL_CREATE handler with node-pty, the server connection and routing stubbed (it will carry T07's cases too).

_Captured: 2026-11-11 · 5 file change(s)_

---

## T07 — Prune dead server terminals and keep offline closes

Frame Server ids now carry a per-process nonce, `srv-<boot>-<n>` (serverRouting.serverTerminalId/parseServerTerminalId; terminals.js maps an id of another boot to no terminal), so a restarted server never hands an old lane's id to a new terminal; the `srv-` prefix rule and protocol are unchanged. A pure adoptPlan(known, live) drives both sides on reconnect: main forgets serverTerminals entries the server no longer lists, and the renderer drops those lanes locally and rebuilds a lane whose terminal now belongs to another workspace. A close while offline goes into ptyManager's pendingDestroys, is sent on `connected`, and is skipped by adopt until the server stops listing it; the misleading "Held" comment now says input is dropped, as the banner does. Deviation found while checking live: main's adopt answered `[]` when it could not tell (offline, offline rows, errors), which would have closed every server lane — it now answers null for "unknown" and the renderer keeps its lanes.

_Captured: 2026-11-11 · 7 file change(s)_

---

## T08 — Route panel calls by workspace id and follow the connected host

Added the pure serverRouting.routeOf(path, ctx, roots, locations) and serverPanels.resolve(path, ctx) (+ ctxOf): with a workspace id, main or a local workspace is local even when a server workspace has the same absolute path, and a server id routes there when the path lies in its folder; only calls without an id fall back to path matching (rootOf). Every routed handler (fileTree load/rename/trash/paste, fileEditor read/write, gitDiffManager review/diff, gitStatusManager watch, gitBranchesManager branches/switch) takes the ctx, and the renderer sends it: the file tree keeps the id of the workspace it shows (loadCheckout passes ws.id), files opened from it carry it into the editor's read and save, diffs and the review pass theirs, the branch panel and picker pass the selected workspace, and New Workspace / Run Task load main's branches. workspaceManager serves server rows only for the current host (lists, serverRoots, serverLocation, serverProjectFor, createOnServer) and drops another host's rows on `connected`; ptyManager forgets server terminals and queued closes when the host changes. Worktree list/create/delete calls carry the id now but are refused under a server root only in T09, as planned.

_Captured: 2026-11-11 · 21 file change(s)_

---

## T09 — Correlate file-tree replies and refuse unrouted mutations on server roots

FILE_TREE_DATA is now `{ root, files, error }` (the project-open path's bare array is still accepted): fileTreeUI drops a reply for any root other than the one it is waiting for, shows a server error as a note instead of an empty tree, and the new showNote() (used for the server-offline note) cannot be wiped by late replies or refreshes — only selecting the workspace again reloads it. Under a server root, CREATE/DELETE_GIT_BRANCH and ADD/REMOVE_GIT_WORKTREE are refused with serverPanels.READ_ONLY_GIT, LOAD_GIT_WORKTREES returns `[]` with a note, all routed by the caller's workspace id (path as fallback); the sessions panel says sessions are not listed for server workspaces instead of listing this machine's.

_Captured: 2026-11-11 · 7 file change(s)_

---

## T10 — Stop the server's watcher and poller when the last desktop leaves

src/server/index.js drops clients through one dropClient() and runs the new onLastClientGone hooks once the last desktop disconnects (close and error both counted once); start() wires it to every part's idle(). panels.setup returns idle(), which stops the git watcher and calls workspaceGitState.setWatched(null) — setWatched now accepts null and a watched() getter exists — so the server stops polling git and GitHub for nobody; the next git.watch / pr.refresh from a desktop starts them again. onConnection and onLastClientGone are exported for the test.

_Captured: 2026-11-11 · 4 file change(s)_

---

## T11 — Serve Frame Server on a Unix socket

Frame Server now listens on `~/.frame-server/server.sock` by default (home forced to 0700, socket created under umask 077 and chmod 0600), refuses to start when a live server answers on it and replaces a stale file; connection.json names `socket` instead of `port`. `--port N` still opts into TCP, and the server falls back to a random localhost port when the socket path would not fit sun_path. The desktop forwards a socket in a private 0700 temp folder with `-o StreamLocalBindUnlink=yes -L <local>:<remote socket>` (falling back to a local TCP port for long local paths), connects with `ws+unix:`, removes the folder on teardown, and maps sshd's "administratively prohibited" to a message naming `AllowStreamLocalForwarding`. PROTOCOL_VERSION is 2, so a new desktop meeting an old (TCP, protocol 1) server reaches needs-update; deviation: an old desktop meeting a new server fails earlier, at its connection.json check ("unreadable connection.json"), not at needs-update — it only affects desktops older than this change. The smoke script now runs the server as users do (socket) and checks the socket's mode; README covers the socket and the sshd setting.

_Captured: 2026-11-11 · 11 file change(s)_

---

## Findings — closing status

Every finding of spec.md is fixed; none was accepted unfixed. Two are fixed in code but verified only partly until CI and the field test run (marked below).

| Id | Status | Task | Note |
|---|---|---|---|
| S1 | fixed | T01 | SERVICE_USED without `$(…)`, json_escape |
| S2 | fixed — CI not yet run | T05 | manylinux_2_28 build, old-distro smoke, installer libc guard (tested) |
| S3 | fixed | T02 | quiesce, dangling links removed |
| S4 | fixed | T04 | unreachable resets preflight; probe checks a hand-run pid |
| S5 | fixed | T02 | previous only after success; any reinstalled copy restored |
| S6 | fixed | T01 | uses_systemd for the default home only |
| S7 | fixed | T01 | is_frame_pid in script and bin |
| S8 | fixed — real ssh not yet run | T11 | Unix socket, protocol 2; harness uses the ssh stand-in |
| S9 | fixed | T03 | unknown agents ask for consent |
| S10 | fixed | T02, T03 | script lock (exit 16); desktop busy before the first await |
| S11 | fixed | T04 | early lost handlers, hello timeout, close-before-hello rejection |
| S12 | fixed | T03 | serverConnectModel |
| T1 | fixed | T06 | requestId on create replies |
| T2 | fixed | T08 | host-aware rows; terminals forgotten on host switch |
| T3 | fixed | T07 | per-boot ids, adoptPlan pruning |
| T4 | fixed | T07 | pendingDestroys; comment corrected |
| T5 | fixed | T06 | orchestration lanes in main |
| T6 | fixed | T08 | routeOf by workspace id |
| T7 | fixed | T09 | tree replies with root and error; notes kept |
| T9 | fixed | T10 | idle hook stops watcher and poller |
| T10 | fixed | T09 | branch/worktree mutations refused; sessions note |
| C1 | fixed — CI not yet run | T01, T05 | script scenarios run in `npm test`; real-systemd job added |

Found and fixed along the way (not in the spec's list): serverInstaller's ssh crashed with an uncaught EPIPE when the remote `bash -s` exited before reading the whole script (T05); main's adopt answered "no terminals" when it could not tell, which would have closed every server lane (T07).

Field test, 2026-11-11 (after the spec closed): a from-source install on the user's Ubuntu 24.04 server (Node 22) built fine but Frame Server died at start — xterm-headless 5.3 takes `typeof navigator` as "not Node", and Node 21+ has a global `navigator`, so it touched `window` and threw. src/server/screenMirror.js now hides the global while xterm-headless and the serialize addon load and puts it back; test/screenMirrorNode22.test.js reproduces it on any Node by defining a navigator first. Packages bundle Node 20 and were not affected; the bug predates this spec. The failed install itself behaved as S3 intended: the version was removed, nothing left running or restarting. Followup: run `npm test` on Node 22 in CI as well.
