---
keywords: frame server, first connect, ssh, host key, ssh key, servers dialog, onboarding, error messages
related: server-workspaces, server-install-update, server-hardening, server-onboarding, multi-server-connections
---
The Servers dialog now takes a first-time user to a connected server. `src/shared/sshErrors.js` classifies ssh's own failures (exit 255 only) into host-unknown / host-changed / auth / no-resolve / refused / timeout / unreachable. It gives a plain sentence per kind and a setup command: `ssh-keygen` only when no `~/.ssh/id_*.pub` exists, then `ssh-copy-id '<host>'`.
- **Error kind:** carried as `errorKind` in each server link's status (`serverInstaller` probe/decide, `serverLink` connection.json read and tunnel).
- **Waiting:** host-unknown, host-changed and auth stop the connect loop ("Needs your action") until Connect is pressed; network errors keep `BACKOFF_MS`.
- **Setup step:** "Set up access in a terminal" opens a Mac terminal (`terminalManager.createLocalCommandTerminal`) with the command typed but not run. ssh itself shows the fingerprint and asks for the password, so Frame never sees either and writes nothing in `~/.ssh`.
- **Changed host key:** treated as a possible attack; it gets a warning and no action.
- **Dialog:** a "Before you start" note when no server is saved, and a Connect → Install Frame Server → Check-up indicator from the pure `serverConnectModel.steps`.
- **Rejected:** `ssh-keyscan` plus a Trust button that writes `known_hosts` (Frame would write the user's ssh files); retrying every error (reran ssh every 30 s for errors only the user can fix).
- **Rules:**
  - Recognise ssh failures only through `sshErrors`.
  - Never offer to accept a changed host key.
  - Any prompt (a host key, a password) runs in a terminal the user drives.
  - A CSS `display` rule on an element toggled with `hidden` must be written as `:not([hidden])` (bug found in T07).

Chain: spec.md → plan.md → tasks.md → outcome.md
