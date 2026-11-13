---
keywords: frame server, install, update, rollback, release, prebuilt, node-pty, ssh bootstrap, systemd
related: server-workspaces, server-workspace-panels, in-app-auto-update
---
Frame Server installs and updates itself from the desktop.

**Packages.** Each release gets prebuilt Frame Server packages for linux-x64 and linux-arm64, built by `.github/workflows/server-package.yml` on matching runners and attached to the release with `.sha256` files and the install script.
- `scripts/build-server-package.js` bundles Node 20, `src/` (minus the renderer), `scripts/` (minus `eval/`), production modules with `node-pty` rebuilt, `bin/frame-server` and `VERSION`.
- `scripts/smoke-server-package.js` boots each package: terminal echo through node-pty and the mirror, plus a clone and a workspace.

**One installer.** `scripts/install-frame-server.sh` is the only installer. The desktop streams it over SSH, and `curl | bash` runs the same script. It provides:
- a verified download, an uploaded package file, or a build from source;
- `~/.frame-server/versions/<v>` with `current`/`previous` and `~/.frame-server/bin/frame-server`;
- a systemd user unit with linger, or a detached process;
- a health check with automatic rollback, and pruning to 3 versions;
- a `FRAME_INSTALL_RESULT` line and exit codes.

**Desktop.** `serverInstaller` probes the server and decides with `serverInstall.installDecision`.
- A released desktop has the server download the package; when the server cannot reach GitHub (exit 10), the desktop downloads it and uploads it.
- A desktop running from source uploads `git archive` and the server builds it (`<v>-dev+<sha>`).

**Connection states.** `serverConnection` adds:
- `needs-install` when nothing is installed;
- `needs-update` only on a protocol mismatch; an older but compatible server is connected to and offered the update, so its running agents can be named before updating;
- `installing`.

It also starts a stopped server.

**Connect dialog.** Install / Update / Roll back, live progress, consent naming running agents, and `server.doctor` (agent CLIs signed in, gh, git, service and linger) with a fix command for each gap. The server reports its package `VERSION`.

**Why this path.**
- Prebuilt packages per platform rather than compiling on the user's server.
- No Docker (2026-11-10): agents run in the user's real environment.
- The server downloads first, with a desktop upload as fallback, rather than always uploading.
- Dev builds compile on the server, because the Mac cannot build Linux node-pty without Docker.
- A detached fallback rather than systemd only.
- Consent rather than refusing to update while agents run.

**Rules for future work.**
- Layout and service logic live only in the install script.
- Anything the server loads from the repo must be in the package; extend the smoke test when a new path loads new files.
- CI keeps `npm ci --ignore-scripts`.

**Gaps.**
- The GitHub workflow and the systemd path have not run yet; they run on the first push or release and on a real server.
- Windows servers and sandboxed workspaces are out of scope.

Chain: spec.md → plan.md → tasks.md → outcome.md
