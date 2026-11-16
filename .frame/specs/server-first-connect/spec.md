---
keywords: frame server, first connect, ssh, host key, ssh key, servers dialog, onboarding, error messages
related: server-workspaces, server-install-update, server-hardening, server-onboarding, multi-server-connections
---

# Server first connect

## Problem

Adding the first server in the Servers dialog is not clear. The user and a teammate could not tell how to connect. The dialog asks for "myserver or me@host" and connects at once. It does not say what must already be true for that to work:

- **An SSH key login must already work.** Frame runs `ssh` in `BatchMode`, so it never asks for a password. A server that only takes a password fails with ssh's raw last line: `ssh me@…: Permission denied (publickey,password).`
- **The host key of a server never connected to before has not been accepted.** In `BatchMode`, ssh cannot ask "Are you sure you want to continue connecting?", so the first connect fails with `Host key verification failed.` This is read from the code and ssh's behaviour, not yet seen live.
- **What goes in the box is unclear.** An IP, `user@ip` and a `~/.ssh/config` alias all work. The aliases appear only as datalist suggestions.
- **The steps are not shown.** Connect, then install Frame Server, then the check-up: each step appears only when it is reached.

Each of these sends a first-time user to a terminal and to search results. A first-time user cannot be expected to know them.

## Goal

The Servers dialog takes a first-time user from nothing to a connected server, without leaving Frame or guessing:

1. **Before adding.** A short "Before you start" note in the dialog's empty state. It says what is needed: a Linux or macOS machine reachable over SSH, with a key login. It says what to type: an SSH alias from `~/.ssh/config`, or `user@host`. It shows how to set up a key with `ssh-copy-id`.
2. **Plain errors with a next step.** The common first-connect failures of `ssh` are recognised and replaced with a sentence and one action:
   - **Unknown host key.** Explain it, and offer a step where the user accepts the server's fingerprint.
   - **Key refused or password only.** Explain it, and offer `ssh-copy-id <host>` to run in a Frame terminal on this Mac. The user types the password into ssh itself.
   - **Host not found** (DNS or alias), **unreachable or timed out**, **connection refused**: say which one it is.
   - **Anything else:** ssh's own last line, as today.
3. **The steps in view.** A three-step indicator for the selected server: Connect → Install Frame Server → Check-up. It shows where the server stands and what comes next.

## Constraints

- **The SSH model does not change** (server-workspaces, server-hardening, multi-server-connections). Access is only the user's own `ssh` and their keys, agent and `~/.ssh/config`. Frame keeps `BatchMode`, and it never stores, reads or types a password or passphrase.
- **Any step that needs a password or a yes/no prompt runs in a terminal the user drives.** That is a Frame terminal on this Mac. Frame only types the command in and waits for the user; it never sends the password or the answer.
- **A host key is never trusted silently.** Accepting one shows its fingerprint first and needs the user's explicit action.
- **No new dependency.** Error recognition is a pure rule in `src/shared`, tested on real ssh stderr samples. Connection tests use the existing harnesses (`test/serverConnection.test.js` with `test/fixtures/fake-ssh.js`).
- **Both entry points open the same dialog:** "Connect a server" in the workspace menu and "Add server" in the status bar. Already-connected servers behave as today.
- **No server address, user name or local path** goes into fixtures, commits or PR text. Samples use placeholders.

## Success Criteria

- When the dialog opens with no saved server, then the "Before you start" note is shown with the requirements, what to type and the `ssh-copy-id` command. Once a server is saved, the note is out of the way.
- When the first connect fails with `Host key verification failed`, then the dialog says the server is new to this Mac and offers to accept its key.
- When the user accepts a new host's key, then they have seen the fingerprint before it is trusted, and the next Connect gets past the host-key step.
- When ssh reports `Permission denied (publickey…)`, then the dialog says a key login is needed and offers `ssh-copy-id <host>`. Running it opens a Frame terminal on this Mac with the command typed in, and Frame never sees the password. After it succeeds, Connect works.
- When the host cannot be resolved, cannot be reached, refuses the connection or times out, then the message names that case in plain words.
- When an ssh failure matches none of the known cases, then ssh's last line is shown as today.
- When a server is selected, then the three-step indicator shows the step it is on: connecting or failed, Frame Server missing or installing, check-up running or done.
- When a saved server reconnects on launch, then nothing about this flow gets in its way.

## Out of Scope

- Password or passphrase handling inside Frame.
- Creating users or SSH keys on the server for the user. The note and `ssh-copy-id` are the help offered.
- Changing the installer or the check-up themselves (server-install-update, server-onboarding).
- A wizard outside the Servers dialog.

## Open Questions

- **How is a new host key accepted?**
  - (a) Frame runs `ssh-keyscan`, shows the fingerprint in the dialog, and on "Trust" adds it to `~/.ssh/known_hosts`. This is all in the dialog, but Frame writes to the user's ssh file.
  - (b) Frame opens a terminal on this Mac with `ssh <host> exit` typed in; the user answers ssh's own yes/no prompt. Frame writes nothing, but the user leaves the dialog.
- **Where does `ssh-copy-id` run when the Mac has no SSH key yet?**
  - (a) The terminal command also creates one first (`ssh-keygen` when `~/.ssh/id_ed25519` is missing), and the note says so.
  - (b) Only `ssh-copy-id`; a missing key is reported, and the note shows `ssh-keygen` as a separate step.
