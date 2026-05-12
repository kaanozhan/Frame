# Plan — Add Google OAuth login

## Architecture

- Use Passport.js with `passport-google-oauth20` strategy. Passport
  handles the OAuth dance; we own user lookup/creation and session
  attachment.
- New columns on `users`: `google_id` (unique, nullable),
  `google_refresh_token` (nullable). Existing rows untouched.
- OAuth credentials live in env (`GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`). Local dev uses a separate test client.

## Sequence (happy path)

1. User clicks "Sign in with Google" → browser hits `/auth/google/start`
2. Backend redirects to Google's consent screen with our client_id +
   redirect_uri + scopes (`openid email profile`)
3. User consents → Google redirects to `/auth/google/callback?code=...`
4. Passport strategy exchanges the code for tokens + profile
5. Find-or-create user in DB:
   - If `users.google_id` matches → log them in
   - Else if `users.email` matches a row → set `google_id` on that row
     and log them in (account link)
   - Else create new user row with email + google_id
6. Establish session via `req.login(user)`
7. Redirect to `/dashboard`

## Risks + mitigations

- **Account hijack via email collision.** Mitigation: only merge by
  email if the existing user has never set a password (i.e., placeholder
  account). For real password-set users, require an authenticated link
  flow instead. v1 ships without this — flagged for follow-up.
- **Refresh token leakage.** Mitigation: encrypt at rest using the
  application key. Decrypt only when needed. Never log raw tokens.

## Files touched

- New: `src/auth/oauth.js`, `src/db/migrations/003_google_oauth.sql`
- Modified: `src/auth/session.js` (serialize/deserialize hooks),
  `src/api/server.js` (mount routes)
- Tests: `src/auth/oauth.test.js`

## Rollback

The migration is reversible (`DROP COLUMN google_id, google_refresh_token`).
The OAuth routes can be unmounted with one commit. Existing password
login is unaffected throughout.
