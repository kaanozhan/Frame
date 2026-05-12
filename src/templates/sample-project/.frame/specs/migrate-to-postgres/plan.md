# Plan — Migrate from SQLite to PostgreSQL

## Strategy: dual-write, then cutover

We won't do a big-bang switch. The rollout has three phases:

1. **Port code, run on Postgres in dev/staging only.** Tests must pass.
2. **Dual-write in production.** Writes hit both DBs, reads still come
   from SQLite. Verify with a checksum job that the two stay in sync.
3. **Cutover.** Read traffic flips to Postgres. Keep SQLite warm for
   one week as the rollback target.

## Tables

In dependency order (parent → child):

```
users         → sessions, tasks (assigned_to_user_id)
teams         → tasks (team_id)
attachments   → tasks (task_id FK)
```

We migrate parents first so child FKs always resolve.

## Schema changes (carried over, not refactored)

| Change | Why |
|---|---|
| `id` columns: TEXT → UUID (with `gen_random_uuid()` default) | Native UUID support, smaller index footprint |
| Boolean columns: 0/1 → true/false | Postgres native |
| `created_at` defaults: `CURRENT_TIMESTAMP` → `now()` | Same semantics, native syntax |
| `tasks.payload`: TEXT (json string) → JSONB | We're already querying it as JSON; JSONB indexes it |

Nothing else changes shape. Same columns, same NOT NULL constraints,
same uniques.

## Cutover plan

1. T-1h: stop background workers
2. T-30m: pause new sign-ups
3. T-15m: final checksum verify
4. T-5m: read traffic flips via feature flag
5. T-0: monitor error rate + latency for 30 min
6. If anything fires above threshold → flip flag back

## Risks

- **Auto-increment ID drift between engines.** Avoided by switching to
  UUIDs in this same migration. Old TEXT ids preserved during dual-write.
- **Connection pool exhaustion.** Postgres on Neon has a hard pool
  limit. Configured `pg.Pool({ max: 20 })` and tested under load.
- **Backfill speed.** Production has ~2M task rows. Initial copy uses
  `COPY ... FROM STDIN` (~3 min on staging dry-run).

## Followup

ORM evaluation deferred. We agreed: ship the engine swap first, then
re-evaluate whether to layer Knex/Drizzle over raw `pg`. Tracked as a
PROJECT_NOTES item, not a separate spec.
