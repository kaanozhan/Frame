# Tasks — Add Google OAuth login

- [x] T1 — Add migration for google_id + google_refresh_token columns
- [x] T2 — Run migration in dev; verify roll-back works
- [x] T3 — Provision OAuth client in Google Cloud + add env credentials
- [x] T4 — Install passport-google-oauth20 dependency
- [x] T5 — Implement src/auth/oauth.js Passport strategy
- [x] T6 — Wire oauth into Express app + session middleware
- [x] T7 — Add /auth/google/start + /auth/google/callback routes
- [x] T8 — End-to-end test: full OAuth round-trip
