---
keywords: frame server, install, update, rollback, release, prebuilt, node-pty, ssh bootstrap, systemd
related: server-workspaces, server-workspace-panels, in-app-auto-update
---

# Install and update Frame Server from the desktop

## Problem

Installing Frame Server is manual today (`src/server/README.md`), and that is the biggest obstacle to self-hosting:

- The user copies the code to the server.
- They install a matching Node.
- They install build tools so that `node-pty` compiles. This is the step most likely to fail, and it is still unverified on Linux.
- They run `npm ci`, write a systemd unit and enable linger.

Updating is the same work again. The desktop and the server must also speak the same protocol, and nothing keeps them in step.

The 2026-11-09 decision chose the VS Code Remote-SSH model: Connect checks the server's version over SSH, installs it when missing, and offers to update it when older. Versions sit side by side so a rollback is a repoint. Node is bundled. Docker was weighed and rejected for packaging Frame Server itself on 2026-11-10: agents must run in the user's real server environment, with their toolchain, logins and keys, under their own user rather than root or the docker group.

## Goal

- **Prebuilt server packages.** Every Frame release also publishes a Frame Server package per platform (at least linux-x64 and linux-arm64) to GitHub Releases, with checksums. Each package holds a Node runtime, the server code and a `node-pty` already built for that runtime. Nothing is compiled on the server.
- **Install on Connect.** When the user connects to a host where Frame Server is missing, Frame installs it there over the user's SSH:
  - detect the platform;
  - get the matching package and verify its checksum;
  - unpack it under `~/.frame-server/versions/<version>` and point `current` at it;
  - set up a user-level service that survives logout;
  - start it and connect.

  The user only names the host.
- **Update with consent.** When the server runs an older version (or a different protocol) than the desktop, Frame offers to update it. If agents are running in server workspaces, Frame names them and lets the user update now or later. It never restarts the server without asking. The new version installs next to the old one, and a failed start rolls back automatically.
- **Rollback.** The user can return the server to the previous installed version from the desktop.
- **Server check-up.** After connecting, Frame shows what the server can do and what is missing: agent CLIs (Claude Code, Codex) installed and signed in, `gh` signed in, git access. Each missing item comes with the command to fix it.
- **Without the desktop.** A one-line install script and a `frame-server` command (`status`, `update`, `rollback`, `logs`) install and manage the same layout from a shell.

## Constraints

- **No root, no Docker.** Everything installs under the user's home and runs as the user (2026-11-09 security decision; Docker rejected 2026-11-10). Where linger needs privileges the user does not have, Frame says what to run instead of failing silently.
- **The user's SSH only.** Frame stores no SSH secrets (`server-workspaces`). Every step is a command over the user's `ssh`, and the server listens only on localhost as before.
- **Integrity.** A package is used only after its checksum matches the release's published checksum. A failed or partial download never replaces a working version.
- **Running agents are never killed without consent.** User, 2026-11-09: "çalışan bir agent ı güncelleme yaparak öldürmeyiz yani."
- **One version, one protocol.** The desktop installs exactly its own version. The hello's protocol check stays the gate, and mismatch messages lead to the update offer.
- **Releases stay one source of truth.** Server packages are built and published by the same release process as the desktop (GitHub Releases, `in-app-auto-update`). They are not a second channel.
- **The manual install keeps working.** A server installed by hand from the README is recognized, and can be replaced by a managed install.
- **CI stays green.** The repo's CI runs `npm test` without installing dependencies on purpose. The server-side tests added by `server-workspaces` (`screenMirror` needs `xterm-headless`) must run in CI, either by installing dependencies without scripts or by skipping them when the dependency is absent.

## Success Criteria

- When a release is published, then GitHub Releases has a Frame Server package and checksum for linux-x64 and linux-arm64, and each package starts on a clean machine of that platform with no compiler or system Node installed.
- When the user connects to a host without Frame Server, then Frame installs the desktop's version over SSH, starts it as a user-level service, connects, and the server keeps running after the user logs out of the server.
- When the downloaded package's checksum does not match, then nothing is installed, the existing version (if any) keeps running, and the user sees why.
- When the server runs an older version, then Frame offers the update. With agents running it names them and offers now or later. After updating, the new version runs, the previous one stays installed, and the desktop reconnects.
- When a new version fails to start, then the previous version is started again and the user is told.
- When the user chooses Roll back, then the previous installed version runs again and the desktop reconnects.
- When the check-up runs after connecting, then it reports each agent CLI, `gh` and git access as ready or missing, with the command to fix each missing one.
- When a user runs the install script on a server without the desktop, then the same layout is installed and `frame-server status|update|rollback|logs` work.
- When CI runs on a pull request, then `npm test` passes, including the server tests.
- When `npm test` runs, then existing tests pass and the new pure logic (platform mapping, version and protocol comparison, checksum handling, install plan, check-up parsing) has unit tests.

## Out of Scope

- Running workspaces in containers or sandboxes (blast-radius isolation)
- Windows servers
- Updating the server without asking, or on a schedule
- Installing agent CLIs or signing them in on the user's behalf (the check-up only tells the user what to run)
- Multi-user servers, OIDC, licences
- Copying gitignored files (`copyFiles`) and file sync

## Open Questions

- **Where the server gets the package.** Options:
  - (a) The server downloads it from GitHub Releases (curl or wget), and the desktop uploads it over SSH when the server cannot reach GitHub.
  - (b) The desktop always uploads it.
- **Unreleased desktop builds** (running from source, as during development). Options:
  - (a) Frame builds a server package locally for the target platform and uploads it.
  - (b) Only released versions can be installed. Development uses the manual install.
- **Service manager.** Options:
  - (a) A systemd user unit with linger, falling back to a detached process that Connect restarts when it finds it stopped.
  - (b) systemd only, with a clear message where it is not available.
- **How update consent works with running agents.** Options:
  - (a) Name the running agents and offer "Update now" (their terminals end and the CLIs' own resume restores sessions) or "Later".
  - (b) Refuse while agents run.
