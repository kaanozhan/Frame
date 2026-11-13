---
keywords: frame server, hardening, install script, systemd, reconnect, consent, unix socket, terminals, routing
related: server-workspaces, server-workspace-panels, server-install-update, workspace-hardening
---
Frame Server's install, connection, terminals and panel routing now hold on a real Linux host, with tests that run the paths that had only been read.

**Installer.** The result line is always valid JSON; a run touches only its own home and only pids running from it; a failure with nothing to fall back to leaves no unit enabled and no dangling link; rollback keeps its target; one installer per home (exit 16); glibc < 2.28 and musl are refused by name. `test/installScript.test.js` runs the real script with stub `systemctl`/`loginctl` (and a real-systemd CI job).
**Packages.** Built in manylinux_2_28 (glibc 2.28, the Node 20 floor) and booted plus installed on Rocky 8, Debian 11, Ubuntu 20.04. Rejected: compiling on the server as a fallback.
**Connection.** A dead server leaving connection.json is probed and restarted; a socket closing before hello is retried; unknown running agents ask for consent; one action at a time. Frame Server listens on `~/.frame-server/server.sock` (0700/0600), forwarded with `ssh -L` (protocol 2). Rejected: random port plus a challenge.
**Terminals and panels.** Create replies carry a request id; server ids carry a per-boot nonce and dead lanes are pruned on adopt; offline closes are sent on reconnect; orchestration stays local. Panel calls route by workspace id (path only without one); caches follow the connected host; tree replies name their root; server roots refuse branch/worktree changes; the server idles when no desktop is left.
**Rules for future work.** New panel IPC carries `{ workspaceId }` and routes through `serverPanels.resolve`. "Cannot tell" is never "none" (agents, adopted terminals). Never call a function that prints progress inside `$(…)` in the install script. Extend `test/serverConnection.test.js` (fake ssh + protocol-speaking fake server) for connection changes.
**Gaps.** The CI workflows and a real OpenSSH socket forward have not run yet; an old desktop meeting a new server reports "unreadable connection.json" rather than needs-update.

Chain: spec.md → plan.md → tasks.md → outcome.md
