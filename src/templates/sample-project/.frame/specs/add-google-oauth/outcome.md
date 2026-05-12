# Outcome — Add Google OAuth login

Captured per-task by `/spec.implement`. 2-3 sentences each, written
while the agent's memory was fresh. Skim this six months from now and
you'll remember why the code looks the way it does.

---

## T1 — Add migration for google_id + google_refresh_token columns

Wrote `003_google_oauth.sql`. Added a unique partial index on `google_id`
(WHERE NOT NULL) so multiple rows can sit with NULL during the rollout.
Tested rollback locally; works clean.

## T2 — Run migration in dev; verify roll-back works

Migration applied to dev DB. Rollback verified — `DROP COLUMN` works
because we hadn't added FKs that reference google_id. Noted: production
backfill should run inside a transaction to avoid partial state.

## T3 — Provision OAuth client in Google Cloud + add env credentials

Created prod + dev OAuth clients in Google Cloud Console. Dev client
allows `http://localhost:5173` as authorized origin. Credentials in
`.env.example` (placeholder); real values in 1Password vault.

## T4 — Install passport-google-oauth20 dependency

Installed at v2.0.0. Pinned exact version because the strategy's
profile shape has shifted across majors and we want a known-good baseline.

## T5 — Implement src/auth/oauth.js Passport strategy

Implemented `googleStrategy` + `configureOAuth(app)` helper. Find-or-
create logic ended up cleaner as a single SQL upsert with a partial
index than the if/else tree in the plan — diverged from plan here. Spec
plan should be updated next time we do similar.

## T6 — Wire oauth into Express app + session middleware

Mounted `passport.initialize()` and `passport.session()` after
`sessionMiddleware`. Order matters — Passport needs the session to
exist before it can hydrate the user. Added a comment in
`src/auth/session.js` flagging this.

## T7 — Add /auth/google/start + /auth/google/callback routes

Routes added in `src/auth/oauth.js`. Used `failureRedirect: '/login?
error=oauth'` to surface failed attempts to the UI. UI side (showing
the error toast) wasn't in this spec — followup task created: task-020.

## T8 — End-to-end test: full OAuth round-trip

E2E test passes in CI. Mocked Google's consent + token endpoints with
`nock`. Test covers: success path, denied consent, expired code,
email-merge-with-existing-account. Coverage uneven on the merge case
because the partial-index logic is hard to assert from the outside —
followed up with unit tests inside `oauth.js` directly.

---

**Spec shipped 2026-02-22.** Total elapsed: 4 days. Estimated 3. The
extra day went to the consent-screen UX polish (not in tasks but the
team noticed it was ugly).
