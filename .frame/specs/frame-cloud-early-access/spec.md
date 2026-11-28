---
keywords: frame cloud, early access, invite only, waitlist, sign-in, device flow, join the waitlist
related: frame-cloud-sign-in, frame-cloud-no-workspace
---

# Frame Cloud early access

## Problem

Frame Cloud opens invite-only. FrameCloud's `early-access` spec makes the
server create an account only when the sign-in carries a valid invite token
from `/beta-access/<token>`. Anyone else who signs in with GitHub is refused
on the web (`/login?error=not_invited`).

Frame's Frame Cloud window does not know any of this. It offers only "Sign in
with GitHub", so a person who is not invited is sent into a GitHub sign-in that
cannot succeed. Worse, Frame never learns about the refusal: the refusal happens
in the browser, and the device code simply stays unapproved. The window keeps
showing "Approve in your browser… Waiting for approval…" until the code expires
15 minutes later.

Source: the "Erken Erişim Akışı" page (artifact, 2026-09-29, v3), its **Frame**
row. The server and web side ship as FrameCloud's `early-access` spec.

## Goal

When the server is invite-only, the Frame Cloud window's signed-out pane leads
with the waitlist and keeps sign-in for people who already have an invite or an
account:

- **Signed out, invite-only:**
  - The heading says Frame Cloud is in early access.
  - An in-app form takes an email and joins the waitlist, without leaving Frame.
  - After joining, the pane shows "You're on the list" with the address, and
    remembers it on this machine.
  - **Continue with GitHub** (the web's wording) stays, under the line "Already invited?".
- **Waiting for approval, invite-only:** one line says what to do when the
  browser says "You're not in yet": open the invite email's link first, or join
  the waitlist.
- **Code expired, invite-only:** the message names the same cause, and a
  "Join the waitlist" action returns to the form.
- **Other sign-in entry points:**
  - Settings → Account and Project Settings open the Frame Cloud window instead
    of starting sign-in, so the waitlist is seen first.
  - The palette's explicit "Frame Cloud: Sign in" still starts sign-in.
- **Server not invite-only, or unreachable:** the window is today's.
- Nothing changes once signed in (including the no-workspace panel).

## Constraints

- **Two calls, both without a token:**
  - `invite.mode` already exists (FrameCloud `early-access`) and tells Frame
    whether to show early access.
  - `waitlist.join({ email, source: 'desktop' })` is new. FrameCloud has to add
    it as a public, rate-limited mutation that always gives the same answer.
  - `device.*` contracts do not move.
- **Refusal still happens only on the web.** The desktop cannot tell a refused
  sign-up from an unapproved code, so the copy states both possibilities
  without claiming which one happened.
- **frame-cloud-sign-in's state machine holds.** The states, polling and token
  handling are unchanged. The one addition: leaving `failed` back to
  `signedOut`.
- **The token never reaches the renderer.** Calls are made in main, and the
  renderer only sends the typed email (frame-cloud-sign-in rule).
- **Plan Model rule:** no modal on launch, no badge, no prompt outside the
  Frame Cloud window the user opened. Local Frame is untouched.
- **The window stays hidden in builds without a server URL**
  (`DEFAULT_CLOUD_SERVER_URL` is empty), as today.
- **Copy:** English, from the artifact, in one pure copy module. The sign-in button reads "Continue with GitHub", as on the web's `/login`.
- **The layer is removable from the server.** When `invite.mode` answers
  `inviteOnly: false`, Frame shows today's pane, with no Frame release.
- **Tests stay on pure modules** (copy, `deviceFlow.js` calls) with
  `node --test`.

## Success Criteria

- When the window is open, signed out and `invite.mode` answers `inviteOnly:
  true`, then the pane shows the early-access heading, the email form and
  "Already invited? Continue with GitHub".
- When a valid email is submitted, then `waitlist.join` is called once with
  `source: 'desktop'`, and the pane shows "You're on the list" with that
  address. It still shows it after the window or Frame is reopened.
- When the email is malformed or the server cannot be reached, then the form
  stays, says why in one line, and offers the frame.cool waitlist page as a way
  out.
- When "Continue with GitHub" is pressed, then sign-in starts exactly as today. The classic pane's button reads the same.
- When sign-in is waiting for approval in invite-only mode, then one line names
  the invite link and the waitlist.
- When the device code expires in invite-only mode, then the message mentions
  the invite, and "Join the waitlist" returns to the signed-out pane.
- When Settings → Account's or Project Settings' button is pressed while
  signed out, then the Frame Cloud window opens on its signed-out pane, and
  sign-in does not start.
- When `invite.mode` answers `inviteOnly: false` or cannot be read, then the
  signed-out pane is identical to today's.
- When an invited person or an existing account signs in, then everything after
  sign-in behaves as it does today.

## Out of Scope

- Server and web: invite tokens, the sign-up check, `/beta-access`, `/login` copy (FrameCloud `early-access`)
- The `waitlist.join` endpoint itself (FrameCloud; a dependency of this spec)
- The frame.cool waitlist form (FrameWeb)
- Detecting a refused sign-up on the desktop (would need a server contract change)
- Workspace invitations as a second way in (future workspace-invite specs)
- Early-access perks: free period, workspace size (plan layer)
