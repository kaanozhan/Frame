
## T01 — Recognise ssh failures (sshErrors)

Added `src/shared/sshErrors.js`: `classify(stderr, code)` maps OpenSSH's own stderr to host-unknown / host-changed / auth / no-resolve / refused / timeout / unreachable, only on exit 255, with host-changed checked before host-unknown; `needsUser`, `describe` (one sentence per kind, `setup` action for host-unknown and auth only) and `setupCommand` (ssh-keygen only when no `~/.ssh/id_*.pub`, then `ssh-copy-id` with the host single-quoted). `test/sshErrors.test.js` covers real stderr samples with placeholder hosts, the exit-code guard, the fallback and the quoting through a real `sh`.

_Captured: 2026-11-16 · 2 file change(s)_

---

## T02 — Carry the ssh failure kind into the link status

`serverInstaller.probe`/`decide` return `sshKind` from `sshErrors.classify`; `serverLink` attaches it to the probe, connection.json read and tunnel errors and puts `errorKind` in the status (cleared on connecting, connected, needs-install, disconnect and a failed install), and `serverConnection`'s `OFF` gains `errorKind: null`. `readConnectionInfo`'s own ssh-error regex was replaced by the shared classifier (same message text). `test/fixtures/fake-ssh.js` gained `newhost`, `changedhost` and `deniedhost` failures plus an optional `FAKE_SSH_LOG`; the new test in `test/serverConnection.test.js` was red on the previous commit.

_Captured: 2026-11-16 · 5 file change(s)_

---

## T03 — Stop the connect loop on access errors

In `serverLink`'s loop, an error whose kind `sshErrors.needsUser` accepts (host-unknown, host-changed, auth) now sets `state: 'error'` with its `errorKind` and returns without `scheduleRetry`; Connect starts a fresh session as before, and every other error keeps `BACKOFF_MS`. The new test in `test/serverConnection.test.js` counts ssh runs through `FAKE_SSH_LOG`: `deniedhost` runs once and waits, Connect runs it again, `nohost` keeps retrying; it was red on the previous commit.

_Captured: 2026-11-16 · 2 file change(s)_

---

## T04 — The step indicator rule

Added `steps(status, doctor)` to `src/renderer/serverConnectModel.js`: Connect / Install Frame Server / Check-up, each done / active / failed / todo. A failed install is told apart from a failed connect by an `error` without `errorKind` whose probe asked for an install (`install.action !== 'none'`); a connected server's check-up is active while loading and failed when it errors or any item is not ok. The cases in `test/serverConnectModel.test.js` were red on the previous commit.

_Captured: 2026-11-16 · 2 file change(s)_

---

## T05 — A terminal on this Mac with a typed command

Added `createLocalCommandTerminal({ command, name })` to `src/renderer/terminalManager.js`: a local terminal in the home folder, renamed when asked, with the command typed after the shell's first output and never with Enter; while a server workspace is selected it opens under main, because that workspace's terminals are routed to the server. The typing that `createServerHomeTerminal` did inline moved to a shared `_typeWhenReady`, unchanged. Live-checked in an isolated app: the command was typed in `~` and not run.

_Captured: 2026-11-16 · 1 file change(s)_

---

## T06 — Before you start note in the Servers dialog

Turned the Servers dialog's empty state (`#sc-empty` in `index.html`) into "Before you start": what Frame needs (a machine reachable with ssh, key login, never a password), what to type (a `~/.ssh/config` Host or `user@address`), the setup command from `sshErrors.setupCommand('user@host')` with Copy (wired in `serverConnect.js`), and the passphrase note (`ssh-add --apple-use-keychain`); styles in `workspaces.css` reuse the check-up's `.sc-fix` code row. The note is shown only while no server is saved, as the old empty state was. Live-checked in an isolated app.

_Captured: 2026-11-16 · 3 file change(s)_

---
