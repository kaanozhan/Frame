---
keywords: frame cloud, sign in, device flow, oauth device grant, rfc 8628, account, safeStorage, token, bearer, settings account, cloud server url
related: settings-by-scope, in-app-feedback, audit-q3-product-analytics
---
# Frame Cloud sign-in

> **What we're building:** the desktop half of FrameCloud's device flow. Frame
> signs the user in to a FrameCloud server from Settings → Account, keeps the
> session token in the main process, and shows who is signed in. Nothing else
> changes: no project is linked, nothing local is locked.

## Problem

FrameCloud (kaanozhan/FrameCloud, PR #14) ships the server and web side of
desktop sign-in: an OAuth 2.0 device authorization grant (RFC 8628) plus three
tRPC procedures (`device.register`, `device.me`, `device.signOut`) behind a
bearer token. It has been walked end to end with curl. Frame has no counterpart
— no way to sign in, no place to hold a token, no Account surface — so every
cloud feature that follows (project linking, mirror sync, devices) has nothing
to stand on. This spec is that foundation and only that.

Frame's shape sets the rules. It is Electron-only (no CLI), and its window
runs with `nodeIntegration: true` / `contextIsolation: false`
(`src/main/index.js:77`), so any code in the renderer can reach Node. A token
that reaches the renderer is a token that reaches every renderer module; the
token therefore stays in the main process, and the renderer only ever sees the
session without it.

## Goal

**1. Server address.** One resolved address, in this order: `FRAME_CLOUD_URL`
env var → `cloudServerUrl` in `userSettings` → built-in default. When nothing
resolves, the Account section does not render (see Open Questions for the
packaged default).

**2. A pure device-flow core** (`src/main/cloud/deviceFlow.js`, no Electron
import) that Frame's `node --test` suite can drive with a fake `fetch` and
clock: parse the `/api/auth/device/code` response, run the token poll, classify
outcomes, format the user code for display (`XXXX-XXXX`, the server's 8
characters untouched).

**3. A session store** (`src/main/cloud/sessionStore.js`) that writes one file,
`userData/cloud-session.json`, through `fsSafe.writeFileAtomic`. The token is
`safeStorage.encryptString` output, base64; alongside it, plain JSON:
`serverUrl`, `deviceId`, `user`, `workspace`, `access`, `savedAt`. A stored
session whose `serverUrl` differs from the resolved address is treated as
absent, so a dev token never answers for a prod server or vice versa.

**4. A main-process session service** (`src/main/cloud/cloudSession.js`) that
owns one state machine and exposes `signIn`, `cancel`, `signOut`, `refresh`,
`getState`:

| state | UI copy | leaves on |
|---|---|---|
| `signedOut` | Sign in to Frame Cloud | Sign in → `requestingCode` |
| `requestingCode` | Starting sign-in… | 200 → `awaitingApproval` · error → `failed` |
| `awaitingApproval` | `TTN4-YFST` · Waiting for approval in your browser | token → `registering` · denied/expired/invalid_grant → `failed` · Cancel → `signedOut` |
| `registering` | Finishing sign-in… | 200 → `signedIn` · NO_WORKSPACE/error → `failed` (token discarded) |
| `signedIn` | account · workspace · plan label · this device | Sign out → `signedOut` · 401 → `signedOut` |
| `failed` | reason sentence + Try again | Try again → `requestingCode` |

Failure reasons: `denied`, `expired`, `network`, `rateLimited`, `noWorkspace`,
`storageUnavailable`. One sign-in attempt at a time; a second Sign in cancels
the first. HTTP goes through Electron's `net.fetch` (system proxy);
`verification_uri_complete` opens via `shell.openExternal`.

Server contract the service implements (all JSON, no Origin header, main
process only):

- `POST {API}/api/auth/device/code` `{client_id:"frame-desktop"}` →
  `{device_code, user_code, verification_uri, verification_uri_complete, expires_in: 900, interval: 5}`
- `POST {API}/api/auth/device/token`
  `{grant_type:"urn:ietf:params:oauth:grant-type:device_code", device_code, client_id}` →
  200 `{access_token, token_type:"Bearer", expires_in, scope}` or
  400 `{error}` with `authorization_pending | slow_down | access_denied | expired_token | invalid_grant`
- `POST {API}/trpc/device.register` (Bearer) `{name, os, appVersion}` →
  `{result:{data:{deviceId, user, workspace, access}}}`; idempotent per session
- `GET {API}/trpc/device.me` (Bearer) → `{result:{data:{user, workspace, device, access}}}`; moves `last_seen_at`
- `POST {API}/trpc/device.signOut` (Bearer) `{}` → `{result:{data:{ok:true}}}`
- tRPC errors `{error:{message, data:{code, httpStatus}}}`: 401 = token dead;
  412 `NO_WORKSPACE` or `DEVICE_NOT_REGISTERED`; 429 = rate limited
  (`/device/code` 10/min, `/device/token` 30/min)
- `access = {cloud: boolean, reason?: "no_plan" | "trial_ended", planLabel}`,
  recomputed on every call; `planLabel` ∈ Free · Pro · Team · Pro trial · Self-hosted

Response handling, fixed:

| response | Frame |
|---|---|
| `authorization_pending` | wait `interval`, ask again |
| `slow_down` | add 5 s to the interval (RFC 8628 §3.5), continue |
| `access_denied` | stop — "Sign-in was denied in the browser." |
| `expired_token`, `invalid_grant`, unknown | stop — "The code expired. Start again." |
| 429 / network error while polling | back off (double, cap 30 s) until `expires_in` elapses |
| 429 on `/device/code` | `failed` (`rateLimited`) |
| 401 on any bearer call | drop the local session silently → `signedOut`; no error dialog |
| 412 `DEVICE_NOT_REGISTERED` | call `device.register`, then retry once |
| 412 `NO_WORKSPACE` | `failed` (`noWorkspace`) — "Create a workspace on the web first" + link |
| network error on `me`/`signOut` | keep the stored session, show the last known data |

Device registration sends `name` = `os.hostname()` with a trailing `.local`
stripped, cut to 100 chars; `os` = `process.platform` + release; `appVersion`
from `package.json`.

`device.me` runs silently once at launch when a session exists, and each time
the Account section is shown. No periodic polling.

Sign out calls `device.signOut`, then deletes the local file whatever the
server said. If the server was unreachable, the Account copy says so: "Signed
out on this Mac. The server couldn't be reached, so the session there ends
within 30 days."

**5. IPC.** In `src/shared/ipcChannels.js`: `CLOUD_SIGN_IN`,
`CLOUD_CANCEL_SIGN_IN`, `CLOUD_SIGN_OUT`, `CLOUD_GET_STATE`, `CLOUD_REFRESH`
(invoke) and `CLOUD_SESSION_STATE` (push). The push payload is
`{ state, userCode?, verificationUrl?, user?, workspace?, access?, device?, reason?, serverUnreachable? }`
— never a token field. Handlers register in `src/main/index.js` beside the
existing `ipcMain.handle` block.

**6. Settings → Account**, a new section in the Frame Settings modal
(`index.html` `#frame-settings-overlay`, `src/renderer/frameSettingsModal.js`),
laid out like About. It renders the `CLOUD_SESSION_STATE` payload and carries
no logic of its own:

- `signedOut`: one sentence and **Sign in**.
- `awaitingApproval`: the code, large and monospaced; "Waiting for approval in
  your browser"; **Open browser again**; the verification URL shown as
  selectable text with a copy affordance (the web `/device` page has no code
  entry field, so a user whose browser failed to open needs the full URL);
  **Cancel**.
- `signedIn`: Account (name, email), Workspace (name, slug), Plan (`planLabel`
  as a chip, text only), This device (name, last seen); **Sign out**.
- `failed`: the reason's sentence and **Try again**.

**7. Command palette** entries `cloud.signIn` ("Frame Cloud: Sign in") and
`cloud.signOut` ("Frame Cloud: Sign out"), registered where `settings.open` is
(`src/renderer/index.js`). Sign in opens Frame Settings on Account and starts
the flow.

**8. PRIVACY.md** gains a Frame Cloud section: what leaves the machine on
sign-in (machine name, OS, app version — to the FrameCloud server the user
chose, not to Aptabase), where the token is stored, and that it never appears
in logs, the activity record or telemetry.

## Constraints

- **Frame never knows plans.** It reads `access.cloud` and displays
  `planLabel` as text; no `plan === 'pro'` comparison anywhere. Sign-in is open
  to every plan. Nothing in this spec reacts to `access.cloud === false` —
  the first feature that needs it is project linking, a later spec.
- **The local tool is not locked.** No launch modal, no sign-in nag, no "Pro"
  badge in the status bar or header, no feature gated on being signed in.
  Frame Cloud is reachable from Settings → Account and the palette, nowhere
  else.
- **The token never reaches the renderer.** Polling, every HTTP call and
  storage live in the main process; IPC returns the session minus the token.
  This is a convention the renderer's `nodeIntegration` cannot enforce, so the
  push payload is built by an explicit allowlist, not by deleting a field.
- **Token at rest is `safeStorage`-encrypted** in its own file under
  `userData` — never `user-settings.json`, never a project's `.frame/`. The
  token string is never logged (`logger.js` redaction), never in telemetry,
  never in the activity record.
- **Session lifetime is the server's business.** The device session slides 30
  days on use with no absolute cap and the token string never changes; Frame
  has no re-login reminder and no refresh-token logic. A 401 means the session
  is gone and Frame goes quietly to `signedOut`.
- **The user code is shown exactly as returned**, grouped `XXXX-XXXX` for
  reading only; the string sent to the server is untouched. The web approval
  page has no code entry field, so the browser URL is the only route.
- **Polling honours `interval`**, adds 5 s on `slow_down`, stops on
  `access_denied`, `expired_token`, `invalid_grant`, cancel, or when
  `expires_in` has elapsed. Never faster than the server asked.
- **The renderer only draws state** it received over `CLOUD_SESSION_STATE`.
  No duplicate state machine in the renderer; buttons invoke the IPC channels
  and wait for the next push.
- **Frame Settings rules hold** (settings-by-scope): the section re-reads on
  open (C3 — here, `CLOUD_GET_STATE` plus a `device.me` refresh), a section
  that fails to bind says so (C4), and the two settings surfaces still never
  stack (C1).
- **Telemetry registry rules hold**: no new telemetry event in this spec. If
  one is added later it carries only a result enum and a matching PRIVACY.md
  line (see Out of Scope).
- **The core is pure.** `deviceFlow.js` takes `fetchJson`, `sleep`, `now` and
  an `AbortSignal` from the caller and imports nothing from Electron, so
  `test/cloudDeviceFlow.test.js` runs under the existing
  `node --test test/*.test.js` with no Electron and no network.
- No new dependencies. No tRPC client — mutations are `POST /trpc/<name>`
  with the input as the body, queries are `GET /trpc/<name>`; there is no
  transformer.
- Cloud fetches must not hold the app: a hung server must not block startup,
  the settings modal or window close.

## Success Criteria

- When Frame starts with no `FRAME_CLOUD_URL`, no `cloudServerUrl` and no
  built-in default, then Frame Settings shows no Account section and no
  request is ever made.
- When `FRAME_CLOUD_URL=http://localhost:3777` is set and Frame Settings opens,
  then the Account section shows "Sign in to Frame Cloud" and a Sign in
  button.
- When Sign in is clicked, then within one round-trip the section shows an
  8-character code as `XXXX-XXXX`, the system browser opens
  `verification_uri_complete`, and `/device/token` is polled every `interval`
  seconds and not faster.
- When the user approves in the browser, then Frame calls `device.register`
  once, writes `cloud-session.json`, and the section shows the account name
  and email, the workspace name and slug, the `planLabel` chip and this
  device's name.
- When the user clicks Deny in the browser, then polling stops and the
  section reads "Sign-in was denied in the browser." with Try again.
- When the code's `expires_in` elapses without approval, or the server
  returns `expired_token` or `invalid_grant`, then polling stops and the
  section reads "The code expired. Start again." with Try again.
- When the server answers `slow_down`, then the next poll waits the previous
  interval plus 5 s.
- When Cancel is clicked during `awaitingApproval`, then polling stops and
  the section returns to `signedOut` with no file written.
- When Sign in is clicked while a sign-in is already waiting, then the first
  attempt's poll is aborted and only the new code is shown and polled.
- When `pnpm plan:set <slug> pro` runs on the server and the Account section
  is closed and reopened, then the chip reads Pro — with no plan comparison
  in Frame's code.
- When Frame relaunches with a stored session for the resolved server, then
  Account shows the stored data immediately and one silent `device.me`
  refreshes it; when the stored `serverUrl` differs from the resolved one,
  then Frame is `signedOut` and the file is ignored.
- When Sign out is clicked, then `device.signOut` is called, the local file
  is deleted, the section returns to `signedOut`, and a subsequent
  `device.me` with the old token gets 401.
- When Sign out is clicked while the server is unreachable, then the local
  file is still deleted and the section says the server session ends within
  30 days.
- When any bearer call returns 401, then the local session is dropped and
  Account shows `signedOut` with no error dialog.
- When `device.me` returns 412 `DEVICE_NOT_REGISTERED`, then Frame calls
  `device.register` and retries `me` once, transparently.
- When the renderer's `CLOUD_SESSION_STATE` payload is inspected in any
  state, then it has no `token` or `access_token` field, and
  `cloud-session.json` on disk holds no plaintext token.
- When `node --test test/cloudDeviceFlow.test.js` runs, then it passes with
  no Electron and no network, covering: pending → token, `slow_down` growth,
  denied, expired, `invalid_grant`, back-off on network error and 429,
  cancel, deadline, `formatUserCode`.
- When the palette runs "Frame Cloud: Sign in", then Frame Settings opens
  on the Account section with the flow started; "Frame Cloud: Sign out"
  signs out without opening the modal.
- When PRIVACY.md is read, then it names what sign-in sends, to whom, and
  where the token is kept.

## Out of Scope

- Project linking — `link.*`, the `cloud` block in `config.json`, `init`
  preserving it.
- The Pro panel and `PLAN_REQUIRED` handling — lands with the first Pro
  feature.
- Mirror sync of `.frame/`.
- Settings → Devices (listing, renaming, revoking other devices).
- A CLI sign-in.
- A `cloud_sign_in` telemetry event — deferred; if wanted it is a one-line
  registry + PRIVACY.md change with a result enum.
- A production default server address (see Open Questions).

## Open Questions

- **`safeStorage` unavailable** (`isEncryptionAvailable()` false — Linux
  without a keyring). Options: (a) keep the session in memory only for this
  launch and tell the user in Account: "Your system has no secure storage, so
  you'll sign in again next launch" — recommended; (b) write the token in
  plaintext; (c) disable sign-in on that machine.
- **Packaged default server address.** No FrameCloud is deployed yet.
  Options: (a) default empty, Account hidden in packaged builds, developers
  set `FRAME_CLOUD_URL` — recommended, and a prod address is a one-line
  change once FrameCloud ships; (b) ship a prod URL now and show "server
  unreachable" until it exists.
