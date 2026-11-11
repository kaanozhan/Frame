
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
