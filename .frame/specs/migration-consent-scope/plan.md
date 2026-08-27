# Plan — Migration asks about decisions, not about moves

## Architecture

### Resolved plan-time decisions

**Business**

- **S1 vs S2 (which governs a normal open).** The two success criteria
  contradict each other on a plain read. **Chosen: S2 governs; S1 is the
  blocked case.** The Frame-owned move runs on open and `git status`
  legitimately changes; S1 is read as the zero-write rule for the window
  before the move and for every case where Frame *cannot* complete it —
  unmerged paths above all. Rationale: G2 says the move happens "without
  asking" and S9 demands five opens produce one tree; a literal S1 would mean
  a project the user only glances at never migrates, which is the deadlock
  this spec exists to end.
- **How an automatic move is surfaced.** **Chosen: banner + activity log
  only.** A dismissible one-liner at the top of the app (healthNotice's
  existing shape) naming the count and the backup directory, plus the
  `migration.completed` record the activity panel already renders. Rationale:
  C3 asks for a receipt, an activity entry and a surface readable after the
  fact — the activity panel *is* that surface, and it is already built. A
  reopenable receipt modal was rejected as a second surface for the same
  information.
- **`AGENTS.md`: move and rewrite, split.** The spec treats them as one
  decision. **Chosen: split — the move is silent, the prose rewrite is the
  decision.** `AGENTS.md` travels into `.frame/` with the other Frame-owned
  files, byte-verified and backed up, its bytes untouched;
  `upgradeAgentsText`'s seven line edits and the symlink-note replacement are
  what the modal asks about. Rationale: with them fused, every legacy project
  keeps `AGENTS.md` at the root until a click, the fingerprint never clears,
  and G3's "a project with none of those never sees a modal" is vacuous —
  legacy init wrote `AGENTS.md` to every project. Split, the project migrates
  fully on open and only the user's own prose waits on the user.
- **Frame-planted symlinks.** **Chosen: silent move, not a decision.** The
  `CLAUDE.md` and `GEMINI.md` symlinks are removed as part of the automatic
  half, and the consumed `CLAUDE.md` block is restored to a real file at the
  root exactly as `execute()` does today. Rationale: legacy init planted both
  unconditionally in every project, so classing them as a decision puts a
  modal in front of every user Frame has. The cost is recorded and accepted:
  `GEMINI.md` has no replacement (Out of Scope), so Gemini CLI stops reading
  Frame's instructions in that project — reported on the banner and in the
  activity record rather than asked about.
- **Deferral lifetime.** **Chosen: permanent per project, with a way back
  in.** A deferred project is never offered the decision again; a row in
  Project Settings reopens it. Rationale: S7 requires the deferral to survive
  a restart, and a permanent no needs an entry point — which also fixes
  today's dead end, where closing the modal makes migration unreachable
  without restarting the app.

**Technical**

- **Where the auto-move runs.** **Chosen: in the main process, inside
  `CHECK_IS_FRAME_PROJECT`, before the stagers.** One synchronous block:
  detect the legacy layout, run the automatic half, recompute the layout, and
  only then let `copyParserScripts` / `stageCommandFiles` /
  `gitSharing.reconcile` / `syncClaudeRule` run. Rationale: a renderer-driven
  variant puts an IPC round trip between the detection and the writes, and
  `WATCH_SPECS` races into that gap — which is the bug being fixed.
- **Where the remaining decision is asked.** **Chosen: the migration modal
  stays, reduced to decisions.** `migrationModal.js`, its markup and its IPC
  pair are reused; the file list and the dirty-tree wall come out and the
  prose decision goes in. Rationale: least new surface, and `docsHealthHint`
  has no place for a `.frame/` conflict report.
- **Where the deferral persists.** **Chosen: `userSettings`, a list of
  project paths.** The same shape as `docsHealthHint`'s
  `docsHealthHintDismissed` (`src/renderer/docsHealthHint.js:236-256`), stored
  in `user-settings.json` under the app's userData directory. Rationale: the
  deferral is a person's answer on a machine, not a property of the
  repository — `.frame/config.json` is committed in `repo` mode, so a
  teammate would inherit the "no" and never be offered the fix.
- **A conflicting `.frame/` counterpart.** *Asked, then decided on the
  planner's recommendation.* **Chosen: resolved silently by the move and
  reported, not gated behind a click.** The `.frame/` copy is kept, the root
  copy is byte-verified into `.frame/migration-backup/` and then unlinked —
  today's `execute()` behaviour, C1 unchanged. The conflict reaches the user
  as a `migration.conflict` activity record and a line on the banner.
  Rationale: no version is lost either way (the backup is verified before the
  unlink, and the pre-move blob stays in `HEAD`); the alternative leaves the
  fingerprint in place and the project half-migrated indefinitely, which is
  the state this spec removes. S4's "nothing in that set changes without a
  click" is knowingly not held for this one case.
- **Git staging.** *Decided silently.* An automatic move stages nothing: the
  moved files are left for the user's next commit to decide. Rationale: the
  spec records this as its own leaning, and writing the index without consent
  contradicts G1 as plainly as writing a file would.
- **Guard narrowing.** *Decided silently.* `dirtyAmong` is replaced by an
  unmerged-only check, per G4 and the spec's own loss table — a modified,
  staged or untracked meta file defers nothing.
- **Test posture: everything testable.** The project's convention
  (`.frame/PROJECT_NOTES.md` → `## Testing`) is that `src/main/` and
  `src/shared/` are covered and `src/renderer/` is not, for want of a DOM
  harness — re-verified against `package.json`, where `jsdom`, `playwright`,
  `@testing-library` and `puppeteer` are all still absent. So the migration
  split, the unmerged guard and the open sequence get tests; the modal, the
  banner and the settings row do not.

### The two halves

Migration stops being one operation gated by one modal, and becomes two:

```
plan(projectPath)                  → the automatic half: what moves, no click
  { artifacts, symlinks, restorableClaudeMd,
    unmerged, tracked, backupDir, sharingMode, canRun }

pendingDecisions(projectPath)      → the asked half: what needs a yes
  [ { kind: 'agents-prose', edits: [...], review: [...] } ]
```

`plan()` keeps its fingerprint (`config.files` plus a listed file at the
root — C2 untouched) and its purity. Its only shape changes are `dirty` →
`unmerged` and `canRun = unmerged.length === 0`.

`pendingDecisions()` is new, pure, and **fingerprint-independent** — it has to
answer for a project that has already migrated, since after the automatic half
the `AGENTS.md` whose prose is stale lives in `.frame/`. It derives the
decision rather than storing it: a decision exists exactly when
`upgradeAgentsText(frameStore.readAgents(p))` would change the text. Two
consequences carry weight:

- a fresh or already-migrated project derives `[]` (the current template
  matches none of `AGENTS_LINE_EDITS`, and the new pointer note does not match
  `AGENTS_SYMLINK_NOTE`), so C6 holds — reading is the only new thing that
  happens to it;
- after the rewrite is applied the derivation empties itself, so the offer
  cannot repeat and nothing has to be recorded to stop it.

It returns `[]` while `frameStore.isLegacyLayout()` is still true: a project
whose layout question is unsettled may not be asked to rewrite a root file.

### What the automatic half does

`execute()` loses exactly one step — step 3, the `AGENTS.md` prose rewrite.
Everything else stays as `non-invasive-overlay` built it, in order: backup →
copy → byte-compare → unlink for every artifact (C1), symlink removal and
`CLAUDE.md` restoration, the `.claude/rules/frame.md` pointer, the project id,
the fingerprint deletion, the guarded hook entries, the sharing mode, the
refreshed `.frame/bin` scripts. `applyDecisions()` takes the removed step, and
adds nothing to it.

### The open sequence

`frameProject` grows one exported function, `openProjectLayout(projectPath)`,
holding what `CHECK_IS_FRAME_PROJECT` does inline today. The order is the
whole point:

```
openProjectLayout(p)
  isFrameProject?            no  → { layout: 'none' }
  isLegacyLayout?            no  → stagers, as today → { layout: 'overlay' }
                             yes ↓
  layoutMigration.plan(p)
    canRun === false         → write nothing at all, no stagers
                               → { layout: 'legacy', migration: { blocked: 'unmerged', unmerged } }
    canRun === true          → layoutMigration.run(p, plan)
                               → stagers + stageCommandFiles
                                 + ensureProjectArtifacts + upgradeSpecDocs
                               → re-arm the tasks/specs watchers, refresh the file tree
                               → { layout: 'overlay', migration: receipt }
```

The blocked branch is the one S1 measures: no stager, no `syncClaudeRule`, no
`.frame/specs/`, no `.claude/settings.json` hook entry, no `.git/info/exclude`
block. `specManager` closes the other door — `startWatching` skips its
`mkdirSync` and `WATCH_SPECS` skips its three stagers while
`frameStore.isLegacyLayout()` is true — so the guard holds whichever IPC
message the renderer sends first.

The post-run block (`tasksManager.restartWatching`, `specManager.startWatching`,
the file-tree refresh) already exists in `RUN_LAYOUT_MIGRATION`
(`frameProject.js:1321-1339`); it moves into `openProjectLayout` so the
automatic run gets it too, and the staging calls join it so S8 holds without
waiting for another `WATCH_SPECS`.

### Reporting

`IS_FRAME_PROJECT_RESULT` carries a third field, `migration`: the receipt, the
blocked report, or `null`. No new channel. `state.js` hands it to
`healthNotice`, which gains an informational variant beside its warning and
error ones:

- ran → `Frame moved 5 files into .frame/ — copies are in .frame/migration-backup/.`
- ran with conflicts or review items → the same line plus `2 need a look — see Activity.`
- blocked → `Frame left this project alone: AGENTS.md is in an unresolved merge. Finish the merge and reopen.` — S6's "name the merge, not commit-or-stash".

The durable record is the activity log. `migration.completed` gains a
`backupDir` field so the row names where the copies went; `migration.skipped`
learns the reason `unmerged` (`dirty-tree` stays in the enum for records
already written).

### The decision modal

`migrationModal` keeps its four states but changes what they are about: the
plan state becomes the prose decision (what the edits are, that `AGENTS.md` is
the user's file, that a section Frame cannot prove is its own is never
touched — C4), progress and receipt stay, and the dirty-tree wall is deleted
outright. It is offered from `state.js` on every project, not only a legacy
one, because a decision can outlive the migration that created it; the module
stays silent when `pendingDecisions` is empty or the project is deferred.

`Later` writes the project path into the `userSettings` key
`migrationDecisionsDeferred` and never asks again. Project Settings gains a
row — visible only while a decision is pending — that opens the modal with the
deferral bypassed.

## Files

**Modified**

- `src/main/layoutMigration.js` — `dirty` → `unmerged`; `execute()` drops the
  prose rewrite; new `pendingDecisions()` and `applyDecisions()`.
- `src/main/frameProject.js` — new exported `openProjectLayout()`: the
  automatic move before the stagers, the stagers gated while the layout is
  unsettled, the post-migration re-arm; the migration IPC pair becomes the
  decision pair.
- `src/main/specManager.js` — `startWatching` and the `WATCH_SPECS` stagers
  skip a project whose layout is unsettled.
- `src/shared/activityEvents.js` — `migration.completed` carries `backupDir`;
  `migration.skipped` learns the `unmerged` reason.
- `src/shared/ipcChannels.js` — the migration channels become decision
  channels; `IS_FRAME_PROJECT_RESULT` documents its `migration` field.
- `src/renderer/state.js` — routes the open receipt to the banner and offers
  decisions independently of `layout`.
- `src/renderer/healthNotice.js` — `showMigration()`: the receipt and the
  blocked case as a one-liner.
- `src/renderer/migrationModal.js` — decision-only modal; deferral persists
  through `userSettings`; a forced open for the settings entry point.
- `src/renderer/projectSettingsModal.js` — the row that reopens a deferred
  decision.
- `src/renderer/styles/components/health-notice.css` — the informational
  variant beside the warning and error ones.
- `index.html` — the modal's copy rewritten for a decision; the Project
  Settings row.
- `test/layoutMigration.test.js` — the automatic/decision split, the unmerged
  guard, the dirty-but-movable cases, idempotence after the split.
- `test/activityEvents.test.js` — the registry change.

**New**

- `test/frameProjectOpen.test.js` — the open sequence's footprint: zero bytes
  written while blocked, the automatic move and its receipt, the stagers only
  after it, and five opens producing one tree.

## Footprint

- src/main/layoutMigration.js
- src/main/frameProject.js
- src/main/specManager.js
- src/shared/activityEvents.js
- src/shared/ipcChannels.js
- src/renderer/state.js
- src/renderer/healthNotice.js
- src/renderer/migrationModal.js
- src/renderer/projectSettingsModal.js
- src/renderer/styles/components/health-notice.css
- index.html
- test/layoutMigration.test.js
- test/activityEvents.test.js
- test/frameProjectOpen.test.js

## Dependencies

None.

## Sequencing

1. **Split `layoutMigration` into an automatic half and an asked half.**
   Replace `dirtyAmong` with an unmerged-only check (porcelain codes where X
   or Y is `U`, plus `DD` and `AA`), rename the plan field to `unmerged` and
   derive `canRun` from it. Take step 3 out of `execute()`. Add
   `pendingDecisions(projectPath)` — pure, fingerprint-independent, empty
   while `isLegacyLayout()` is true — and `applyDecisions(projectPath,
   decisions)`, which runs `upgradeAgentsText`, writes through
   `frameStore.writeAgents` and calls `syncClaudeRule`, returning a receipt in
   the shape `run()` already uses. Extend `test/layoutMigration.test.js`: a
   modified and a staged meta file both migrate with the uncommitted content
   arriving in `.frame/` (S5); an unmerged path moves nothing and reports
   `unmerged` (S6); the automatic run leaves `AGENTS.md`'s bytes untouched
   while moving it; `pendingDecisions` is empty for a fresh project and for
   one whose prose has been rewritten; a second run finds nothing to do (C7).

2. **Run the automatic half on open, before anything else writes.** Extract
   `CHECK_IS_FRAME_PROJECT`'s body into an exported
   `frameProject.openProjectLayout(projectPath)` and give it the order in
   *The open sequence* above: plan, then either write nothing at all or move,
   stage and re-arm. Move the post-run block out of `RUN_LAYOUT_MIGRATION`
   into it and add `stageCommandFiles` / `ensureProjectArtifacts` /
   `upgradeSpecDocs` so a migrated project ends the open with the artifacts an
   already-migrated one has (S8). In `specManager`, gate `startWatching`'s
   `mkdirSync` and the `WATCH_SPECS` stagers on `frameStore.isLegacyLayout()`.
   Write `test/frameProjectOpen.test.js` in `frameProjectInit.test.js`'s
   pattern: a blocked open leaves `git status` and the untracked set
   byte-identical with no `.frame/specs/` (S1); a normal open moves every
   Frame-owned file byte-verified against its backup (S2, C1); five opens in a
   row produce the tree the first one did (S9); a migrated and a fresh project
   come out of an open exactly as they do today (C6).

3. **Report the move.** Add `backupDir` to `migration.completed` and
   `unmerged` to `migration.skipped`'s reason enum in
   `src/shared/activityEvents.js`, with labels that name the backup directory
   and the merge; extend `test/activityEvents.test.js` for both. Add the
   informational variant to `health-notice.css`, `showMigration(migration)` to
   `healthNotice.js`, and the call in `state.js`'s
   `IS_FRAME_PROJECT_RESULT` handler.

4. **Reduce the modal to the decision.** Rename the channels
   (`GET_LAYOUT_MIGRATION_PLAN` → `GET_MIGRATION_DECISIONS`,
   `RUN_LAYOUT_MIGRATION` → `APPLY_MIGRATION_DECISIONS`) and rewire the
   handlers in `frameProject.js` to `pendingDecisions` / `applyDecisions`.
   Rewrite the modal's markup in `index.html` — the file list and the
   dirty-tree block out, the prose decision and what Frame will not touch in —
   and `migrationModal.js` to match. Offer it from `state.js` on every
   project, not only a legacy one.

5. **Make the deferral permanent, and give it a way back.** Replace
   `migrationModal`'s in-memory `deferred` Set with the `userSettings` key
   `migrationDecisionsDeferred`, read through `GET_USER_SETTING` and written
   through `SET_USER_SETTING` on `Later` (S7). Add `open(projectPath, {
   force: true })` for a deferred project, and the Project Settings row in
   `index.html` and `projectSettingsModal.js` that calls it — shown only while
   `pendingDecisions` is non-empty.
