/**
 * Database client — Postgres connection pool
 *
 * Canonical DB access point. API handlers should NEVER use the pg module
 * directly; everything goes through `query()` or `tx()` so we get a
 * single place to add logging, metrics, and retries.
 *
 * See spec `.frame/specs/migrate-to-postgres/` for the SQLite → Postgres
 * migration history.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000
});

async function query(sql, params) {
  const started = Date.now();
  const result = await pool.query(sql, params);
  const elapsed = Date.now() - started;
  if (elapsed > 200) {
    console.warn(`Slow query (${elapsed}ms):`, sql.slice(0, 120));
  }
  return result;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
