/**
 * Session middleware + requireAuth guard
 *
 * Passport needs the session to exist BEFORE it can hydrate the user.
 * Mount this middleware on the Express app before configureOAuth().
 */

const session = require('express-session');

function sessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  });
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'authentication required' });
  }
  next();
}

module.exports = { sessionMiddleware, requireAuth };
