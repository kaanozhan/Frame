# Plan — Frame Cloud server address

## Architecture

### Resolved plan-time decisions

Business

- **D1 · The Discuss and Shape command buses (spec Open Question) → their
  watchers follow sign-in, in this spec** (asked). Today both buses start a
  watcher at every launch (`src/main/index.js:367-368` → `init()` →
  `startWatcher()`), with no session check, so a Frame with no Frame Cloud
  still claims the other Frame's requests and answers "unknown". A watcher now
  runs only while that Frame is signed in. The user's rule, "not signed in,
  no access", then holds for the background too. Two Frames signed in at once
  (installed on production, dev on a local server) stays out of scope.
- **D2 · PRIVACY.md → not touched** (asked). The two sentences this spec makes
  stale ("Packaged builds do not ship a server address yet" and the
  `cloud-session.json` location) go to the full PRIVACY update before the beta.

Technical

- **D3 · One session file per server** (silent). The files are
  `userData/cloud-sessions/<first 16 hex of sha256(serverUrl)>.json`, each with
  today's record shape (`version: 1`, `serverUrl`, encrypted `token`,
  `deviceId`, `user`, `workspace`, `device`, `webOrigin`, `savedAt`). Two Frames
  on two servers then never read-modify-write one shared file, and signing out
  deletes exactly one file. A single file holding a map of servers was rejected
  because two processes saving it race.
- **D4 · The legacy `cloud-session.json` is migrated on load** (silent). When no
  per-server file exists and the legacy file's `serverUrl` equals the requested
  one, its JSON is copied as-is (the token stays encrypted) to the per-server
  path, and the legacy file and its `.bak` are deleted. A legacy file for
  another server is left alone until that server is loaded. `clear(serverUrl)`
  also removes a legacy file for that server.
- **D5 · The release address goes through a Node wrapper,
  `scripts/release-build.js`** (silent). audit-q3-cross-platform (planned) will
  add `dist:win` / `dist:linux`, and cmd.exe does not expand `$VAR` in npm
  scripts. The wrapper reads `FRAME_CLOUD_RELEASE_URL` and runs electron-builder's
  `cli.js` with `process.execPath`, adding
  `-c.extraMetadata.frameCloudUrl=<url>` (electron-builder 26.7.0 documents this
  form; `modifyMainPackageJson` deep-assigns it into the packaged
  `package.json`). The command the releaser types stays `npm run dist:mac`.
- **D6 · The wrapper passes only an https, non-loopback address** (silent).
  When the variable is missing, empty, unparsable, not https, or loopback, it
  omits the flag, prints one warning line saying Frame Cloud will be off in
  this build, and still builds (C4). A release can never default to localhost or
  to http.
- **D7 · `resolveServerUrl` returns `{ url, refused }`** (silent). The first
  non-empty candidate decides (C1). An allowed candidate gives `{ url, refused:
  null }`; a refused one gives `{ url: '', refused: <candidate> }`, and the
  caller does not try the next. `cloudSession.resolveUrl()` logs a refused value
  once per distinct value (it runs on every `getState`), naming the scheme and
  host only.
- **D8 · One loopback set** (silent). `LOOPBACK_HOSTS` (`localhost`,
  `127.0.0.1`) moves from `cloudProjects.js:25` to `deviceFlow.js` and is
  exported. `cloudProjects.js` already imports `callTrpc` from there, and
  `buildWebUrl`'s rule (frame-cloud-projects D3) is unchanged.
- **D9 · The release default is read the way `updateChecker.js:45` reads the
  version** (silent): `require('../../../package.json').frameCloudUrl`, as a
  string or `''`. It replaces `DEFAULT_CLOUD_SERVER_URL` (cloudSession.js:39)
  and overturns frame-cloud-sign-in D2 and its note that the prod URL is a
  one-line change there.
- **D10 · Watchers follow `cloudSession.onChange`** (silent), as
  `cloudProjectsService.js:549` already does. `init()` checks
  `getPublicState()` once, then starts the watcher on `signedIn` and stops it
  (closing the `fs.FSWatcher` that `fsSafe.safeWatch` returns, and clearing the
  debounce) on any other state. The "already initialised" guard moves from
  `watcher` to its own flag, because a signed-out Frame has no watcher. A
  request written while signed out stays in the bus. The command's existing
  timeout message ("Make sure Frame is open and signed in to Frame Cloud")
  covers it, and the stale-request sweep removes it later.
- **D11 · Test posture → everything testable** (asked):
  - the scheme rule and `resolveServerUrl` in `deviceFlow.js`, which is pure;
  - the wrapper's argument and warning logic, through an exported pure
    function;
  - `sessionStore.js` with `electron` stubbed through `Module._load`, as
    `test/specTasksSync.test.js:26-37` does, in an `mkdtemp` folder.

  The watcher lifecycle is checked by hand. The two bus services load
  `aiToolManager`, `cloudProjectsService` and `cloudBriefsService`
  transitively, and stubbing all of them would test the stubs.
- **In-flight notes** (silent).
  - `deviceFlow.js` and `cloudSession.js` show IN-FLIGHT for
    frame-cloud-early-access. That is a false positive: the spec merged in #26
    (`db43ed3`) with its phase left at `tasks_generated`.
  - `package.json` is in audit-q3-cross-platform's footprint. Only the three
    `dist*` script lines change here, and its future `dist:win` / `dist:linux`
    should call `scripts/release-build.js` too.

### Shapes

```
deviceFlow
  LOOPBACK_HOSTS = Set{'localhost','127.0.0.1'}
  checkServerUrl(url) → { ok: true, url } | { ok: false, reason: 'invalid' | 'insecure' }
      https: any host · http: LOOPBACK_HOSTS only · anything else: refused
  resolveServerUrl({ env, setting, defaultUrl }) → { url, refused }

sessionStore (same exports, server-keyed)
  load(serverUrl)  → session | null          per-server file, else legacy migration
  save(session)    → { ephemeral }           writes cloud-sessions/<hash>.json; memory Map on failure
  clear(serverUrl)                           that server's file, .bak, .tmp, memory entry, legacy if same server

scripts/release-build.js
  releaseArgs(argv, env) → { args, warning }  pure; main spawns electron-builder cli.js with args
```

### Where each piece sits

- **Address.** `cloudSession.resolveUrl()` passes `FRAME_CLOUD_URL`, the
  `cloudServerUrl` setting and the release default into `resolveServerUrl`. An
  empty or refused result is today's `unavailable`. Every caller
  (`loadSession`, `signIn`, `signOut`, `getState`) keeps going through
  `resolveUrl()`.
- **Sessions.** `cloudSession` already passes `serverUrl` to `load` and
  `save`. The two `clear()` calls (`sessionExpired`, cloudSession.js:444, and
  `signOut`, :475) start passing the server they ended.
- **Release.** The `dist`, `dist:mac` and `dist:mac:unsigned` scripts run
  `npm run build` and then `node scripts/release-build.js` with their builder
  flags. `CSC_IDENTITY_AUTO_DISCOVERY=false` stays on the unsigned one.

## Files

- `src/main/cloud/deviceFlow.js` — **Modified.** `LOOPBACK_HOSTS`, `checkServerUrl`, and `resolveServerUrl` returning `{ url, refused }`.
- `src/main/cloud/cloudProjects.js` — **Modified.** Imports `LOOPBACK_HOSTS` from deviceFlow instead of defining its own.
- `src/main/cloud/cloudSession.js` — **Modified.** `resolveUrl` logs a refused address once. The default comes from the packaged `package.json` `frameCloudUrl`. `clear(serverUrl)` at both call sites.
- `src/main/cloud/sessionStore.js` — **Modified.** One file per server under `cloud-sessions/`, legacy migration, per-server memory fallback, `clear(serverUrl)`.
- `src/main/cloud/cloudDiscussionsService.js` — **Modified.** The bus watcher starts on sign-in and stops on sign-out.
- `src/main/cloud/cloudShapeService.js` — **Modified.** The same, for the Shape bus.
- `scripts/release-build.js` — **New.** Release wrapper: reads `FRAME_CLOUD_RELEASE_URL`, warns or passes `-c.extraMetadata.frameCloudUrl`, runs electron-builder.
- `package.json` — **Modified.** The three `dist*` scripts call the wrapper.
- `test/cloudDeviceFlow.test.js` — **Modified.** `resolveServerUrl` cases move to https and gain the scheme rule's cases.
- `test/cloudSessionStore.test.js` — **New.** Per-server files, side-by-side sessions, single-server clear, legacy migration, memory fallback, with `electron` stubbed.
- `test/releaseBuild.test.js` — **New.** `releaseArgs`: flag for an https address, warning and no flag for a missing, http, loopback or unparsable one.

## Footprint

- src/main/cloud/deviceFlow.js
- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudSession.js
- src/main/cloud/sessionStore.js
- src/main/cloud/cloudDiscussionsService.js
- src/main/cloud/cloudShapeService.js
- scripts/release-build.js
- package.json
- test/cloudDeviceFlow.test.js
- test/cloudSessionStore.test.js
- test/releaseBuild.test.js

## Dependencies

None. electron-builder is already a devDependency, and `crypto` is built in.

## Sequencing

1. **Server address rule.**
   - In `deviceFlow.js`, add `LOOPBACK_HOSTS` and `checkServerUrl`, and make
     `resolveServerUrl` return `{ url, refused }` (first non-empty candidate
     decides; no fall-through).
   - Point `cloudProjects.js` at the shared `LOOPBACK_HOSTS`.
   - Update `cloudSession.resolveUrl()` to take `.url` and log a refused value
     once.
   - In `test/cloudDeviceFlow.test.js`, move the existing `resolveServerUrl`
     cases to https and add the rule's cases: https any host, http on
     localhost and 127.0.0.1, http elsewhere refused, unparsable refused, a
     refused env value not falling through to the setting.
2. **Per-server session store.**
   - Rewrite `sessionStore.js`: one file per server (D3), legacy migration
     (D4), a memory Map fallback, and `clear(serverUrl)`.
   - Pass the server to both `clear()` calls in `cloudSession.js`.
   - Write `test/cloudSessionStore.test.js`:
     - two servers saved and loaded side by side;
     - clearing one leaves the other;
     - a legacy file for the requested server is migrated and removed;
     - a legacy file for another server is left alone;
     - no safeStorage keeps the session in memory per server;
     - a token that no longer decrypts reads as absent.
3. **Release default.**
   - Replace `DEFAULT_CLOUD_SERVER_URL` with the packaged
     `package.json` `frameCloudUrl` read (D9).
   - Add `scripts/release-build.js` with `releaseArgs` and the spawn (D5, D6).
   - Switch the three `dist*` scripts to the wrapper.
   - Write `test/releaseBuild.test.js`.
   - The step is done when a `npm run dist` (`--dir`) build made with the
     variable has `frameCloudUrl` in its `app.asar` `package.json`, and one made
     without it prints the warning and has no such field.
4. **Bus watchers follow sign-in.**
   - In `cloudDiscussionsService.js` and `cloudShapeService.js`, `init()`
     subscribes to `cloudSession.onChange` and reads the current state once
     (D10).
   - Start the watcher on `signedIn` and stop it on any other state. The
     initialised guard becomes its own flag.
