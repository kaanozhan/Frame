/**
 * Express server — app factory
 *
 * Builds the Express instance, mounts middleware, mounts route modules.
 * createApp() returns an app you can either listen() on or hand to tests.
 */

const express = require('express');
const { sessionMiddleware } = require('../auth/session');
const tasksRouter = require('./tasks');
const usersRouter = require('./users');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(sessionMiddleware());

  // configureOAuth() from src/auth/oauth.js mounts passport middleware + routes

  app.use('/api/tasks', tasksRouter);
  app.use('/api/users', usersRouter);

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createApp };
