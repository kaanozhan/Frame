# Tasks — Embedded-Layout Migration — pre-overlay projects migrate themselves on open

- T01 · Register the migration event family in `src/shared/activityEvents.js` and the failure-only telemetry event in `src/main/telemetryEvents.js`, with its `PRIVACY.md` collection row
- T02 · Add `migration-backup/` to the managed `.frame/.gitignore` block written by `gitSharing.writeFrameGitignore`
- T03 · Build `embeddedMigration.plan()` and the backup writer — artifact list from legacy `config.json.files` with `LEGACY_ROOT_FILES` as fallback, the git dirty-check that defers, and a byte copy into `.frame/migration-backup/` that skips paths already there
- T04 · Execute a plan: move artifacts whose `.frame/` counterpart is absent, delete identical ones, send conflicting root copies to the backup so `.frame/` wins, then rewrite `config.json` without its `files` block
- T05 · Restore `CLAUDE.md`, `GEMINI.md` and `AGENTS.md` from their `## Existing Instructions (from …)` blocks, remove Frame-planted symlinks, and leave `.claude/CLAUDE.md` untouched
- T06 · Resolve sharing posture through `gitSharing.resolveMode` after the move and add `sweep()` with the in-flight guard, missing-path skip and per-project failure isolation
- T07 · Sweep the registry asynchronously from `initModulesWithWindow`, replace `LEGACY_LAYOUT_DETECTED` with `MIGRATION_COMPLETED`, and render the receipt on `healthNotice` extended with a neutral `info` kind and one optional action
- T08 · Add the foreground migration modal — per-artifact progress over `MIGRATION_PROGRESS`, the deferral explanation naming the dirty files, and the failure screen carrying the error, the backup path and a retry
- T09 · Rewrite `src/templates/sample-project/` to the overlay layout so legacy detection never matches the bundled sample
