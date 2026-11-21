# Plan — Frame Cloud early access

## Architecture

### Resolved plan-time decisions

**Business, asked (2026-09-30):**

- **D1 · Other sign-in entry points.** Chosen: Settings → Account and Project
  Settings open the Frame Cloud window instead of starting sign-in. Rejected:
  keep starting sign-in directly. Rationale: from those buttons an uninvited
  person would be sent to GitHub without ever seeing the waitlist.
- **D2 · Where the waitlist form lives.** Chosen: an in-app form in the Frame
  Cloud window. Rejected: only a link to frame.cool. Rationale: the user joins
  without leaving Frame. The spec was updated to match.
- **D3 · Where the form submits** (follows from D2). Chosen: a public
  FrameCloud mutation `waitlist.join`, shared with frame.cool. Rejected:
  - the frame.cool form's own service, which would embed a third-party address
    in Frame and split the list;
  - opening frame.cool with the email prefilled, which is not an in-app
    submission.

  Rationale: one list, and the invite script reads the same table. The user
  answered "devam" to the recommendation, and FrameCloud built it as its own
  `waitlist` spec (see Dependencies).

**Technical, asked:**

- **D4 · What turns early access on and off.** Chosen: read FrameCloud's
  existing public `invite.mode` query. Rejected: a constant in Frame.
  Rationale: when the server flag goes off, Frame follows with no release, and
  older Frame builds do not keep advertising a waitlist.
- **D5 · Test posture.** Chosen: pure logic only. This is the project's
  convention (Testing record: pure renderer modules and `src/main/` cores). It
  covers the copy module and the two new `deviceFlow.js` calls. The Electron
  wrapper (`cloudSession.js`) and the DOM (`cloudHub.js`, the settings modals)
  stay untested.

**Decided silently:**

- **D6 · The `waitlist.join` contract.**
  - Input: `{ email, source: 'desktop' }`. The result is always `{ ok: true }`,
    so a caller cannot learn whether an address was already on the list.
  - Failure mapping in Frame:
    - `BAD_REQUEST` → `invalid`;
    - `TOO_MANY_REQUESTS` → `rateLimited`;
    - transport failure or 5xx → `network`;
    - a server without the procedure (404, or `NOT_FOUND` from tRPC) →
      `unavailable`.
- **D7 · Email check in main.** Frame normalizes the address the way the
  server does (FrameCloud `normalizeWaitlistEmail`: trimmed, lowercased as a
  whole). It accepts the address only if it:
  - is at most 254 characters (`WAITLIST_EMAIL_MAX`);
  - has one `@`, a non-empty local part and a dotted domain.

  The server validates again, and a `BAD_REQUEST` still maps to `invalid`.

  The renderer only disables Join while the field is empty. Main is the check
  that counts, because the renderer is untrusted (frame-cloud-sign-in rule).
- **D8 · Joined state is remembered in main.** On success, main writes the
  address to user settings (`cloudWaitlistEmail`) and publishes it in the
  session state.
  - "Use another address" only shows the form again in the renderer. A new
    join overwrites the address; there is no separate clear action.
- **D9 · `inviteOnly` and `waitlistEmail` live beside `state`, not in it.** They
  sit in module variables, the same way `webOrigin` already does, so every
  `setState({ state: 'signedOut', … })` keeps them. `toPublicState` adds them
  while not signed in. `PUBLIC_KEYS` stays an allowlist.
- **D10 · When `invite.mode` is read.**
  - At startup, when the stored session is absent (signed out).
  - In `refresh()` whenever not signed in. The window's `onOpen` now calls
    `CLOUD_REFRESH` in every state; today it calls it only when signed in.
  - Concurrent reads share one request. A failed read leaves the last value,
    and `null` (never read) means today's pane.
- **D11 · Failed → signed out.**
  - `cancel()` also moves `failed` to `signedOut`. Today it returns early
    without a running attempt.
  - The failed pane's "Join the waitlist" uses it, and so reaches the form
    without a new IPC channel.
- **D12 · The fallback link.**
  - The copy module holds `WAITLIST_URL = 'https://frame.cool/early-access'`,
    the same constant FrameCloud's web uses (FrameCloud early-access plan D13).
  - It is shown only when joining in-app fails (`network`, `unavailable`,
    `rateLimited`), as "Join on frame.cool ↗".
  - It is opened with `shell.openExternal`.
- **D13 · No git-config prefill.** The user types the address. This keeps the
  form simple and sends nothing Frame read on its own.
- **D14 · Entry points always open the window** (D1). The behaviour does not
  depend on `inviteOnly`, because Settings can be opened before `invite.mode`
  was ever read.
  - Settings → Account's signed-out button reads "Open Frame Cloud".
  - Project Settings' signed-out row says "Frame Cloud is in early access."
    when `inviteOnly` is true, otherwise today's sentence. Its button is
    "Open Frame Cloud".
  - The palette's `cloud.signIn` is unchanged.
- **D15 · Copy.** All new strings are English, from the artifact, in one pure
  module `cloudEarlyAccess.js`. The awaiting hint and the expired message
  appear only when `inviteOnly` is true, so an open server shows today's words.
  - The awaiting hint points at "Open browser again" (FrameCloud evidence). A
    person refused on `/device` can open the invite link, and then approve the
    same code before it expires, without restarting sign-in:
    - the refusal keeps `redirect` (`login.tsx` `errorCallbackURL`);
    - the code stays unapproved.

- **D16 · The sign-in button's words (asked, 2026-09-30).** Chosen: "Continue
  with GitHub", the web `/login` button's wording, in both the early-access
  pane and today's classic pane (`index.html`'s signed-out button). Rejected:
  keep "Sign in with GitHub". Rationale: one wording across web and desktop.
  - The palette's "Frame Cloud: Sign in" command title is unchanged.
  - The failed pane's "Try again" is unchanged.

### Main: two tokenless calls

`src/main/cloud/deviceFlow.js` (pure core):

- `fetchInviteMode({ api, fetchJson, signal })` calls `callTrpc` GET
  `invite.mode` with no token, and returns `true`, `false` or `null`. It
  answers `null` for a malformed answer or `NOT_FOUND`, meaning an older
  server. Other failures throw a `CloudError`.
- `normalizeWaitlistEmail(raw)` returns the address, or `null` (D7).
- `joinWaitlist({ api, email, fetchJson, signal })` returns `{ ok: true }` or
  `{ ok: false, reason }`. It never throws. It calls `callTrpc` POST
  `waitlist.join` with `{ email, source: 'desktop' }` and no token, and maps
  failures per D6.

`src/main/cloud/cloudSession.js`:

- Module variables `inviteOnly = null` and `waitlistEmail`. `waitlistEmail` is
  read from `userSettings.get('cloudWaitlistEmail')` at `loadSession`.
- `readInviteMode()` shares one request between callers. It sets `inviteOnly`
  and publishes, and a failure leaves the last value.
  - It is called from `loadSession` in the signed-out branch.
  - It is called from `refresh()` when not signed in; the signed-in path is
    unchanged.
- `joinWaitlist(rawEmail)`:
  - Returns `{ ok: false, reason: 'invalid' }` when normalization fails.
  - Otherwise it calls the core. On `ok` it stores the address, sets
    `waitlistEmail` and publishes.
  - It returns `{ ok, reason }` to the renderer.
- `toPublicState` adds `inviteOnly` and `waitlistEmail` while
  `state.state !== 'signedIn'`, and `PUBLIC_KEYS` lists both.
- `cancel()` handles `failed` → `signedOut` (D11).
- `setupIPC` registers `CLOUD_JOIN_WAITLIST`: renderer → main (invoke), email in,
  `{ ok, reason }` out.

`src/shared/ipcChannels.js`: adds `CLOUD_JOIN_WAITLIST`.

### Renderer: the early-access pane

`src/renderer/cloudEarlyAccess.js` (**New**, pure, no DOM or Electron):

- `WAITLIST_URL`.
- `COPY`:
  - `title`: "Frame Cloud is in early access".
  - `lede`: "Join the waitlist and we'll email you an invite link."
  - `emailLabel`: "Email".
  - `join`: "Join the waitlist".
  - `alreadyInvited`: "Already invited?".
  - `signIn`: "Continue with GitHub".
  - `joinedTitle`: "You're on the list".
  - `joinedBody(email)`: "We'll email {email} when your invite is ready."
  - `useAnother`: "Use another address".
  - `awaitingHint`: "Browser says you're not in yet? Open the link in your invite email, then press Open browser again. No invite yet? Join the waitlist."
  - `expired`: "The code expired. Frame Cloud is invite-only for now: open your invite link first, or join the waitlist."
  - `joinWaitlistAction`: "Join the waitlist".
  - `openCloud`: "Open Frame Cloud".
  - `settingsRowEarly`: "Frame Cloud is in early access."
  - `fallbackLink`: "Join on frame.cool".
- `joinFailure(reason)` returns `{ message, showFallback }`:
  - `invalid` → "Enter a full email address, like ada@example.com." with no
    fallback;
  - `rateLimited` → "Too many tries. Wait a minute, or join on frame.cool."
    with the fallback;
  - `unavailable` and `network` → "Couldn't reach Frame Cloud. You can join on
    frame.cool instead." with the fallback.
- `paneMode(state)` returns `'classic' | 'form' | 'joined'`:
  - `inviteOnly !== true` → `classic`;
  - `waitlistEmail` set → `joined`;
  - otherwise → `form`.

`index.html`, inside the welcome layout's signed-out pane:

- The existing heading, text, button and steps get a wrapper `#cloud-classic`.
  Its button reads "Continue with GitHub" (D16).
- It is followed by a new `#cloud-early` block with:
  - `#cloud-early-form`, containing a `<form>` with `input#cloud-waitlist-email`
    (type email), a Join button, `#cloud-waitlist-error` and
    `#cloud-waitlist-fallback`;
  - `#cloud-early-joined`, containing the title, `#cloud-waitlist-joined-body`
    and the "Use another address" link;
  - the "Already invited? Continue with GitHub" line, whose button keeps
    `data-cloud-action="signIn"`.
- The awaiting pane gets `<p data-cloud-note="inviteHint" hidden>`.
- The failed pane gets
  `<button data-cloud-action="joinWaitlist" id="cloud-failed-waitlist" hidden>`.

`src/renderer/cloudHub.js`:

- `renderSession`:
  - Signed out: `paneMode(s)` toggles `#cloud-classic`, `#cloud-early-form` and
    `#cloud-early-joined`, and fills the joined body. A renderer-local
    `showFormAgain` flag (set by "Use another address", cleared on join) forces
    the form.
  - Awaiting: the `inviteHint` note shows when `s.inviteOnly === true`.
  - Failed: when `s.reason === 'expired'` and `s.inviteOnly === true`, the reason
    text comes from `COPY.expired` and `#cloud-failed-waitlist` shows.
- Actions:
  - `joinWaitlist` invokes `CLOUD_CANCEL_SIGN_IN`, which D11 extends to leave
    `failed`.
  - The form's submit calls `preventDefault` and invokes `CLOUD_JOIN_WAITLIST`
    with the field's value. The button is disabled while the call runs. On
    `ok: false` it shows `joinFailure(reason)`; the fallback opens
    `WAITLIST_URL` via `shell.openExternal`.
- `onOpen` invokes `CLOUD_REFRESH` whatever the state (D10).
- Every string goes in with `textContent`.

`src/renderer/frameSettingsModal.js` (D14):

- The signed-out label is "Open Frame Cloud".
- The click handler calls `cloudHub.open()` in both states.

`src/renderer/projectSettingsModal.js` (D14): the signed-out branch uses
`COPY.settingsRowEarly` when `session.inviteOnly === true`, and an "Open Frame
Cloud" button that calls `openHub()`.

`src/renderer/styles/components/cloud-hub.css`: styles for the email field,
the inline error, the fallback link and the joined card, in the existing
`cloud-signin-*` tokens and spacing.

## Files

- `src/main/cloud/deviceFlow.js` — **Modified.** `fetchInviteMode`, `normalizeWaitlistEmail`, `joinWaitlist`, exported.
- `src/main/cloud/cloudSession.js` — **Modified.** `inviteOnly`/`waitlistEmail` beside state, `readInviteMode`, `joinWaitlist`, signed-out `refresh()`, `cancel()` from `failed`, `CLOUD_JOIN_WAITLIST` handler.
- `src/shared/ipcChannels.js` — **Modified.** `CLOUD_JOIN_WAITLIST`.
- `src/renderer/cloudEarlyAccess.js` — **New.** Pure copy, `WAITLIST_URL`, `joinFailure`, `paneMode`.
- `src/renderer/cloudHub.js` — **Modified.** Early-access pane modes, join submit, awaiting hint, expired message and action, `onOpen` refresh in every state.
- `index.html` — **Modified.** `#cloud-classic` wrapper, `#cloud-early` block, `inviteHint` note, `#cloud-failed-waitlist` button.
- `src/renderer/styles/components/cloud-hub.css` — **Modified.** Form, error, fallback and joined-card styles.
- `src/renderer/frameSettingsModal.js` — **Modified.** Signed-out button opens the window.
- `src/renderer/projectSettingsModal.js` — **Modified.** Signed-out row copy and "Open Frame Cloud".
- `test/cloudDeviceFlow.test.js` — **Modified.** `fetchInviteMode`, `normalizeWaitlistEmail`, `joinWaitlist` with a scripted fetch.
- `test/cloudEarlyAccess.test.js` — **New.** `paneMode`, `joinFailure`, `joinedBody`, and a guard that no string names a plan, trial, price or "Pro".

## Footprint

- src/main/cloud/deviceFlow.js
- src/main/cloud/cloudSession.js
- src/shared/ipcChannels.js
- src/renderer/cloudEarlyAccess.js
- src/renderer/cloudHub.js
- index.html
- src/renderer/styles/components/cloud-hub.css
- src/renderer/frameSettingsModal.js
- src/renderer/projectSettingsModal.js
- test/cloudDeviceFlow.test.js
- test/cloudEarlyAccess.test.js

## Dependencies

Both calls exist on FrameCloud's `feat/early-access` branch, which is not yet
merged into FrameCloud `main`. The walk runs against that branch.

- **`invite.mode`**: FrameCloud spec `early-access`
  (`apps/server/src/routers/invite.ts`). Public, no input, answers
  `{ inviteOnly }`.
- **`waitlist.join`**: FrameCloud spec `waitlist`
  (`apps/server/src/routers/waitlist.ts`).
  - Public. Takes `{ email, source: 'site' | 'desktop' | 'web' }` and always
    answers `{ ok: true }`.
  - A malformed email is `BAD_REQUEST`.
  - The limit is 10 calls per 10 minutes per IP (`TOO_MANY_REQUESTS`).
  - Frame calls it from main, where CORS does not apply.
- No packages.

## Sequencing

1. **The two calls in the core.**
   - In `deviceFlow.js`, add `fetchInviteMode`, `normalizeWaitlistEmail` and
     `joinWaitlist`, and export them.
   - In `test/cloudDeviceFlow.test.js`, cover:
     - mode `true`, `false`, malformed → `null`, and 404 → `null`;
     - that no call carries a token;
     - email normalization: trim, length, shape;
     - `joinWaitlist`'s body (`source: 'desktop'`) and each failure reason from
       D6.
2. **The session keeps invite mode and the joined address.**
   - In `cloudSession.js`:
     - add the module variables, `readInviteMode`, `joinWaitlist`, the
       signed-out branch of `refresh()`, the `loadSession` read and
       `toPublicState`/`PUBLIC_KEYS`;
     - extend `cancel()` to leave `failed`;
     - register `CLOUD_JOIN_WAITLIST`.
   - Add the channel to `ipcChannels.js`.
3. **The copy.** Write `cloudEarlyAccess.js` and
   `test/cloudEarlyAccess.test.js`.
4. **The signed-out pane.**
   - `index.html`: the `#cloud-classic` wrapper and the `#cloud-early` block.
   - `cloudHub.js`:
     - `paneMode` rendering and "Use another address";
     - the form submit through `CLOUD_JOIN_WAITLIST`, the inline error and the
       frame.cool fallback;
     - `onOpen` refresh in every state.
   - `cloud-hub.css`: the form, error, fallback and joined card.
5. **Waiting and expired.**
   - `index.html`: the `inviteHint` note and `#cloud-failed-waitlist`.
   - `cloudHub.js`: show them when `inviteOnly` is true, use `COPY.expired`, and
     wire `joinWaitlist` to `CLOUD_CANCEL_SIGN_IN`.
6. **Entry points.**
   - `frameSettingsModal.js`: the signed-out button opens the window.
   - `projectSettingsModal.js`: the signed-out row copy and "Open Frame Cloud".
7. **Walk it.** Record the walk in `outcome.md`.
   - Prerequisites:
     - FrameCloud's dev server runs on `feat/early-access` with
       `INVITE_ONLY=true` in `.env.local`. It was removed after FrameCloud's
       own walk.
     - A GitHub account with no FrameCloud user. The dev database already
       holds BerkayYilmaz11: delete it, or use a second account.
     - One invite from `pnpm invite:create --email`.
   - Check:
   - The form joins, and the card survives a reopen.
   - A bad address and a stopped server show the error and the fallback.
   - "Sign in" without an invite waits with the hint, and "Join the waitlist"
     after expiry returns to the form.
   - Settings and Project Settings open the window.
   - With `INVITE_ONLY` off, the pane is today's.
   - An invited sign-in ends signed in.
