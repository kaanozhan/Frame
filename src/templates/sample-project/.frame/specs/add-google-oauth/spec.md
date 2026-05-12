# Add Google OAuth login

## Why

Users currently sign in with email + password, stored in our own DB.
Operating an auth system (rate limits, password resets, MFA, account
recovery) is real engineering cost we don't want to carry. We want users
to click "Sign in with Google" and never see a password prompt.

## What's in scope

- Google as the **only** new provider in v1 (not GitHub, not Microsoft —
  see PROJECT_NOTES 2026-02-19)
- New users created automatically on first login
- Existing email/password users can link a Google account; if their
  Google email matches an existing account, the accounts are merged
- Session model unchanged — Google login just creates a session

## What's out of scope

- Other providers (GitHub, GitLab, Microsoft, etc.)
- Removing the email/password path (still needed for users without
  Google accounts)
- SSO / SAML — separate concern, enterprise-only

## Success criteria

- `/auth/google/start` redirects to Google's consent screen
- `/auth/google/callback` exchanges the code, fetches the profile,
  finds-or-creates the user, sets the session, redirects to the dashboard
- End-to-end test passes in CI: full round-trip from start → consent
  (mocked) → callback → authenticated request
- No production secrets in the repo
