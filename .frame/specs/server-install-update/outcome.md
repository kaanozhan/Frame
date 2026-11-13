
## T01 — Pure install rules

Added src/shared/serverInstall.js: assetFor (Linux x86_64/aarch64 → package name and checksum file, a clear error for macOS, other OSes and processors), releaseUrl, compareVersions (semver order, dev prereleases before their release, build metadata ignored), installDecision (install / update / reinstall-dev / none with a reason; protocol mismatch forces update; a hand install that matches is left alone), parseChecksum (sha256sum and bare digests), systemdUnit, and doctorItems (one ready agent CLI is enough, the other becomes optional; gh, git and the logout-surviving service each carry their fix command). Tests in test/serverInstall.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — The Frame Server package, its command and its smoke test

Added src/server/bin/frame-server (bash: run with the bundled Node, status [--json] reading the versions/current/previous layout, service mode, linger and the running pid/version from connection.json, logs, and update/rollback/install-service delegating to the installer that T04 adds), scripts/build-server-package.js (package.json, src/ minus the renderer, scripts/ minus the eval corpus, production node_modules installed without scripts with node-pty rebuilt for the bundling Node and its spawn-helper made executable, the Node binary, bin/frame-server and VERSION; checks that node-pty loads before tarring frame-server-<v>-<platform>.tar.gz with a .sha256), the server:package npm script, and scripts/smoke-server-package.js (unpacks a tarball, runs it with a temporary home, checks connection.json is 0600, pings, echoes through a terminal and its screen mirror, clones a local repo, creates a workspace and reads its review list). Deviation: the plan listed only scripts/redact.js; the smoke test showed the server also loads toolVocabulary, detect-project, activity-log and structure-* from scripts/, so the package ships scripts/ whole except eval/.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T03 — CI workflow for server packages

Added .github/workflows/server-package.yml: on pull requests touching src/server, src/main, src/shared, scripts, package files or the workflow (and on manual dispatch) it builds the package with Node 20 on ubuntu-24.04 (linux-x64) and ubuntu-24.04-arm (linux-arm64) and runs the smoke test; on a published release it first checks that the tag matches package.json, then uploads each package and .sha256 (and, once, scripts/install-frame-server.sh) to that release with gh. Not yet run on GitHub: nothing has been pushed, and no local Actions runner or Docker daemon was available.

_Captured: 2026-11-10 · 1 file change(s)_

---

## T04 — The single installer script

Added scripts/install-frame-server.sh: verified release download (curl/wget, SHA-256 from the release's .sha256 before unpacking; exit 10 when GitHub is unreachable so the desktop can upload), --package-file with --checksum, --from-source (checks Node >= 18, npm, make, g++, python3 and stops with the apt command; builds with npm ci --omit=dev --ignore-scripts and npm rebuild node-pty), the versions/<v> layout with current/previous and ~/.frame-server/bin/frame-server, a systemd user unit with linger (default home only) or a setsid/nohup detached process, a health check on connection.json's version and pid with automatic rollback (the failed version is removed and previous restored), --rollback, --service-only, pruning to 3 versions, progress lines and a final FRAME_INSTALL_RESULT JSON with exit codes 0/2/10–15. src/server/index.js now reports the installed package's VERSION (dev builds included) instead of package.json's. Not covered on this Mac: the systemd path (no systemd) — CI and a real server cover it.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T05 — Server check-up (server.doctor)

Added src/server/doctor.js with server.doctor, registered in src/server/index.js: as the server user it checks Claude Code and Codex with the same login-shell probe agent lanes use plus their credential files (~/.claude/.credentials.json or ~/.claude.json's oauthAccount; ~/.codex/auth.json), gh (installed, gh auth status), git, and how Frame Server runs (systemd user service via is-enabled, detached via server.pid, else started by hand) with linger; serverInstall.doctorItems turns it into ready/missing items with fix commands. Added a 'started by hand' case to doctorItems (fix: frame-server install-service), with a test.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T06 — Desktop installer over SSH

Added src/main/serverInstaller.js: probe (uname plus frame-server status --json, or a hand-run server's connection.json), decide (installDecision with this desktop's version, `<v>-dev+<sha>` when running from source), install (released desktop: the server downloads and verifies the release package; on installer exit 10 the desktop downloads asset and checksum over HTTPS following redirects and streams them over SSH; desktop from source: streams `git archive HEAD` and the server builds it), rollback, and runningAgents (terminals.list → serverInstall.agentTerminals, named by workspace) for the consent. The installer script is streamed with `bash -s --`, its progress lines forwarded and its FRAME_INSTALL_RESULT parsed. Added agentTerminals to src/shared/serverInstall.js with a test, and scripts/install-frame-server.sh to the desktop's packaged files (package.json) so a packaged app can send it.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T07 — Install states and IPC in the server connection

serverConnection probes the host before the first attempt of a session (serverInstaller.decide): a missing or outdated server sets needs-install / needs-update with the reason, desktop version and current/previous, and the loop waits instead of retrying; an installed but stopped server is started (installer --service-only, progress shown); a server found not running mid-session is probed again; a protocol mismatch in hello becomes needs-update. runAction(install|update|rollback) asks about running agents first (returns needsConsent with the list unless confirmAgents), disconnects, sets installing, runs the installer with SERVER_INSTALL_PROGRESS lines, then connects again or reports the error. Added SERVER_INSTALL, SERVER_UPDATE, SERVER_ROLLBACK, SERVER_INSTALL_PROGRESS and SERVER_DOCTOR, and serverInstaller.start.

_Captured: 2026-11-10 · 3 file change(s)_

---

## T08 — Install, update, consent and check-up in the Connect dialog

The Connect dialog now shows, by state: 'Frame Server is not installed' with Install; an available update ('the server runs X; update to Y?') with Update while connected; live installer progress lines; a consent box before update or rollback naming running agents ('claude in main', with 'Update now' / 'Later') or a general warning when the server speaks another protocol; the server check-up once connected (✓ / ! / optional, each missing item with its fix command and a Copy button, 'Check again'); 'Roll back to <previous>'. A connect started from the dialog closes it only when the check-up is clean and no update is pending. Toasts announce needs-install/needs-update and an available update once per version. Deviation from T07: an older but protocol-compatible server is now connected to (with the update offered) instead of blocking, so its running agents can be named before updating; only a protocol mismatch blocks with needs-update (serverConnection.js).

_Captured: 2026-11-10 · 4 file change(s)_

---

## T09 — README around the managed install

Rewrote src/server/README.md: install from Frame (SSH without prompts, Connect, Install, what Frame does step by step, the check-up), development installs from source, updates with agent consent, automatic and manual rollback, protocol mismatch, the curl | bash install and the frame-server commands, requirements (no compiler — packages bundle Node 20 and node-pty), security (incl. verified packages), the full file layout, and the manual install as a fallback.

_Captured: 2026-11-10 · 1 file change(s)_

---
