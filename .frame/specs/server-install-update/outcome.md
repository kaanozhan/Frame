
## T01 — Pure install rules

Added src/shared/serverInstall.js: assetFor (Linux x86_64/aarch64 → package name and checksum file, a clear error for macOS, other OSes and processors), releaseUrl, compareVersions (semver order, dev prereleases before their release, build metadata ignored), installDecision (install / update / reinstall-dev / none with a reason; protocol mismatch forces update; a hand install that matches is left alone), parseChecksum (sha256sum and bare digests), systemdUnit, and doctorItems (one ready agent CLI is enough, the other becomes optional; gh, git and the logout-surviving service each carry their fix command). Tests in test/serverInstall.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---
