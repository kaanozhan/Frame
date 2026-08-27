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
## T02 — The AGENTS.md prose rewrite leaves the automatic half

Deleted step 3 from `execute()` in `src/main/layoutMigration.js`, so the
automatic half relocates `AGENTS.md` byte-for-byte like every other artifact,
and renumbered the steps behind it. Added `applyDecisions(projectPath,
decisions)` carrying that removed step alone — `upgradeAgentsText` →
`frameStore.writeAgents` → `syncClaudeRule`, returning a receipt in `run()`'s
shape — and rewrote the module header around the two halves. `syncClaudeRule`
fires only when the prose actually changed, which also makes a second apply a
no-op with nothing recorded to stop it; the existing idempotence and
backup-verify-unlink tests hold unchanged.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T03 — pendingDecisions derives the question from the text

Added `pendingDecisions(projectPath)` to `src/main/layoutMigration.js`: pure,
fingerprint-independent, `[]` while `frameStore.isLegacyLayout()` holds, and
otherwise one `agents-prose` entry carrying the named line edits, whether the
old symlink note is present, and the review list — returned only when
`upgradeAgentsText` would change bytes. Reads through `frameStore.readAgents`,
so `resolvePath`'s legacy fallback is untouched. Tests cover the legacy,
stale-prose, applied and fresh cases, and assert the call leaves a fresh
project's listing unchanged.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T04 — The open sequence migrates before anything else writes

Extracted `CHECK_IS_FRAME_PROJECT`'s body into an exported
`frameProject.openProjectLayout(projectPath, hooks)`: it plans the migration
first and either writes nothing at all (`{ blocked: 'unmerged' }`) or moves,
then lets the stagers, `ensureProjectArtifacts`, `upgradeSpecDocs` and
`syncClaudeRule` run against a settled layout. The post-run re-arm left
`RUN_LAYOUT_MIGRATION` for a shared `rearmAfterMigration` both callers use,
and the receipt now rides on `IS_FRAME_PROJECT_RESULT`. New
`test/frameProjectOpen.test.js` covers the byte-verified move, artifact parity
with an already-migrated project, five opens producing one tree, and the
fresh/migrated/not-a-project cases. Noted rather than asserted away: the open
still writes AGENTS.md's managed spec section after the move — now onto the
copy in `.frame/`, with the user's prose untouched.

_Captured: 2026-08-27 · 3 file change(s)_

---
## T05 — The specs watcher stops writing to an unsettled project

Gated `startWatching`'s `mkdirSync` of the specs root and the `WATCH_SPECS`
handler's three stagers on `frameStore.isLegacyLayout()` in
`src/main/specManager.js`. The open path alone could not hold the guard:
`WATCH_SPECS` and `CHECK_IS_FRAME_PROJECT` are separate IPC messages and the
renderer decides which arrives first. Extended `test/frameProjectOpen.test.js`
with a mid-merge fixture proving a blocked open leaves the tree and `git
status --porcelain` byte-identical with no `.frame/specs/` or `.frame/docs/`,
plus a direct call to the real `startWatching` proving the `mkdirSync` is
gated.

_Captured: 2026-08-27 · 2 file change(s)_

---
