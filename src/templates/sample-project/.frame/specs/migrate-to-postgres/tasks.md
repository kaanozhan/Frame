# Tasks — Migrate from SQLite to PostgreSQL

- [x] T1 — Audit current SQLite schema; map every table to a Postgres equivalent
- [x] T2 — Stand up Postgres in docker-compose for local dev
- [x] T3 — Port src/db/client.js from sqlite3 to pg with connection pooling
- [x] T4 — Migrate users + sessions tables (queries, FK constraints)
- [ ] T5 — Migrate tasks + teams tables; add UUID primary keys
- [ ] T6 — Backfill data: copy SQLite production data to Postgres staging
- [ ] T7 — Add transaction support via tx() helper in db/client.js
- [ ] T8 — Production cutover plan + dry-run on staging
