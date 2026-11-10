
## T01 — Pure install rules

Added src/shared/serverInstall.js: assetFor (Linux x86_64/aarch64 → package name and checksum file, a clear error for macOS, other OSes and processors), releaseUrl, compareVersions (semver order, dev prereleases before their release, build metadata ignored), installDecision (install / update / reinstall-dev / none with a reason; protocol mismatch forces update; a hand install that matches is left alone), parseChecksum (sha256sum and bare digests), systemdUnit, and doctorItems (one ready agent CLI is enough, the other becomes optional; gh, git and the logout-surviving service each carry their fix command). Tests in test/serverInstall.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — The Frame Server package, its command and its smoke test

Added src/server/bin/frame-server (bash: run with the bundled Node, status [--json] reading the versions/current/previous layout, service mode, linger and the running pid/version from connection.json, logs, and update/rollback/install-service delegating to the installer that T04 adds), scripts/build-server-package.js (package.json, src/ minus the renderer, scripts/ minus the eval corpus, production node_modules installed without scripts with node-pty rebuilt for the bundling Node and its spawn-helper made executable, the Node binary, bin/frame-server and VERSION; checks that node-pty loads before tarring frame-server-<v>-<platform>.tar.gz with a .sha256), the server:package npm script, and scripts/smoke-server-package.js (unpacks a tarball, runs it with a temporary home, checks connection.json is 0600, pings, echoes through a terminal and its screen mirror, clones a local repo, creates a workspace and reads its review list). Deviation: the plan listed only scripts/redact.js; the smoke test showed the server also loads toolVocabulary, detect-project, activity-log and structure-* from scripts/, so the package ships scripts/ whole except eval/.

_Captured: 2026-11-10 · 4 file change(s)_

---
