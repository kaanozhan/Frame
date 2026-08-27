## T01 — Narrow the migration guard to unmerged paths

Replaced `dirtyAmong` with `unmergedAmong` in `src/main/layoutMigration.js`: the
porcelain walk now keeps only codes carrying a `U`, plus `DD` and `AA`, so a
modified or staged meta file migrates with its uncommitted content and only a
real merge conflict defers. Renamed the plan's `dirty` field to `unmerged`,
derived `canRun` from it, and had `run()` return `reason: 'unmerged'`; carried
the rename into `src/renderer/migrationModal.js` so the paused state still
renders, and reworked `test/layoutMigration.test.js`'s dirty-tree test into a
real mid-merge fixture beside two new cases that migrate. Divergence from
plan.md: the `migration.skipped` activity record still writes `dirty-tree`,
because the registry's reason enum does not learn `unmerged` until T06.

_Captured: 2026-08-27 · 3 file change(s)_

---
