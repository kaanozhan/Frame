# Plan — Install and update Frame Server from the desktop

## Architecture

### Resolved plan-time decisions

The user accepted every recommendation at the gate ("önerilerle ilerleyelim").

Business:
- **B1 Where the package comes from.** The server downloads the release package from GitHub Releases and verifies its checksum. If the server cannot reach GitHub, the desktop downloads the same asset over HTTPS and streams it to the server over SSH. Rejected: always uploading from the desktop, which sends every install through the user's own connection.
- **B2 Unreleased desktop builds.** A desktop running from source (`app.isPackaged === false`, as during development) installs **from source on the server**:
  - it streams `git archive HEAD` over SSH;
  - the install script builds it there (`npm ci --omit=dev --ignore-scripts`, `npm rebuild node-pty`) with the server's Node;
  - the version is recorded as `<version>-dev+<short sha>`.

  If build tools or Node ≥ 18 are missing, the script stops and names the command to run. This automates today's manual field test. Rejected: released versions only, because Mac cannot build Linux `node-pty` without Docker, and development would stay manual.
- **B3 Service manager.**
  - The default is a systemd user unit, with linger enabled when `loginctl enable-linger` is allowed.
  - Where systemd user services are unavailable, the script starts a detached process (`setsid`, logs to `~/.frame-server/server.log`), and Connect restarts it when it finds it stopped.
  - The check-up reports which mode is in use and, without linger, what to run as root.

  Rejected: systemd only.
- **B4 Update consent with running agents.** Before an update or rollback, the desktop lists the server's live terminals with an agent (from `terminals.list` process info) and offers "Update now" (their terminals end; the CLIs' own resume brings sessions back) or "Later". It never restarts without that click. Rejected: refusing while agents run.

Technical:
- **T1 Verify packages in CI.** A new workflow builds the package and smoke-boots it on `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64):
  1. start the server with a temporary home;
  2. connect with the token;
  3. open a terminal, echo through it and close it.

  It runs on pull requests that touch the server, and on every published release, where it also uploads the assets. This settles node-pty on Linux for good. Rejected: verifying on release only.
- **T2 Test posture.** Pure logic only, in `src/shared/serverInstall.js`:
  - platform → asset;
  - version and protocol comparison;
  - the checksum file;
  - the install decision;
  - the systemd unit text;
  - check-up parsing.

Technical (silent):
- **One installer, in shell.** `scripts/install-frame-server.sh` is the single source of the layout:
  - verified download, `--package-file`, `--from-source`;
  - unpack, then switch `current`, recording `previous`;
  - service setup with fallback;
  - health check (wait for `connection.json` with the new version and a live pid), with automatic rollback when it fails;
  - keep the last 3 versions.

  The desktop runs it over SSH (`ssh host 'bash -s -- <args>' < script`), so desktop installs and shell installs cannot drift. It is also published as a release asset for `curl … | bash`.
- **Layout on the server.**
  - `~/.frame-server/versions/<v>/` holds `node/bin/node`, `app/…`, `bin/frame-server` and `VERSION`.
  - `current` and `previous` are symlinks.
  - `~/.frame-server/bin/frame-server` points to `current/bin/frame-server`.
  - The token and `connection.json` stay where they are.
  - The systemd unit runs `%h/.frame-server/current/bin/frame-server run`.
- **The `frame-server` command** (bash, inside the package): `run`, `status [--json]`, `update [version]`, `rollback`, `logs`, `install-service`.
- **The package.** `scripts/build-server-package.js` builds it on the target platform:
  - `package.json`, `src/`, `scripts/redact.js`, and production `node_modules` with `node-pty` rebuilt for the bundled Node 20 (the CI runner's `process.execPath`);
  - `bin/frame-server` and `VERSION`;
  - it is tarred as `frame-server-<v>-linux-<x64|arm64>.tar.gz` with a `.sha256` next to it.

  URL pattern: `https://github.com/kaanozhan/Frame/releases/download/v<v>/<asset>`.
- **Desktop flow.**
  - `src/main/serverInstaller.js` probes with `uname -sm` and `frame-server status --json`, then decides between missing, current, older, newer and dev mismatch (`serverInstall.installDecision`). It runs the script with progress lines streamed to the window, and handles consent and rollback.
  - `serverConnection` stops reporting "not running — see README" as a retry loop. A missing or outdated server becomes a `needs-install` or `needs-update` status that waits for the user, and the protocol mismatch from hello maps to `needs-update`.
- **Check-up.** A new server method `server.doctor` reports:
  - Claude Code and Codex: installed, and signed in (credentials file present);
  - `gh`: installed and authenticated (`gh auth status`);
  - git;
  - the service mode and linger.

  Each missing item carries the command to fix it. The Connect dialog shows the list after connecting.
- **CI.** The existing `ci.yml` keeps `npm ci --ignore-scripts`, added on 2026-11-11.

### Data shapes

```
installDecision({ installed: { current, versions[] } | null, desktopVersion, dev, protocolOk })
  → { action: 'install'|'update'|'none'|'reinstall-dev', reason }
assetFor(unameS, unameM) → { platform: 'linux-x64'|'linux-arm64', asset: 'frame-server-<v>-linux-x64.tar.gz' } | { error }
frame-server status --json → { current, previous, versions[], service: 'systemd'|'detached'|'none', linger, running, pid }
server.doctor → { items: [{ id, label, ok, detail, fix? }] }
ServerStatus.state += 'needs-install' | 'needs-update' | 'installing'
```

## Files

- `src/shared/serverInstall.js` — **New**: `assetFor`, `compareVersions`, `installDecision`, `parseChecksum`, `systemdUnit`, `doctorItems`
- `test/serverInstall.test.js` — **New**: tests for the above
- `src/server/bin/frame-server` — **New**: the server CLI (`run`, `status`, `update`, `rollback`, `logs`, `install-service`)
- `scripts/build-server-package.js` — **New**: build the platform package and its checksum
- `scripts/smoke-server-package.js` — **New**: boot a package, connect with the token, run a terminal
- `.github/workflows/server-package.yml` — **New**: build and smoke on x64/arm64 for PRs and releases; upload assets on release
- `scripts/install-frame-server.sh` — **New**: the single installer (download/verify, package file, from source, layout, service, health check, rollback, prune)
- `src/server/doctor.js` — **New**: the `server.doctor` method
- `src/server/index.js` — **Modified**: register doctor
- `src/main/serverInstaller.js` — **New**: desktop probe, install/update/rollback over SSH, upload fallback, from-source path, consent, progress
- `src/main/serverConnection.js` — **Modified**: `needs-install` / `needs-update` / `installing` states; installer and doctor IPC
- `src/shared/ipcChannels.js` — **Modified**: `SERVER_INSTALL`, `SERVER_UPDATE`, `SERVER_ROLLBACK`, `SERVER_INSTALL_PROGRESS`, `SERVER_DOCTOR`
- `src/renderer/serverConnect.js` — **Modified**: Install / Update / Roll back, progress, agent consent, check-up list
- `index.html` — **Modified**: dialog sections for install, consent and check-up
- `src/renderer/styles/components/workspaces.css` — **Modified**: their styles
- `src/server/README.md` — **Modified**: managed install first, manual install as fallback
- `package.json` — **Modified**: `server:package` script

## Footprint

- src/shared/serverInstall.js
- test/serverInstall.test.js
- src/server/**
- scripts/build-server-package.js
- scripts/smoke-server-package.js
- scripts/install-frame-server.sh
- .github/workflows/server-package.yml
- src/main/serverInstaller.js
- src/main/serverConnection.js
- src/shared/ipcChannels.js
- src/renderer/serverConnect.js
- index.html
- src/renderer/styles/components/workspaces.css
- package.json

## Dependencies

None. Node 20 comes from the CI runner, and `node-pty` is already a dependency.

## Sequencing

1. **Pure rules.** `src/shared/serverInstall.js`, with tests in `test/serverInstall.test.js`:
   - `assetFor`;
   - `compareVersions` (including `-dev+sha`);
   - `installDecision`;
   - `parseChecksum`;
   - `systemdUnit`;
   - `doctorItems`.
2. **The package.**
   - `src/server/bin/frame-server` (CLI).
   - `scripts/build-server-package.js`, plus the `server:package` script in `package.json`.
   - `scripts/smoke-server-package.js`.
   - Build and smoke it locally.
3. **CI for packages.** `.github/workflows/server-package.yml`:
   - build and smoke on `ubuntu-24.04` and `ubuntu-24.04-arm` for pull requests touching the server;
   - on `release: published`, also upload the assets and their checksums to the release.
4. **The installer.** `scripts/install-frame-server.sh`:
   - verified release download, `--package-file`, `--from-source`;
   - layout and `current`/`previous`;
   - systemd unit with linger, or the detached fallback;
   - health check with automatic rollback;
   - prune to 3 versions.

   Exercise it against a temporary home.
5. **Check-up on the server.** `src/server/doctor.js` (`server.doctor`), registered in `src/server/index.js`.
6. **Desktop installer.**
   - `src/main/serverInstaller.js`:
     - probe and decide;
     - run the script over SSH with progress;
     - fall back to uploading when the server cannot download;
     - use the from-source path for dev builds;
     - ask agent consent before update or rollback.
   - `serverConnection`: the `needs-install` / `needs-update` / `installing` states and the IPC.
   - The channels in `ipcChannels.js`.
7. **Connect dialog.** `serverConnect.js`, `index.html` and `workspaces.css`:
   - Install, Update and Roll back with live progress;
   - the running-agents consent;
   - the check-up list with fix commands.
8. **Docs.** Rewrite `src/server/README.md` around the managed install, with the manual path as a fallback.
