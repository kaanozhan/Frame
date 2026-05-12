/**
 * Google OAuth — Passport strategy + routes
 *
 * Shipped via spec `.frame/specs/add-google-oauth/`. The find-or-create
 * logic is a single SQL upsert (diverged from plan — see outcome.md T5).
 *
 * NOT provider-abstracted on purpose. When we add a second provider,
 * refactor — not before. See PROJECT_NOTES 2026-02-19.
 */

const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { query } = require('../db/client');

function googleStrategy() {
  return new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      callbackURL: '/auth/google/callback'
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateUser(profile);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  );
}

async function findOrCreateUser(profile) {
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  if (!email) throw new Error('Google profile missing email');

  // Single upsert: either match by google_id, or attach google_id to an
  // existing email-only account, or create a new row.
  const { rows } = await query(
    `
    INSERT INTO users (email, name, google_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE
      SET google_id = COALESCE(users.google_id, EXCLUDED.google_id)
    RETURNING *
    `,
    [email, profile.displayName, profile.id]
  );

  return rows[0];
}

function configureOAuth(app) {
  passport.use(googleStrategy());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, rows[0] || null);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  app.get(
    '/auth/google/start',
    passport.authenticate('google', { scope: ['openid', 'email', 'profile'] })
  );

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=oauth' }),
    (req, res) => res.redirect('/dashboard')
  );
}

module.exports = { configureOAuth, googleStrategy };
