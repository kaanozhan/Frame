# Outcome — Frame Cloud server address

## T01 — Server address rule: https anywhere, http on loopback only

Added `LOOPBACK_HOSTS` and `checkServerUrl` to `deviceFlow.js` and made `resolveServerUrl` return `{ url, refused }`, the first non-empty candidate deciding with no fall-through; `cloudProjects.js` now imports the shared set. `cloudSession.resolveUrl()` takes `.url` and logs each distinct refused address once, through a Set, naming scheme and host only (host keeps the port, which helps with LAN addresses). Beyond the plan's shape, `checkServerUrl` separates `invalid` (unparsable or not http(s)) from `insecure` (http off loopback) so the log can say which. Files: `src/main/cloud/deviceFlow.js`, `src/main/cloud/cloudProjects.js`, `src/main/cloud/cloudSession.js`, `test/cloudDeviceFlow.test.js`.

_Captured: 2026-10-01 · 4 file change(s)_

---

## T02 — One session file per server

Rewrote `sessionStore.js` to keep each server's session at `userData/cloud-sessions/<first 16 hex of sha256(serverUrl)>.json` in the existing record shape, with a per-server memory `Map` fallback and `clear(serverUrl)` removing that server's file, `.bak`, `.tmp` and memory entry (an empty `serverUrl` is a no-op). Passed the ended server to both `clear()` calls in `cloudSession.js` and added `test/cloudSessionStore.test.js` (electron stubbed via `Module._load`, `mkdtemp` userData). The task's "two running Frames stay signed in across restarts" check was done as a test with separate module instances and a fresh one reading both, not by running two Frames by hand. Files: `src/main/cloud/sessionStore.js`, `src/main/cloud/cloudSession.js`, `test/cloudSessionStore.test.js`.

_Captured: 2026-10-01 · 3 file change(s)_

---

## T03 — Move the old single-server session to its server's file

Added `migrateLegacy` to `sessionStore.load(serverUrl)`: when the server has no per-server file and `userData/cloud-session.json` names it, the raw text is copied byte-for-byte to the per-server path and the old file is removed. An old file for another server stays put, and `clear(serverUrl)` removes the old file when it belongs to the same server. Diverged slightly from D4: removal shares `clear`'s helper, so the old `.tmp` goes too, and the old file is read with a plain parse rather than `fsSafe.readJsonWithRecovery`, so neither `clear` nor `load` moves a corrupt one aside. Files: `src/main/cloud/sessionStore.js`, `test/cloudSessionStore.test.js`.

_Captured: 2026-10-01 · 2 file change(s)_

---

## T04 — Release default from the packaged package.json

Replaced `DEFAULT_CLOUD_SERVER_URL` in `cloudSession.js` with `RELEASE_CLOUD_SERVER_URL`, which reads `require('../../../package.json').frameCloudUrl` once at module load (a string, else `''`). Rewrote the comment to say a release built with `FRAME_CLOUD_RELEASE_URL` carries the field and the repository's `package.json` never does. This overturns frame-cloud-sign-in D2 as planned (D9). File: `src/main/cloud/cloudSession.js`.

_Captured: 2026-10-01 · 1 file change(s)_

---

## T05 — Release wrapper: scripts/release-build.js

Added `scripts/release-build.js` with a pure `releaseArgs(argv, env)` that appends `-c.extraMetadata.frameCloudUrl=<url>` only for an https, non-loopback `FRAME_CLOUD_RELEASE_URL` and otherwise returns a one-line warning naming the reason, never the address. Run directly, it spawns electron-builder's `cli.js` with `process.execPath` and exits with its status; a `--help` smoke run exits 0. The wrapper requires `LOOPBACK_HOSTS` from `src/main/cloud/deviceFlow.js` to keep one set (D8), and trims the value and strips trailing slashes as `resolveServerUrl` does. Files: `scripts/release-build.js`, `test/releaseBuild.test.js`.

_Captured: 2026-10-01 · 2 file change(s)_

---

## T06 — dist scripts call the release wrapper

Switched `dist`, `dist:mac` and `dist:mac:unsigned` to `npm run build && node scripts/release-build.js <builder flags>`, keeping `CSC_IDENTITY_AUTO_DISCOVERY=false` on the unsigned one. I ran `npm run dist` twice: with a placeholder https `FRAME_CLOUD_RELEASE_URL`, the `app.asar` `package.json` carried `frameCloudUrl` and the repository's did not; without the variable, the build printed the warning, exited 0 and had no such field. Both verification builds ran with `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing (mac.identity is another developer's certificate) and left a 274 MB `release/mac-arm64/` output, which is gitignored. File: `package.json`.

_Captured: 2026-10-01 · 1 file change(s)_

---

## T07 — Discuss bus watcher follows sign-in

`cloudDiscussionsService.init()` now reads `cloudSession.getPublicState()` once and subscribes to `onChange`, starting the bus watcher on `signedIn` and stopping it otherwise (`stopWatcher` closes the `FSWatcher` and clears the debounce). The re-init guard moved from `watcher` to an `initialised` flag. In place of the plan's hand check I ran a scratch script with the session stubbed (not committed): no bus while signed out, a request answered once signed in, one written after sign-out left in place and drained on the next sign-in, and a second `init` adding no listener. File: `src/main/cloud/cloudDiscussionsService.js`.

_Captured: 2026-10-01 · 1 file change(s)_

---

## T08 — Shape bus watcher follows sign-in

Gave `cloudShapeService.js` the same lifecycle as T07: one `getPublicState()` read and an `onChange` subscription in `init()`, the watcher started on `signedIn` and stopped otherwise, and an `initialised` flag for the re-init guard. The T07 scratch script, pointed at `cloud-shapes/`, showed the same results. File: `src/main/cloud/cloudShapeService.js`.

_Captured: 2026-10-01 · 1 file change(s)_

---
