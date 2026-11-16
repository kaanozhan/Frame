# Plan — Server first connect

## Architecture

### Resolved plan-time decisions

- **B1 How a new host key is accepted:** in a terminal on this Mac that the user drives. Frame types `ssh-copy-id <host>` (no Enter); ssh shows the fingerprint and asks yes/no itself, then asks for the password. Rejected: `ssh-keyscan` plus a "Trust" button that writes `~/.ssh/known_hosts`. That would make Frame a writer of the user's ssh files, and a brand-new server needs the terminal for the password anyway, so one step covers both.
- **B2 No SSH key on the Mac:** the typed command creates one first. It runs `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519` only when none of `~/.ssh/id_ed25519.pub`, `id_ecdsa.pub` and `id_rsa.pub` exists, then `ssh-copy-id`. The shell does the existence check, so Frame reads nothing in `~/.ssh`. The note says a key with a passphrase must be in the agent or Keychain (`ssh-add --apple-use-keychain`), or `BatchMode` cannot use it. Rejected: reporting the missing key and making `ssh-keygen` a separate step, which is one more step for the same result.
- **B3 Retry on access errors:** for an unknown host key or a refused login, the connect loop stops and the server shows "Needs your action". Connect starts it again. Unreachable, refused, timed-out and unresolved hosts keep today's backoff (`BACKOFF_MS`), because they can fix themselves. Rejected: retrying every error, which reruns ssh every 30 s for an error only the user can fix and keeps saying "retrying".
- **B4 A changed host key** (silent, security): it is recognised separately from an unknown one (`REMOTE HOST IDENTIFICATION HAS CHANGED`). The dialog says the server's identity changed and that this can mean an attack or a reinstalled server, and it offers no action. It never offers to accept the key or to remove the old one. It is a needs-user error (no retry).
- **B5 Where errors are recognised** (silent): a new pure module, `src/shared/sshErrors.js`, keyed on ssh's own stderr and only when ssh itself failed (exit 255). A remote command's failure is never misread as an ssh error. Unknown text falls back to ssh's last line, as today.
- **B6 The step indicator** (silent): a pure `steps(status, doctor)` in `serverConnectModel`, so the rule is tested without a DOM.
- **B7 The local terminal** (silent): `terminalManager.createLocalCommandTerminal({ command, name })`. It mirrors `createServerHomeTerminal`: the command is typed once the shell prints, never with Enter. The cwd is the user's home folder, and the terminal is shown in the current view. The dialog closes to give the terminal the screen, as `openServerTerminal` does.
- **B8 Tests** (gate): everything testable. The pure rules (`sshErrors`, `steps`) with real ssh stderr samples, and the stop-retry behaviour in `test/serverConnection.test.js` through the fake ssh. The dialog itself is checked live, since the project has no DOM harness.

### How it fits

```
ssh fails (exit 255, stderr)
  └─ serverInstaller.probe → { error, sshKind }          (sshErrors.classify)
       └─ decide → { action:'error', reason, sshKind }
            └─ serverLink.preflight throws Error{ sshKind }
                 └─ loop catch:
                      needsUser(kind) → status { state:'error', error, errorKind, waiting:true }, no retry
                      else            → today's scheduleRetry
renderer (serverConnect)
  status.errorKind → sshErrors.describe(kind, host) → { message, action:'setup'|null }
  action 'setup'   → terminalManager.createLocalCommandTerminal({ command: sshErrors.setupCommand(host) })
  model.steps(status, doctor) → [connect, install, checkup] each 'done'|'active'|'failed'|'todo'
```

**`src/shared/sshErrors.js`**:
- `classify(stderr, code)` returns one of `'host-unknown' | 'host-changed' | 'auth' | 'no-resolve' | 'refused' | 'timeout' | 'unreachable' | null`, and `null` unless `code === 255`. It matches these:
  - `REMOTE HOST IDENTIFICATION HAS CHANGED` → `'host-changed'` (checked before host-unknown);
  - `Host key verification failed` / `No … host key is known` → `'host-unknown'`;
  - `Permission denied (` → `'auth'`;
  - `Could not resolve hostname` → `'no-resolve'`;
  - `Connection refused` → `'refused'`;
  - `timed out` → `'timeout'`;
  - `No route to host` / `Network is unreachable` → `'unreachable'`.
- `needsUser(kind)` is true for `'host-unknown' | 'host-changed' | 'auth'`.
- `describe(kind, host, fallback)` returns `{ message, action }`: one plain sentence per kind, with `action: 'setup'` for host-unknown and auth, and `null` otherwise. An unknown kind returns the fallback (ssh's last line).
- `setupCommand(host)` is the line typed into the terminal. The host is single-quoted, and `serverList.normalizeHost` already refuses whitespace and a leading `-`.

**Status shape:** the link's status gains `errorKind` (null by default). `waiting` is derived as `needsUser(errorKind)`, not stored.

**Dialog** (`index.html` + `serverConnect.js`):
- The empty state (`#sc-empty`) becomes "Before you start":
  - requirements: a Linux or macOS machine you can `ssh` into with a key;
  - what to type: an alias from `~/.ssh/config`, or `user@host`;
  - the setup command, with a Copy button;
  - the passphrase note.
- Under `#sc-error`, a `#sc-error-action` button appears when `describe` returns `'setup'`: "Set up access in a terminal".
- `#sc-steps` shows the three steps above the status line. The status label for a waiting error reads "Needs your action" instead of "Could not connect — retrying".

## Files

- `src/shared/sshErrors.js` — **New**: classify ssh failures, the user-facing sentence and action per kind, and the setup command.
- `src/main/serverInstaller.js` — **Modified**: `probe` and `decide` carry `sshKind` from `sshErrors.classify` with ssh's stderr and exit code.
- `src/main/serverLink.js` — **Modified**: `errorKind` in the status; no retry for `needsUser` kinds; the tunnel's stderr is classified too.
- `src/main/serverConnection.js` — **Modified**: `errorKind: null` in the `OFF` status shape.
- `src/renderer/serverConnectModel.js` — **Modified**: `steps(status, doctor)`.
- `src/renderer/serverConnect.js` — **Modified**: the "Before you start" note, the error sentence and its action, the step indicator, and the "Needs your action" label.
- `src/renderer/terminalManager.js` — **Modified**: `createLocalCommandTerminal({ command, name })`.
- `index.html` — **Modified**: the Servers dialog markup: the note, `#sc-steps` and `#sc-error-action`.
- `src/renderer/styles/components/workspaces.css` — **Modified**: styles for the note, the steps and the action (the `sc-*` rules live here).
- `test/sshErrors.test.js` — **New**: classify, describe and setupCommand against real ssh stderr samples, with placeholder hosts.
- `test/serverConnectModel.test.js` — **Modified**: `steps` for each status and check-up state.
- `test/fixtures/fake-ssh.js` — **Modified**: placeholder hosts that fail like ssh does: `newhost` (host key unknown), `changedhost`, `deniedhost`.
- `test/serverConnection.test.js` — **Modified**: an access error stops the loop with `errorKind` and Connect restarts it; an unreachable host keeps retrying.

## Footprint

- src/shared/sshErrors.js
- src/main/serverInstaller.js
- src/main/serverLink.js
- src/main/serverConnection.js
- src/renderer/serverConnectModel.js
- src/renderer/serverConnect.js
- src/renderer/terminalManager.js
- index.html
- src/renderer/styles/components/workspaces.css
- test/sshErrors.test.js
- test/serverConnectModel.test.js
- test/fixtures/fake-ssh.js
- test/serverConnection.test.js

## Dependencies

None. `ssh-copy-id` and `ssh-keygen` ship with macOS's OpenSSH and run in the user's own terminal.

## Sequencing

1. **Recognise ssh failures.** Add `src/shared/sshErrors.js` (`classify`, `needsUser`, `describe`, `setupCommand`) with `test/sshErrors.test.js`:
   - real stderr samples for every kind, with placeholder hosts;
   - host-changed winning over host-unknown;
   - exit codes other than 255 returning null;
   - the quoted setup command.
2. **Carry the kind and stop retrying on access errors.**
   - `serverInstaller.probe` and `decide` pass `sshKind`.
   - `serverLink` puts `errorKind` in the status and skips `scheduleRetry` when `needsUser`; tunnel errors are classified the same way.
   - `serverConnection`'s `OFF` gains `errorKind: null`.
   - Tests: `fake-ssh.js` gets the three failing hosts, and `test/serverConnection.test.js` covers an access error that waits with its kind (no second ssh run), Connect running it again, and `nohost` still retrying.
3. **The step indicator rule.** Add `steps(status, doctor)` to `serverConnectModel`, with cases in `test/serverConnectModel.test.js`: connecting, waiting error, retrying error, needs-install, installing, connected with the check-up loading, clean and with items missing.
4. **A terminal on this Mac with a typed command.** Add `terminalManager.createLocalCommandTerminal({ command, name })`, typed after the first output and never with Enter, with its cwd at home.
5. **The dialog.**
   - `index.html`, `serverConnect.js` and `workspaces.css`: the "Before you start" note with Copy; the error sentence from `describe`, with "Set up access in a terminal" opening the step 4 terminal (the dialog closes);
   - "Needs your action" for a waiting error;
   - `#sc-steps` drawn from `steps`.
   - Live check in an isolated app (`--user-data-dir` and HOME) with the fake ssh, for the empty state, `newhost`, `deniedhost`, `changedhost` and `nohost`.
