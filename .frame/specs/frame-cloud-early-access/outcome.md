# Outcome — Frame Cloud early access

## T01 — The two calls in the core

Added `fetchInviteMode`, `normalizeWaitlistEmail`, `joinWaitlist` and `WAITLIST_EMAIL_MAX` to `src/main/cloud/deviceFlow.js`. Both calls go through `callTrpc` with no token. `fetchInviteMode` answers `null` for a malformed answer or a 404; `joinWaitlist` maps failures by status (400 invalid, 404 unavailable, 429 rateLimited, else network) and never throws. 8 new tests in `test/cloudDeviceFlow.test.js`.

_Captured: 2026-09-30 · 2 file change(s)_

---

## T02 — The session keeps invite mode and the joined address

Added module-level `inviteOnly`/`waitlistEmail` and a shared-request `readInviteMode()` to `src/main/cloud/cloudSession.js`. The mode is read from `loadSession`'s signed-out branch and from `refresh()` whenever not signed in; both fields reach the renderer only while not signed in, and `inviteOnly` resets when the server address changes. Beyond the plan: `waitlistEmail` is re-read from user settings on every `loadSession`, not only at startup.

_Captured: 2026-09-30 · 1 file change(s)_

---

## T03 — Join the waitlist from main

Added `CLOUD_JOIN_WAITLIST` to `src/shared/ipcChannels.js` and `joinWaitlist(rawEmail)` to `src/main/cloud/cloudSession.js`. It normalizes the address (`invalid` on failure), answers `unavailable` with no server URL, calls the core, and on success stores `cloudWaitlistEmail`, sets `waitlistEmail` and publishes. The handler is registered in `setupIPC` and the function exported. No deviation from plan.md.

_Captured: 2026-09-30 · 2 file change(s)_

---

## T04 — The copy

Wrote `src/renderer/cloudEarlyAccess.js` (`WAITLIST_URL`, `COPY`, `joinedBody`, `joinFailure`, `paneMode`) and `test/cloudEarlyAccess.test.js` (6 tests). `paneMode` leads with the waitlist only on an explicit `inviteOnly: true`, and `unavailable` shares `network`'s message. `joinedBody` is exported beside `COPY` instead of inside it, and `COPY` gained an `emailPlaceholder`.

_Captured: 2026-09-30 · 2 file change(s)_

---

## T05 — The signed-out pane

Wrapped today's signed-out content in `#cloud-classic`, with the button relabelled "Continue with GitHub". Added the `#cloud-early` block (form, joined card, "Already invited? Continue with GitHub") to `index.html`, and its styles to `cloud-hub.css`, reusing `cloud-input-box`. In `src/renderer/cloudHub.js`, `initEarlyAccess()` fills the words from `cloudEarlyAccess.js`, `renderEarlyAccess()` switches between classic, form and joined (with a renderer-local "Use another address" flag), and `onOpen` refreshes in every state except `unavailable`. The form's submit comes in T06.

_Captured: 2026-09-30 · 3 file change(s)_

---

## T06 — Wire the waitlist form

Wired the form in `src/renderer/cloudHub.js`: submit → `CLOUD_JOIN_WAITLIST`, with Join disabled while the field is empty or a join is pending. A failure shows `joinFailure`'s line in `#cloud-waitlist-error`, plus the "Join on frame.cool ↗" fallback when it applies, and typing clears the error. On success the joined card appears from main's push. `index.html` gained the error line and the fallback button, and `cloud-hub.css` the error style.

_Captured: 2026-09-30 · 3 file change(s)_

---

## T07 — Waiting and expired

Extended `cancel()` in `src/main/cloud/cloudSession.js` so that `failed` goes back to `signedOut`. Added the `inviteHint` line to the awaiting pane and a hidden "Join the waitlist" button to the failed pane in `index.html`. `src/renderer/cloudHub.js` shows the hint while waiting and, after an expired code, shows `COPY.expired` and the button; both appear only when `inviteOnly` is true. The button's `joinWaitlist` action reuses `CLOUD_CANCEL_SIGN_IN`. No deviation from plan.md.

_Captured: 2026-09-30 · 3 file change(s)_

---

## T08 — Entry points open the window

Settings → Account's signed-out button (`src/renderer/frameSettingsModal.js`) now reads "Open Frame Cloud" and opens the window. The Project Settings row (`src/renderer/projectSettingsModal.js`) says "Frame Cloud is in early access." when the server is invite-only, and its "Open Frame Cloud" button opens the window. Neither starts sign-in any more, and the palette's "Frame Cloud: Sign in" is unchanged. No deviation from plan.md.

_Captured: 2026-09-30 · 2 file change(s)_

---

## T09 — Walk it

Walked by the user in the dev build against FrameCloud's `feat/early-access` dev server, and reported as working. The report named no individual checks, so the walk is recorded as a whole, not item by item from the plan's list. No code changed.

_Captured: 2026-09-30 · 0 file change(s)_

---

