# Plan — Frame Server hardening

## Architecture

### Resolved plan-time decisions

The user asked for recommendations on the server side and accepted them on 2026-11-11 ("tamam specleri planlayalım", after the S8 token explanation).

Business:
- **B1 S8: what the server listens on.** A Unix socket at `~/.frame-server/server.sock` (an absolute path, socket 0600, directory 0700). SSH forwards to it with `-o StreamLocalBindUnlink=yes -L <local>:<remote socket>`. The token stays as a second layer.
  - Lowest priority, last step: on the user's single-user server the risk is theoretical.
  - Rejected: a random TCP port plus a server challenge, which needs more protocol and protects less.
- **B2 S2: package baseline.** Build node-pty in `manylinux_2_28` containers (AlmaLinux 8, glibc 2.28) for x64 and arm64, and smoke-test the package on `rockylinux:8`, `debian:11` and `ubuntu:20.04`.
  - The floor is glibc 2.28, because the bundled Node 20 itself needs 2.28. Amazon Linux 2 (2.26) cannot be supported, which corrects the spec.
  - The installer refuses older glibc and musl with the requirement named.
  - Rejected: keeping the runner build and falling back to compiling on the server, which needs a compiler on the server.
- **B3 T6: telling local from server workspaces.** Panel calls carry the workspace id and main routes by it. Path matching stays only as a fallback for calls with no workspace context. Rejected: making server paths distinct, which needs a layout change.
- **B4 T5: orchestration lanes.** They are always created locally in main (`workspaceId: 'main'`). Rejected: refusing to start orchestration, which needs new error UI.

Technical (silent):
- **Test posture** follows the spec's constraint, including the four kinds below. Every fix that can be reproduced gets a failing test first.
  1. **Pure tests** in `test/serverInstall.test.js` and `test/serverRouting.test.js`, plus a small `serverConnectModel` reducer.
  2. **Install-script scenario tests** in `test/installScript.test.js`. They run the real script against a temporary home, with tiny fake packages built at test time and logging stub `systemctl` / `loginctl` / `getconf` on `PATH`. They are fast, run on ubuntu and macOS in the existing `ci.yml`, and close C1.
  3. **A main-process connection harness** in `test/serverConnection.test.js`, with `test/fixtures/fake-ssh.js`. The fake ssh runs remote commands under a temporary `HOME` and proxies `-L`.
  4. **A real-systemd CI job:** ubuntu-24.04 with linger enabled for the runner and `XDG_RUNTIME_DIR` set, running the script tests with `FRAME_TEST_SYSTEMD=1`. If GitHub's runner cannot provide a user systemd session, the job reports that, and the systemd path is verified on the user's server in the field test (recorded in the outcome).
- **S1.**
  - `start_server` sets a global `SERVICE_USED` and is called without command substitution.
  - `result()` escapes backslashes, quotes and control characters, so the last line is always valid JSON.
  - Linger advice reaches the progress lines.
- **S3.** `quiesce()` disables and removes the unit (systemd) or stops the detached process when there is nothing to fall back to, including after a failed `--service-only`. With no previous version, the `current` and `bin/frame-server` links are removed too, so nothing points at a deleted version.
- **S5.**
  - Rollback repoints `previous` only after the health check passes.
  - Any existing `versions/<v>` being reinstalled is moved aside, and restored on failure, not only when it is the current version.
- **S6.** A single `uses_systemd()` predicate is true only when systemd user services are available and `--home` resolves to the default `~/.frame-server`. It is used by `start_server`, `stop_server`, `quiesce` and `bin/frame-server`'s `service_mode`.
- **S7.** `is_frame_pid <pid>` accepts a pid only when its command line (`/proc/<pid>/cmdline`, else `ps -o args=`) contains the install home. It is used by `running_pid`, `stop_server` and `bin/frame-server`.
- **S10.**
  - The script takes an atomic `mkdir` lock holding a pid. A live lock exits with new code 16 "another install is running"; a stale lock is taken over once. One `trap` on EXIT removes the stage and the lock.
  - The desktop sets `busy` before its first await, inside try/finally.
- **S9.** `runningAgents()` returns `null` when the list cannot be read. A pure `consentNeeded({ connected, agents, installed })` asks whenever agents is null or non-empty, or when not connected and something is installed.
- **S12.**
  - The Connect dialog clears progress and the check-up only when the status changes into `installing`.
  - Action buttons are disabled while an action is in flight.
  - The logic moves into a pure `src/renderer/serverConnectModel.js`.
- **S4.**
  - Every failure between reading `connection.json` and the hello is tagged `unreachable`, which resets `preflighted`; the next attempt probes the server and starts it.
  - The probe's `FRAME:MANUAL` branch checks the pid instead of assuming `running: true`.
- **S11.**
  - The `lost` handlers attach right after the socket is set, before the first ping.
  - `openSocket` rejects on close before hello and after a 10 s hello timeout.
- **T1.** The renderer sends a `requestId` with every `TERMINAL_CREATE`. Main echoes it in every `TERMINAL_CREATED` reply, local and server. The renderer ignores replies with another id, which also covers overlapping local creates (older than the server path).
- **T3.**
  - Server terminal ids gain a per-boot nonce (`srv-<boot>-<n>`); the `srv-` prefix rule is unchanged, so there is no protocol change.
  - After adopt, the renderer disposes `srv-` lanes of that project missing from the server's list, and recreates a lane whose workspace differs.
  - Main prunes its `serverTerminals` map the same way.
- **T4.**
  - A destroy while offline is queued in `pendingDestroys`, sent on `connected` before adopt, and adopt skips those ids.
  - Dropping input while offline matches the banner ("typing is paused"); only the misleading "Held" comment changes. This corrects the spec.
- **T2.** On connecting to a different host, `serverRows` and `serverTerminals` are cleared. `serverProjectFor`, `createOnServer` and `serverRoots` ignore entries of another host.
- **T6.**
  - `serverPanels.resolve(path, ctx)` routes by `ctx.workspaceId` first:
    - `main` or a local id: local, with no path match;
    - a server id: through `serverLocation`, with the path required to lie under its root;
    - no ctx: the old `rootOf`.
  - Every panel call gains the workspace id (renderer sources listed below), and positional channels take a trailing ctx. The rule is a pure `routeOf()` in `serverRouting`.
- **T7.**
  - `FILE_TREE_DATA` becomes `{ root, files, error }`; the renderer still accepts the bare array that `frameProject.js` sends.
  - `fileTreeUI` drops replies for another root and shows an error note instead of an empty tree.
- **T9.** When the last desktop disconnects, the server stops its git watcher and its PR poller (`setWatched(null)` allowed).
- **T10.**
  - Create/delete branch and the worktree list/add/remove handlers are refused under a server root, with the read-only message.
  - The worktree list returns `[]` with a note.
  - The sessions panel says sessions are not listed for server workspaces.
- **S8.**
  - The server's home directory is forced to 0700. It listens on `server.sock` with umask 077, and refuses to start if a live server already answers there.
  - `connection.json` gains `socket`.
  - The desktop forwards a local socket in a private temp directory, falling back to a local TCP port when the path is too long (macOS: 104 bytes), and connects with `ws+unix:`.
  - "administratively prohibited" (sshd `AllowStreamLocalForwarding no`) maps to a clear message.
  - The protocol number is bumped, so old desktops and old servers meet the existing `needs-update` path.
- **In-flight overlap.** `ptyManager.js`, `terminalManager.js`, `orchestrator.js` and `index.js` are also in the footprints of the stalled `audit-q3-*` specs. The changes here are local and additive.

### Panel calls and where the workspace id comes from (T6)

| Channel | Renderer call sites | Id source |
|---|---|---|
| `LOAD_FILE_TREE`, `WATCH_GIT_STATUS` | `fileTreeUI` load / refresh | the workspace being loaded (`loadCheckout(ws)`), else `state.getWorkspace().id` |
| `READ_FILE`, `WRITE_FILE` | `editor` | the id stored with the open file |
| `FILE_TREE_RENAME` / `TRASH` / `PASTE` | `fileTreeUI` | `state.getWorkspace().id` |
| `GET_GIT_DIFF` | `diffViewer`, `diffSection` | added to the diff ref by its opener |
| `REVIEW_FILES`, `REVIEW_FILE_DIFF` | `reviewSection` | `ref.workspaceId` (exists) |
| `LOAD_GIT_BRANCHES` / `WORKTREES`, `SWITCH` / `CREATE` / `DELETE_GIT_BRANCH`, `REMOVE_GIT_WORKTREE` | `githubPanel`, `statusBar/branchPicker` | current workspace; `newWorkspaceModal` and `taskRunModal` pass `main` |
| sessions list | `sessionsPanel` | current workspace |

### Data shapes

```
FRAME_INSTALL_RESULT {…}      always one line of valid JSON; new code 16 = another install is running
connection.json               { socket?, port?, token, protocol, frameVersion, pid }
TERMINAL_CREATE / CREATED     + requestId
FILE_TREE_DATA                { root, files, error? }   (bare array still accepted)
server terminal id            srv-<boot>-<n>
routeOf(path, ctx, roots, locations) → { remote: entry } | { local: true }
consentNeeded({ connected, agents|null, installed }) → boolean
```

## Files

- `scripts/install-frame-server.sh` — **Modified**: S1, S3, S5, S6, S7, S10 lock, glibc guard
- `src/server/bin/frame-server` — **Modified**: `uses_systemd` / `is_frame_pid` in `service_mode` and `running_pid`
- `test/installScript.test.js` — **New**: script scenarios against a temporary home with stub `systemctl` / `loginctl` / `getconf`; real-systemd variant under `FRAME_TEST_SYSTEMD=1`
- `test/fixtures/fake-frame-server/` — **New**: stub package template (good and bad `bin/frame-server`) and logging command stubs
- `src/shared/serverInstall.js` — **Modified**: exit code 16, `consentNeeded`
- `test/serverInstall.test.js` — **Modified**: tests for the above
- `src/main/serverInstaller.js` — **Modified**: `runningAgents` returns null on error; probe checks the pid of a hand-run server; socket-aware probe (S8)
- `src/main/serverConnection.js` — **Modified**: S4 unreachable reset, S10 busy, S11 listeners and hello timeout, consent via `consentNeeded`, S8 socket forwarding
- `src/renderer/serverConnectModel.js` — **New**: pure dialog state transitions (S12)
- `test/serverConnectModel.test.js` — **New**
- `src/renderer/serverConnect.js` — **Modified**: uses the model; general-consent wording
- `test/fixtures/fake-ssh.js` — **New**: ssh stand-in for tests
- `test/serverConnection.test.js` — **New**: harness tests (stale `connection.json`, close before hello, concurrent actions, host switch, offline destroy, overlapping creates)
- `.github/workflows/server-package.yml` — **Modified**: `manylinux_2_28` build containers, old-distro smoke matrix
- `.github/workflows/ci.yml` — **Modified**: real-systemd job for the install script
- `src/main/ptyManager.js` — **Modified**: echo `requestId`, `pendingDestroys`, prune `serverTerminals`, host switch
- `src/renderer/terminalManager.js` — **Modified**: `requestId` matching, prune and recreate on adopt
- `src/renderer/orchestrator.js` — **Modified**: `workspaceId: 'main'`
- `src/server/terminals.js` — **Modified**: per-boot id nonce
- `src/main/workspaceManager.js` — **Modified**: host-aware `serverRows`
- `src/shared/serverRouting.js` — **Modified**: `routeOf`, terminal-id helpers for the nonce, prune helper
- `test/serverRouting.test.js` — **Modified**
- `src/main/serverPanels.js` — **Modified**: `resolve(path, ctx)`
- `src/main/fileTree.js`, `src/main/fileEditor.js`, `src/main/gitDiffManager.js`, `src/main/gitStatusManager.js` — **Modified**: route by ctx; tree reply carries its root
- `src/main/gitBranchesManager.js` — **Modified**: route by ctx; refuse branch and worktree mutations under a server root
- `src/renderer/fileTreeUI.js`, `src/renderer/editor.js`, `src/renderer/diffSection.js`, `src/renderer/diffViewer.js`, `src/renderer/reviewSection.js`, `src/renderer/githubPanel.js`, `src/renderer/statusBar/branchPicker.js`, `src/renderer/sessionsPanel.js`, `src/renderer/newWorkspaceModal.js`, `src/renderer/taskRunModal.js`, `src/renderer/index.js` — **Modified**: send the workspace id; tree reply handling
- `src/server/index.js` — **Modified**: client-gone hook (T9); Unix socket listen (S8)
- `src/server/panels.js`, `src/main/workspaceGitState.js` — **Modified**: stop watcher and poller when idle (T9)
- `src/shared/serverProtocol.js`, `test/serverProtocol.test.js` — **Modified**: protocol bump (S8)
- `src/server/README.md` — **Modified**: glibc floor, socket, `AllowStreamLocalForwarding`

## Footprint

- scripts/install-frame-server.sh
- src/server/**
- test/installScript.test.js
- test/fixtures/fake-frame-server/**
- test/fixtures/fake-ssh.js
- src/shared/serverInstall.js
- test/serverInstall.test.js
- src/main/serverInstaller.js
- src/main/serverConnection.js
- src/renderer/serverConnectModel.js
- test/serverConnectModel.test.js
- src/renderer/serverConnect.js
- test/serverConnection.test.js
- .github/workflows/server-package.yml
- .github/workflows/ci.yml
- src/main/ptyManager.js
- src/renderer/terminalManager.js
- src/renderer/orchestrator.js
- src/main/workspaceManager.js
- src/shared/serverRouting.js
- test/serverRouting.test.js
- src/main/serverPanels.js
- src/main/fileTree.js
- src/main/fileEditor.js
- src/main/gitDiffManager.js
- src/main/gitStatusManager.js
- src/main/gitBranchesManager.js
- src/renderer/fileTreeUI.js
- src/renderer/editor.js
- src/renderer/diffSection.js
- src/renderer/diffViewer.js
- src/renderer/reviewSection.js
- src/renderer/githubPanel.js
- src/renderer/statusBar/branchPicker.js
- src/renderer/sessionsPanel.js
- src/renderer/newWorkspaceModal.js
- src/renderer/taskRunModal.js
- src/renderer/index.js
- src/main/workspaceGitState.js
- src/shared/serverProtocol.js
- test/serverProtocol.test.js

## Dependencies

None added. The CI containers (`quay.io/pypa/manylinux_2_28_*`, `rockylinux:8`, `debian:11`, `ubuntu:20.04`) are workflow images, not package dependencies.

## Sequencing

1. **Script test harness; S1, S6, S7.**
   - Add `test/installScript.test.js` and its fixtures.
   - Fix S1 (`SERVICE_USED` without command substitution; `result()` escaping), S6 (`uses_systemd`) and S7 (`is_frame_pid`) in the script and `bin/frame-server`. Each fix is preceded by its failing scenario.
2. **S3, S5, S10 (script).**
   - `quiesce` after an unrecoverable failure, removing dangling links.
   - Rollback repoints `previous` only on success; reinstalled versions are moved aside and restored.
   - The `mkdir` lock with exit code 16 in `serverInstall.js`.
   - All with scenarios.
3. **S9, S10 (desktop), S12.**
   - `runningAgents` returns null on error; `consentNeeded` in `serverInstall.js`.
   - `busy` is set before the first await.
   - `serverConnectModel.js` and the dialog wired to it.
   - Pure tests, plus a harness test for concurrent actions.
4. **S4, S11.**
   - The unreachable reset and the pid-checked probe.
   - Listeners attached before the first ping; the hello timeout and close-before-hello rejection.
   - `test/fixtures/fake-ssh.js` and `test/serverConnection.test.js` scenarios: stale `connection.json` leads to a start and a connect; close before hello leads to a retry.
5. **S2 and the real-systemd job (C1).**
   - `manylinux_2_28` build containers and the old-distro smoke matrix in `server-package.yml`.
   - The installer's glibc/musl guard, with a fake `getconf` scenario.
   - The real-systemd job in `ci.yml`.
   - Correct the README's supported distributions.
6. **T1, T5, T3, T4: terminals.**
   - `requestId` on create, echoed by every reply.
   - Orchestration lanes are local.
   - Per-boot server ids; prune and recreate on adopt in the renderer and main.
   - Queued offline destroys.
   - Pure tests for the id and prune helpers; harness tests for overlapping creates and offline destroy.
7. **T2, T6, T7, T10: routing.**
   - Host-aware caches.
   - `routeOf` and `serverPanels.resolve` with the workspace id from every panel call site (table above).
   - Tree replies carry their root and errors.
   - Branch and worktree mutations refused under a server root; the sessions-panel note.
   - Pure routing tests and a harness test for a host switch.
8. **T9.** The server stops its watcher and poller when the last desktop leaves; tested through an exported client-gone hook.
9. **S8 (last, lowest priority).**
   - Unix socket listen, 0700 home, live-server check.
   - Socket forwarding with the TCP fallback for long local paths.
   - The "administratively prohibited" message; protocol bump.
   - A harness test with the fake ssh forwarding a socket; README.
