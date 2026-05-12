/**
 * TaskFlow — Application entry
 *
 * Wires the Express app, database pool, and OAuth strategy, then starts
 * the HTTP server on the configured port.
 */

const { createApp } = require('./api/server');
const { configureOAuth } = require('./auth/oauth');
const { pool } = require('./db/client');

async function start() {
  // Verify DB connectivity before accepting traffic
  await pool.query('SELECT 1');

  const app = createApp();
  configureOAuth(app);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`TaskFlow listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
