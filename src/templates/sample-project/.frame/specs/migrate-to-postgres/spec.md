# Migrate from SQLite to PostgreSQL

## Why

SQLite served us through the v0 build and beta launch. Three pressures
made it the wrong choice for the next 6 months:

1. **Concurrent writes.** SQLite's single-writer model is starting to
   show up in p99 latencies as the team-assignment flow lands writes
   on multiple tables in one transaction.
2. **Hosting.** Our deployment story (single VM with the DB file on a
   local volume) doesn't survive the multi-region story we want by Q3.
3. **Tooling.** Connection pooling, observability, partial indexes,
   JSONB — Postgres gives us all of them off the shelf.

See PROJECT_NOTES 2026-03-08 for the SQLite vs Postgres vs MongoDB
discussion.

## What's in scope

- Move all production data to a managed Postgres (Neon for prod,
  docker-compose locally)
- Port `src/db/client.js` from `sqlite3` to `pg`
- Migrate every table (users, sessions, teams, tasks, attachments)
- Backfill production data via a one-time script
- A clean cutover window: < 5 minutes downtime, fully reversible

## What's out of scope

- Schema refactoring (we keep the same shape, only swap engine)
- Multi-region — we plan for it but ship single-region now
- ORM adoption (decision deferred — see followup notes)

## Success criteria

- All tests green on Postgres
- Production data backfilled with zero row-count drift
- p95 latency unchanged or better on representative endpoints
- Rollback plan documented and rehearsed on staging
