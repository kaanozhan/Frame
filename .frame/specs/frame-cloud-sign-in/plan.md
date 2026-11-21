# Plan — Frame Cloud sign-in

## Architecture

### Resolved plan-time decisions

- **D1 · `safeStorage` unavailable → memory-only session.** (asked) When
  `safeStorage.isEncryptionAvailable()` is false, sign-in still works but
  nothing is written to disk; the session lives until quit and the Account
  section says "Your system has no secure storage, so you'll sign in again
  next launch." Rejected: plaintext on disk (readable token in `userData`),
  disabling sign-in (Linux users without a keyring get nothing). Consequence:
  the spec's `storageUnavailable` failure reason is dropped — it is no longer
  a failure — and the state payload carries `ephemeral: true` instead.
- **D2 · Packaged default server address is empty; Account hidden.** (asked)
  No FrameCloud is deployed. `DEFAULT_CLOUD_SERVER_URL = ''`; with nothing
  resolved the Account section is not rendered and no request is made.
  Developers set `FRAME_CLOUD_URL`. Rejected: shipping a prod URL now, which
  would show a section whose only outcome is "server unreachable".
- **D3 · Tests: pure logic only.** (asked) The testing record's convention —
  test the pure module, skip its Electron-coupled wrapper. `deviceFlow.js`
  (poll loop, parsing, code formatting, URL resolution) and the redact
  pattern get tests; `sessionStore.js`, `cloudSession.js` and the DOM do not.
  Rejected: "everything testable" (stubbing `safeStorage`/`net` adds test
  code nobody else in the repo maintains), "none" (the poll loop's edges are
  exactly what `node --test` catches for free).
- **D4 · Modules live in `src/main/cloud/`.** (asked, after the user raised
  FrameCloud's "one connection module, two thin shells" principle) The
  directory is the connection module's home: `deviceFlow.js`,
  `sessionStore.js`, `cloudSession.js` now, the `link`/`linkAll`/`register`
  verbs later. The pure core imports no Electron so a future CLI shell can
  wrap it. First subdirectory under `src/main/`; the renderer already groups
  features this way (`dock/`, `github/`, `home/`). Rejected: flat `cloud*`
  files (root grows with every verb); a separate package or CLI now (out of
  scope here and in FrameCloud's device-flow spec — Frame has no `bin`).
- **D15 · The core owns the whole flow, not just the poll loop.** (asked —
  the user's follow-up to D4: "write the core without a process boundary,
  but design it as if the CLI will be written later".) The four endpoint
  calls and the sign-in orchestration (`runSignIn`) live in `deviceFlow.js`
  with every side effect injected: `fetchJson`, `sleep`, `now`, `signal`,
  `openUrl`, `deviceInfo`, `onState`. `cloudSession.js` is a thin shell that
  builds those from Electron (`net.fetch`, `shell.openExternal`,
  `sessionStore`, `webContents.send`) and registers IPC. A future
  `bin/frame-cloud.js` is a second shell: parse args, call the same core with
  Node `fetch` and `console.log` for the URL, print JSON — and the only
  question it has to answer alone is where its token lives. Rejected: the
  first draft, where the endpoint calls and state transitions sat in the
  Electron service, which a CLI would have had to rewrite. Side effect:
  `register`/`me`/`signOut` and every state transition are now testable under
  D3 without widening the posture.
- **D5 · Account is the first section of Frame Settings** (silent), above
  Privacy & Analytics: identity leads in every comparable app, and in
  packaged builds it is hidden anyway (D2), so it never pushes the existing
  sections down for users who cannot use it.
- **D6 · `scripts/redact.js` learns the token shapes this spec introduces**
  (silent). Today's key pattern matches `token=` but not `access_token` or
  `Authorization: Bearer …` (`\btoken` cannot match inside `access_token`),
  so "never logged" is not guaranteed by the logger. Add `access[_-]?token`
  to the key list and a `Bearer <token>` value pattern; the service also
  never logs a response body, so this is defence in depth.
- **D7 · HTTP goes through Electron's `net.fetch`** (silent): system proxy
  and certificate store, no dependency. The pure core receives a `fetchJson`
  callback; `cloudSession.js` is the only file that touches `net`.
- **D8 · State reaches the renderer by push plus one pull** (silent), the
  `updateChecker` pattern: `cloudSession.init(window)` holds the window and
  `webContents.send(IPC.CLOUD_SESSION_STATE, payload)` on every transition;
  the renderer invokes `CLOUD_GET_STATE` once when Frame Settings binds, so a
  modal that opens after a push it never saw still renders the truth.
- **D9 · The payload is built by an allowlist** (silent), a
  `toPublicState()` function that copies named fields — never
  `delete payload.token`. This is the only enforcement available with
  `nodeIntegration: true` (spec C3).
- **D10 · Palette "Sign in" is `frameSettingsModal.signIn()`** (silent):
  opens the modal, scrolls Account into view, invokes `CLOUD_SIGN_IN`.
  "Sign out" invokes `CLOUD_SIGN_OUT` directly, no modal.
- **D11 · In-flight footprint collisions are planned around** (silent).
  `audit-q3-performance-resources` (implementing since 2026-08-26) and
  `audit-q3-cross-platform` (planned since 2026-07-20) list
  `src/main/index.js`, `index.html`, `src/shared/ipcChannels.js` and
  `src/renderer/index.js`. Both look stalled; this spec only appends blocks
  (a `setupIPC`/`init` line, a channel group, a settings section, two palette
  entries) and restructures nothing, so a merge conflict is at worst
  adjacent-line.
- **D12 · The verification URL copies via Electron `clipboard.writeText`**
  (silent), the `feedbackPanel.js` pattern; the URL is also selectable text.
- **D13 · Device registration fields** (silent): `name` =
  `os.hostname()` with a trailing `.local` removed, cut to 100 chars,
  `'Unknown device'` if empty; `os` = `` `${process.platform} ${os.release()}` ``
  cut to 100; `appVersion` = `app.getVersion()` cut to 40.
- **D14 · Account styles go into `settings-modal.css`** (silent), reusing
  `.settings-section`, `.settings-about-row`, `.settings-about-btn`,
  `.settings-status-chip`; only the large code display and the URL row need
  new rules.

- **D16 · Frame comes to the front when sign-in completes.** (asked,
  2026-09-16, after manual testing — the waiting screen gave no sign the
  browser step had finished) Industry desktop apps return to the foreground
  after browser sign-in (usually via a URL-scheme or loopback redirect);
  device flow has no redirect, so the success result itself triggers it:
  `cloudSession.js` restores, shows and focuses the window, with
  `app.focus({ steal: true })` on macOS where a plain `focus()` cannot take
  focus from the browser. The renderer shows a short "Signed in to Frame
  Cloud" confirmation on the registering → signedIn transition and opens
  Frame Settings on Account if the user had closed it, so the confirmation
  is visible. No new payload field: the transition is detected from the
  previous pushed state. Rejected for now: switching to authorization code +
  PKCE with a `frame://` or loopback redirect (server work in FrameCloud, and
  the future CLI still needs device flow). Only a completed sign-in raises
  the window — not a launch refresh, a sign-out or a failure.

### Components

```
renderer                              main (Electron shell)                 core (no Electron)
────────                              ──────────────────────                ──────────────────
frameSettingsModal.js                 cloudSession.js                       deviceFlow.js
  ├─ invoke CLOUD_SIGN_IN ──────────▶   builds deps from Electron:  ──────▶   runSignIn(deps)
  ├─ invoke CLOUD_CANCEL_SIGN_IN ───▶     fetchJson  ← net.fetch               requestDeviceCode · pollForToken
  ├─ invoke CLOUD_SIGN_OUT ─────────▶     openUrl    ← shell.openExternal      registerDevice · fetchMe · signOutDevice
  ├─ invoke CLOUD_REFRESH ──────────▶     onState    → toPublicState + send    classify* · format* · resolveServerUrl
  ├─ invoke CLOUD_GET_STATE ────────▶     store      ← sessionStore.js
  └─ on CLOUD_SESSION_STATE ◀────────     (safeStorage + fsSafe, or memory)
index.js (palette) ── cloud.signIn / cloud.signOut ──▶ frameSettingsModal.signIn() / invoke

future bin/frame-cloud.js (not this spec)  ── builds deps from Node ──▶ the same core
```

### `deviceFlow.js` — the pure core (New)

No `require('electron')`, no file paths, no DOM. Everything time-, network-
and side-effect-shaped is injected, so the Electron service and a future CLI
are both shells over the same functions (D15).

```js
// building blocks
resolveServerUrl({ env, setting, defaultUrl })   // → trimmed URL without trailing '/' or ''
parseCodeResponse(body)                           // → { deviceCode, userCode, verificationUri, verificationUriComplete, expiresInMs, intervalMs } or throws
formatUserCode(userCode)                          // 'TTN4YFST' → 'TTN4-YFST'; other lengths: returned as-is
classifyTokenResponse({ status, body })           // → 'token' | 'pending' | 'slow_down' | 'denied' | 'expired' | 'rate_limited' | 'network'
classifyTrpcError({ status, body })               // → 'unauthorized' | 'not_registered' | 'no_workspace' | 'rate_limited' | 'network' | 'other'
deviceName(hostname)                              // strips trailing '.local', trims, cuts to 100, 'Unknown device' fallback

// endpoint calls — each takes { api, fetchJson } and returns parsed data or throws a
// CloudError { kind: classifyTrpcError(...) | 'rate_limited' | 'network', status, message }
requestDeviceCode({ api, fetchJson })                          // POST /api/auth/device/code
pollForToken({ api, code, fetchJson, sleep, now, signal })     // → { ok: true, token } | { ok: false, reason: 'denied' | 'expired' | 'cancelled' }
registerDevice({ api, token, info, fetchJson })                // POST /trpc/device.register → { deviceId, user, workspace, access }
fetchMe({ api, token, fetchJson })                             // GET  /trpc/device.me       → { user, workspace, device, access }
signOutDevice({ api, token, fetchJson })                       // POST /trpc/device.signOut  → { ok }

// orchestration — the state machine, shell-agnostic
runSignIn({ api, fetchJson, sleep, now, signal, openUrl, deviceInfo, onState })
  // onState({ state: 'requestingCode' })
  // onState({ state: 'awaitingApproval', userCode, verificationUrl })   then openUrl(verificationUrl)
  // onState({ state: 'registering' })
  // → { ok: true, token, session: { deviceId, user, workspace, access } }
  // | { ok: false, reason: 'denied' | 'expired' | 'cancelled' | 'network' | 'rateLimited' | 'noWorkspace' }
refreshSession({ api, token, deviceInfo, fetchJson })
  // fetchMe; on 'not_registered' → registerDevice then fetchMe once more
  // → { ok: true, session } | { ok: false, reason: 'unauthorized' | 'network' | 'other' }
```

`fetchJson(url, { method, body, token? })` resolves `{ status, body }` and
rejects on transport failure; `sleep(ms, signal)` rejects with an
`AbortError` when the signal fires; `openUrl(url)` returns nothing and may
be a no-op; `deviceInfo` is `{ name, os, appVersion }` already formatted;
`onState` is synchronous and never throws back into the flow.

### `sessionStore.js` (New)

- Path: `path.join(app.getPath('userData'), 'cloud-session.json')`.
- File shape (`version: 1`):
  `{ version, serverUrl, token: "<base64 of safeStorage.encryptString>", deviceId, user, workspace, access, device, savedAt }`.
- `load(serverUrl)` → session or `null`. Reads through
  `fsSafe.readJsonWithRecovery`; `null` when the file is missing, the
  `serverUrl` differs, the version is unknown, or `decryptString` throws.
  Never throws.
- `save(session)` → writes through `fsSafe.writeFileAtomic` with the token
  encrypted; when `!safeStorage.isEncryptionAvailable()` it keeps the session
  in a module variable only and returns `{ ephemeral: true }`.
- `clear()` → deletes the file (ignore ENOENT) and the memory copy.
- Never logs the session; log lines name the path and the outcome only.

### `cloudSession.js` — the Electron shell (New)

Holds no flow logic: it wires the core to Electron and to the renderer.

- `init(window)`, `setupIPC(ipcMain)`, `startup()` (fire-and-forget: load the
  stored session, publish `signedIn` immediately, then one `refreshSession`
  in the background), `getPublicState()`.
- Deps it builds once: `fetchJson` over `net.fetch` with
  `AbortSignal.timeout(15000)` per call (system proxy, no dependency);
  `openUrl = shell.openExternal`; `deviceInfo` from D13; `onState` =
  merge into the local state object, `publish()`.
- State: `{ state, ephemeral, serverUrl, userCode, verificationUrl, user, workspace, access, device, reason, serverUnreachable }`.
  `toPublicState()` copies exactly these keys; the token and the in-flight
  `AbortController` never enter the object that is sent.
- `signIn()`: abort any running attempt, resolve the URL, call `runSignIn`;
  on `ok` → `sessionStore.save` → `signedIn` (`ephemeral` from the store's
  answer); on `cancelled` → `signedOut`; on any other reason → `failed`.
- `cancel()`: abort → `signedOut`. `refresh()`: `refreshSession`; on
  `unauthorized` → `clear()` → `signedOut` silently; on `network` → keep
  state, set `serverUnreachable: true`. `signOut()`: `signOutDevice`
  (errors ignored, `serverUnreachable` set on failure) → `clear()` →
  `signedOut`.
- Server URL is resolved on every `signIn`/`startup` via `resolveServerUrl`
  with `process.env.FRAME_CLOUD_URL`, `userSettings.get('cloudServerUrl')`,
  `DEFAULT_CLOUD_SERVER_URL`. Empty → state `unavailable`, which the
  renderer maps to "render nothing".
- Nothing here waits on the network: `startup()` is not awaited by the
  window, and `before-quit` does not wait on an in-flight call.
- tRPC wire format is the core's business (`POST /trpc/<name>` with the
  input as the JSON body, `GET /trpc/device.me`, `body.result.data` /
  `body.error.data.code`); the shell only supplies transport.

### Settings → Account (renderer)

`index.html` gains a `.settings-section` with `id="settings-account"` as the
first child of `#frame-settings-overlay .settings-body`, hidden by default.
One container per state, toggled with `hidden`:

| state | shows |
|---|---|
| `unavailable` | section hidden |
| `signedOut` | "Sign in to Frame Cloud" + **Sign in** |
| `requestingCode` | "Starting sign-in…" (buttons disabled) |
| `awaitingApproval` | `#settings-account-code` (large mono), "Waiting for approval in your browser", **Open browser again**, URL row (selectable + **Copy**), **Cancel** |
| `registering` | "Finishing sign-in…" |
| `signedIn` | rows Account / Workspace / Plan (`.settings-status-chip` with `planLabel`) / This device; ephemeral note when `ephemeral`; unreachable note when `serverUnreachable`; **Sign out** |
| `failed` | reason sentence + **Try again** |

Reason sentences: `denied` → "Sign-in was denied in the browser."; `expired`
→ "The code expired. Start again."; `network` → "Frame Cloud couldn't be
reached."; `rateLimited` → "Too many sign-in attempts. Wait a minute and try
again."; `noWorkspace` → "Create a workspace on the web first." with a link
to the verification origin.

`frameSettingsModal.js` binds these elements in `init()`, calls
`CLOUD_GET_STATE` once and inside the overlay's `onOpen` (which also invokes
`CLOUD_REFRESH` when `signedIn`), and renders every `CLOUD_SESSION_STATE`
push through one `renderAccount(state)` function. Buttons only invoke
channels. A missing `#settings-account` logs a `console.error` (settings-by-
scope C4) and the rest of the modal keeps working. New exports:
`signIn()`, `signOut()`.

### Acceptance walk (how the success criteria are proven)

Against a local FrameCloud (`pnpm dev`, API `http://localhost:3777`, web
`:5173`) with `FRAME_CLOUD_URL=http://localhost:3777 npm start`: sign in and
approve on `/device`; reopen Account after `pnpm plan:set <slug> pro`; Deny
and let a code expire; Sign out then `curl -H "Authorization: Bearer <old>"
/trpc/device.me` → 401; inspect `cloud-session.json` for the absence of a
plaintext token. Without `FRAME_CLOUD_URL`: no Account section, no request
in the dev-tools network log.

## Files

- **New** `src/main/cloud/deviceFlow.js` — pure device-flow core: URL resolution, code parsing, the five endpoint calls, poll loop, `runSignIn` / `refreshSession` orchestration, response classification, code and device-name formatting. No Electron, no paths, no DOM.
- **New** `src/main/cloud/sessionStore.js` — `cloud-session.json` under `userData` via `safeStorage` + `fsSafe`; memory-only fallback.
- **New** `src/main/cloud/cloudSession.js` — the Electron shell: builds the core's deps from `net.fetch`, `shell`, `sessionStore` and the window; owns the public state and its allowlisted push; IPC handlers.
- **New** `test/cloudDeviceFlow.test.js` — `node --test` coverage of `deviceFlow.js` — building blocks, endpoint calls, poll loop and `runSignIn`/`refreshSession` — with a fake `fetchJson`, `sleep`, clock, `openUrl` and `onState`.
- **Modified** `scripts/redact.js` — `access_token` key and `Bearer <token>` value patterns.
- **Modified** `test/logger.test.js` — cases for the two new patterns.
- **Modified** `src/shared/ipcChannels.js` — `CLOUD_SIGN_IN`, `CLOUD_CANCEL_SIGN_IN`, `CLOUD_SIGN_OUT`, `CLOUD_GET_STATE`, `CLOUD_REFRESH`, `CLOUD_SESSION_STATE`.
- **Modified** `src/main/index.js` — `cloudSession.setupIPC(ipcMain)` beside the user-settings handlers, `cloudSession.init(window)` in `initModulesWithWindow`, `cloudSession.startup()` after the window loads.
- **Modified** `index.html` — the Account section markup inside `#frame-settings-overlay`.
- **Modified** `src/renderer/frameSettingsModal.js` — Account binding, `renderAccount`, refresh on open, `signIn`/`signOut` exports.
- **Modified** `src/renderer/styles/components/settings-modal.css` — code display, URL row, ephemeral/unreachable notes.
- **Modified** `src/renderer/index.js` — `cloud.signIn` and `cloud.signOut` palette commands.
- **Modified** `PRIVACY.md` — "Frame Cloud sign-in" section.

## Footprint

- src/main/cloud/deviceFlow.js
- src/main/cloud/sessionStore.js
- src/main/cloud/cloudSession.js
- test/cloudDeviceFlow.test.js
- scripts/redact.js
- test/logger.test.js
- src/shared/ipcChannels.js
- src/main/index.js
- index.html
- src/renderer/frameSettingsModal.js
- src/renderer/styles/components/settings-modal.css
- src/renderer/index.js
- PRIVACY.md

## Dependencies

None. `safeStorage`, `net.fetch`, `shell` and `clipboard` ship with
Electron 28.3.3; tests use Node's built-in runner.

## Sequencing

1. **Pure core.** Write `src/main/cloud/deviceFlow.js` with the building
   blocks (`resolveServerUrl`, `parseCodeResponse`, `formatUserCode`,
   `classifyTokenResponse`, `classifyTrpcError`, `deviceName`), the endpoint
   calls (`requestDeviceCode`, `pollForToken`, `registerDevice`, `fetchMe`,
   `signOutDevice`) and the orchestration (`runSignIn`, `refreshSession`).
   Write `test/cloudDeviceFlow.test.js` covering — poll loop: pending →
   token; `slow_down` adds 5 s; denied; `expired_token`; `invalid_grant`;
   unknown error → expired; network error and 429 double the interval up to
   30 s; abort → cancelled; deadline → expired; never polls faster than
   `intervalMs` — endpoint calls: each sends the documented method, path,
   body and bearer header and unwraps `result.data`; tRPC error bodies map
   to `CloudError.kind`; 429 on `/device/code` → `rate_limited` —
   orchestration: `runSignIn` emits `requestingCode → awaitingApproval →
   registering` in order, calls `openUrl` exactly once with
   `verification_uri_complete`, returns the session on success, `noWorkspace`
   when register answers 412, `cancelled` when aborted mid-poll, and never
   calls `registerDevice` after a failed poll; `refreshSession` retries `me`
   once after `not_registered` and reports `unauthorized` on 401 — building
   blocks: `formatUserCode` grouping; `resolveServerUrl` precedence and
   trailing-slash trim; `deviceName` `.local` strip and 100-char cut;
   `parseCodeResponse` rejects a body missing `device_code`.
2. **Redaction.** Add the `access_token` key and `Bearer` value patterns to
   `scripts/redact.js`; add two cases to `test/logger.test.js` (a JSON body
   with `"access_token":"…"`, an `Authorization: Bearer …` header line).
3. **Session store.** Write `src/main/cloud/sessionStore.js`: `load`,
   `save`, `clear`, the memory-only path when encryption is unavailable, the
   `serverUrl` and version checks.
4. **Electron shell.** Write `src/main/cloud/cloudSession.js`: the deps
   (`net.fetch`-backed `fetchJson` with timeout, `shell.openExternal` as
   `openUrl`, `deviceInfo` from D13, `onState` → publish), the state object
   and `toPublicState`, `signIn`/`cancel`/`refresh`/`signOut`/`startup`
   mapping the core's results onto states and `sessionStore`,
   `init(window)` + `publish()`, `setupIPC`. No endpoint path or response
   shape appears in this file.
5. **Channels and wiring.** Add the six constants to
   `src/shared/ipcChannels.js` (with the renderer→main / main→renderer
   comments the file uses); in `src/main/index.js` call
   `cloudSession.setupIPC(ipcMain)` next to the user-settings handlers,
   `cloudSession.init(window)` in `initModulesWithWindow`, and
   `cloudSession.startup()` once the window has loaded.
6. **Account section.** Add the markup to `index.html` as the first section
   of Frame Settings; the CSS for the code display, URL row and notes in
   `settings-modal.css`; in `frameSettingsModal.js` bind the elements,
   implement `renderAccount(state)` for every state in the table, the
   `CLOUD_GET_STATE` pull on init and in `onOpen`, `CLOUD_REFRESH` on open
   when signed in, the Copy button via `clipboard.writeText`, and the
   `signIn`/`signOut` exports.
7. **Palette.** Register `cloud.signIn` ("Frame Cloud: Sign in") and
   `cloud.signOut` ("Frame Cloud: Sign out") in `registerCommands()` in
   `src/renderer/index.js`, category matching the settings commands.
8. **Privacy note.** Add a "Frame Cloud sign-in" section to `PRIVACY.md`:
   what leaves the machine (machine name, OS, app version), to which server
   (the one the user configured, never Aptabase), where the token lives
   (`cloud-session.json`, `safeStorage`-encrypted, or memory only), and that
   it is excluded from logs, the activity record and telemetry.
9. **Foreground on success (D16).** In `src/main/cloud/cloudSession.js`,
   after a successful `signIn` restore a minimized window, show and focus
   it, and call `app.focus({ steal: true })` on macOS. In
   `src/renderer/frameSettingsModal.js`, on the registering → signedIn
   transition open the overlay if it is closed, scroll Account into view and
   show a "Signed in to Frame Cloud" note for a few seconds; its style goes
   in `settings-modal.css`. The Files list above already covers all three.
