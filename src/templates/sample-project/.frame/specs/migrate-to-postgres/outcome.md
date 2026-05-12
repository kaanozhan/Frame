# Outcome — Migrate from SQLite to PostgreSQL

In-flight. Entries land per task as `/spec.implement` walks the list.

---

## T1 — Audit current SQLite schema; map every table to a Postgres equivalent

Inventory done. Found one surprise: the `attachments` table has an
implicit dependency on SQLite's rowid that we never noticed. Replacing
with explicit `id UUID PRIMARY KEY` in Postgres. Documented mapping in
plan.md's table.

## T2 — Stand up Postgres in docker-compose for local dev

`docker-compose.yml` updated. Postgres 16 image, persistent volume,
exposes 5432. README still references SQLite setup steps — flagged a
followup task (task-017).

## T3 — Port src/db/client.js from sqlite3 to pg with connection pooling

Refactor done. Public surface (`pool`, `query`, `tx` exports) preserved
so the rest of the codebase didn't need to change. `query()` now takes
positional params with `$1, $2` placeholders instead of SQLite's `?` —
swept callers and updated them all in this PR (28 sites).

## T4 — Migrate users + sessions tables (queries, FK constraints)

Tables migrated. `users.id` and `sessions.user_id` switched to UUID.
Existing TEXT IDs from SQLite preserved in a `legacy_id` column during
dual-write. Will drop after cutover. Tests green.
