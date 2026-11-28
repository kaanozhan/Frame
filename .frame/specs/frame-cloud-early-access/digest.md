---
keywords: frame cloud, early access, invite only, waitlist, waitlist.join, invite.mode, sign-in, continue with github
related: frame-cloud-sign-in, frame-cloud-no-workspace
---
When FrameCloud is invite-only (its public `invite.mode`, read tokenless from main), the Frame Cloud window's signed-out pane leads with an in-app waitlist form. The form posts to FrameCloud's public `waitlist.join({ email, source: 'desktop' })` (spec `waitlist`), and "Already invited? Continue with GitHub" sits below it. A successful join is remembered in user settings (`cloudWaitlistEmail`), and the pane shows "You're on the list" after that. A server that is open, unreachable or older shows today's pane.
The desktop cannot see a refused sign-up: the web refuses it (`/login?error=not_invited`) and the device code stays unapproved. So the waiting pane says, only when invite-only, to open the invite link and press Open browser again, which approves the same code once the account exists. An expired code offers "Join the waitlist", which goes back to the form through `cancel()` (now also failed → signedOut).
Settings → Account and Project Settings open the window instead of starting sign-in. The palette's explicit "Frame Cloud: Sign in" still signs in. The sign-in button reads "Continue with GitHub", as on the web.
Why this path: a Frame constant was rejected for the on/off switch because removal would need a Frame release; the server's `invite.mode` switch needs none. A link-only waitlist was rejected by the user in favour of the in-app form. Posting to frame.cool's form service was rejected: one list lives in FrameCloud, and the invite script reads it.
Rules: `inviteOnly`/`waitlistEmail` live beside `state` in `cloudSession.js`, like `webOrigin`, and reach the renderer only while signed out. Email normalization matches FrameCloud's (trim, lowercase as a whole, ≤254). All early-access words live in `src/renderer/cloudEarlyAccess.js`. Removal: once FrameCloud answers `inviteOnly: false`, the pane is today's with no Frame change. Deleting the module, the `#cloud-early` block and the two calls removes the rest.

Chain: spec.md → plan.md → tasks.md → outcome.md
