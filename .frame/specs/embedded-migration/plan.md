# Plan — Embedded-Layout Migration — pre-overlay projects migrate themselves on open

## Architecture

### Resolved plan-time decisions

**Business**

- **Trigger scope — sweep, not per-open.** *Asked.* A per-open trigger would
  migrate a multi-project workspace one project per session, each with its own
  notice, leaving unopened projects broken indefinitely. Chosen: a startup
  sweep over `workspace.getProjects()`, with the `CHECK_IS_FRAME_PROJECT` path
  kept as the fallback for projects added later. Recorded in the spec as D1a.
- **Projects outside the registry — migrate when they come back.** *Asked.*
  `workspaces.json` is the definition of the set Frame is responsible for, and
  leaving it requires the user removing a project. A filesystem scan for stray
  `.frame/` directories was rejected: no defensible starting root, slow, and it
  would write to repositories Frame was never pointed at.
- **Receipt — one per sweep; failures named, deferrals not.** *Asked.* One
  message for the whole pass, listing migrated projects and any that failed
  (with D1 silent and D10's banner gone, a failed project is otherwise
  invisible). D4 deferrals are omitted: normal, self-resolving, and reporting
  them every startup is a recurring message with no action attached.
- **Sample project stays in scope.** *Asked.* D11 shares no code with the
  engine but owns acceptance S10, and a separate spec for a template rewrite
  costs more than the work.
- **The foreground path shows a modal; the sweep does not.** *Asked.* A failed
  sweep left the user with a broken project and no recovery. The lazy path
  needs no stored failure state to detect that case — if the sweep had
  succeeded the project would not still be legacy — so every lazy firing means
  the user is waiting on that project, which is when blocking UI is earned.
  Recorded in the spec as D13.
- **The failure screen offers a retry, not "remove and re-add".** *Asked, and
  against the initial suggestion.* Removing only drops the `workspaces.json`
  entry; re-adding re-runs the same code against the same files. No plausible
  cause — permission denied, locked file, unremovable symlink, full disk —
  travels through the registry. The screen shows the real error, states that
  the backup holds everything removed, and retries.

**Technical**

- **Test posture — everything testable.** *Asked.* The engine is pure Node
  (file moves, git queries, content extraction), which is exactly what this
  project already tests: `gitExclude.test.js` (12 cases) and
  `gitSharing.test.js` (24 cases) both run against real temp repos. The
  renderer receipt is not tested — the testing record lists `src/renderer/` as
  **Not covered**, with no DOM harness installed.
- **The engine stays Electron-free.** *Silent.* `embeddedMigration.js` takes
  paths and returns a plain result; `index.js` supplies
  `workspace.getProjects()` and does the IPC send. Same injection convention
  `globalLayer` follows so the module and its tests never load Electron.
- **The IN-FLIGHT collision is stale.** *Silent.* `spec-context.js` flags
  `src/main/frameProject.js` as in the footprint of
  `audit-q3-performance-resources` (phase `implementing`). That spec's
  `outcome.md` records T01–T10 complete, with only T10's runtime measurement
  pending — measurement work that touches neither `frameProject.js` nor
  `index.js`. Both touches here are a few lines in distinct regions; no
  coordination needed.
- **Receipt surface — extend `healthNotice`.** *Asked.* `notify.js`
  auto-dismisses in 2–4 s and takes no action button; a bespoke popover would
  duplicate a lifecycle `healthNotice` already owns, against the consolidation
  `notify.js`'s own header argues for.

### Key components

`src/main/embeddedMigration.js` is the whole engine, in the shape
`gitSharing.js` established — a pure module with a few named entry points:

- `plan(projectPath)` → what would happen: the artifact list (from
  `config.json.files`, falling back to `LEGACY_ROOT_FILES`), each one's
  disposition, the dirty-check verdict, restorations. Pure inspection, no
  writes — this is what makes the hard parts testable without executing them.
- `migrateProject(projectPath)` → runs a plan: backup, move, restore, config
  rewrite, posture resolve. Returns `{ status, artifacts, restored, tracked }`
  where `status` is `migrated | deferred | skipped | failed`.
- `sweep(projectPaths)` → maps `migrateProject` over the registry with the
  in-flight guard and per-project failure isolation; returns the array the
  receipt is built from.

`migrateProject` takes an optional `onProgress(artifact)` callback. The sweep
passes nothing; the foreground path passes one that forwards over
`MIGRATION_PROGRESS`, which is the only difference between the two callers —
the engine has no notion of foreground or background.

Detection is not reimplemented: `instructionDiscovery.detectLegacyLayout`
already answers it and stays the single source of that judgement.

### Data shapes

```js
// plan(projectPath)
{
  legacy: true,
  artifacts: [{ rel: 'tasks.json', target: '.frame/tasks.json',
                disposition: 'move' | 'delete-identical' | 'backup-conflict' }],
  restore:   [{ rel: 'CLAUDE.md', from: 'AGENTS.md#Existing Instructions (from CLAUDE.md)' }],
  symlinks:  ['CLAUDE.md', 'GEMINI.md'],
  dirty:     [] | ['PROJECT_NOTES.md'],   // non-empty ⇒ defer (D4)
  tracked:   ['AGENTS.md', 'tasks.json']  // drives the receipt's git sentence (D8)
}

// sweep(paths) → [{ path, name, status, tracked: number, error? }]
```

The merge heading is a literal in this module, carried from `1202ab2`:
`## Existing Instructions (from ${label})`, blocks joined by `\n\n---\n\n`.

## Files

**New**

- `src/main/embeddedMigration.js` — the engine: plan, migrate, sweep.
- `test/embeddedMigration.test.js` — the suite, against real temp repos.
- `src/renderer/migrationModal.js` — the foreground modal: progress, deferred
  and failed states, retry.
- `src/renderer/styles/components/migration-modal.css` — its styles.

**Modified**

- `src/main/index.js` — one call in `initModulesWithWindow`: sweep the
  registry, send the receipt.
- `src/main/frameProject.js` — the `CHECK_IS_FRAME_PROJECT` handler's
  `LEGACY_LAYOUT_DETECTED` send (`:531`) becomes the lazy migration call.
- `src/main/gitSharing.js` — `migration-backup/` joins the managed
  `.frame/.gitignore` block.
- `src/main/telemetryEvents.js` — the failure event.
- `src/shared/activityEvents.js` — the migration event family.
- `src/shared/ipcChannels.js` — `LEGACY_LAYOUT_DETECTED` out;
  `MIGRATION_COMPLETED` (sweep receipt), `MIGRATION_PROGRESS` and
  `RETRY_MIGRATION` (foreground modal) in.
- `index.html` — the modal's markup, reusing the `settings-modal` vocabulary
  the Project Settings dialog established at `:1294`.
- `src/renderer/index.js` — `migrationModal.init()` beside the other modals.
- `src/renderer/styles/main.css` — the new stylesheet's `@import`.
- `src/renderer/healthNotice.js` — legacy branch removed; neutral `info` kind
  and one optional action added; renders the receipt.
- `src/renderer/styles/components/health-notice.css` — the `info` kind and
  action button.
- `src/templates/sample-project/**` — rewritten to the overlay layout (D11).
- `PRIVACY.md` — the failure event's collection row.
- `test/gitSharing.test.js` — the gitignore block's new entry.
- `test/telemetry.test.js` — the failure event's enum pass-through.
- `test/activityEvents.test.js` — the migration events' registration.

## Footprint

- src/main/embeddedMigration.js
- src/main/index.js
- src/main/frameProject.js
- src/main/gitSharing.js
- src/main/telemetryEvents.js
- src/shared/activityEvents.js
- src/shared/ipcChannels.js
- src/renderer/healthNotice.js
- src/renderer/migrationModal.js
- src/renderer/index.js
- src/renderer/styles/components/health-notice.css
- src/renderer/styles/components/migration-modal.css
- src/renderer/styles/main.css
- index.html
- src/templates/sample-project/**
- PRIVACY.md
- test/embeddedMigration.test.js
- test/gitSharing.test.js
- test/telemetry.test.js
- test/activityEvents.test.js

## Dependencies

None. The engine uses `node:fs`/`node:path` and the `git` invocation helper
pattern `gitSharing.js` already uses; the test suite runs on `node --test`,
already the project's runner.

## Sequencing

1. **Register the migration events.** The family in
   `src/shared/activityEvents.js` (detected, deferred, artifact disposition,
   restored, completed, failed) and the failure event in
   `telemetryEvents.js` with its `PRIVACY.md` row in the same change. Tests in
   `activityEvents.test.js` and `telemetry.test.js`. First because every later
   step records into it. *(D12)*

2. **`migration-backup/` joins the ignore block.** `gitSharing.writeFrameGitignore`
   plus its case in `gitSharing.test.js`. Before anything can write a backup,
   so a `repo`-mode project never has one staged. *(D9)*

3. **The engine: `plan()` and the backup.** New `embeddedMigration.js` —
   `config.json.files` read first, `LEGACY_ROOT_FILES` fallback, the D4 dirty
   check, the artifact/disposition/restore/tracked shape, and the
   write-into-`.frame/migration-backup/`-skipping-existing step. No moves yet.
   Tests: manifest vs fallback, unrecognized root files reported not planned,
   dirty defers, backup is a byte copy, a second run adds only what is
   missing. *(D4, D5, D9)*

4. **The engine: move and conflict resolution.** Executing a plan — move where
   `.frame/` is empty, delete where identical, back up the root copy where
   `.frame/` differs, then rewrite `config.json` without its `files` block.
   Tests: each disposition, dual layout keeps the `.frame/` version, an
   interrupted run reconciles on the next pass. *(D2, D3)*

5. **The engine: instruction restoration.** Extracting
   `## Existing Instructions (from <label>)` blocks, restoring root
   `CLAUDE.md`/`GEMINI.md`/`AGENTS.md`, removing Frame-planted symlinks, and
   leaving `.claude/CLAUDE.md` alone. Tests: each restoration, an absent block
   means plain symlink removal, an existing user file at the target is never
   overwritten, `.claude/CLAUDE.md` untouched and never recreated. *(D6)*

6. **Posture and the sweep.** `gitSharing.resolveMode` after the move, then
   `sweep(paths)` with the in-flight guard, missing-path skip, and per-project
   failure isolation — recording into step 1's events throughout. Tests: a
   committed-`.frame/` project stays `repo`, a sweep over several projects
   reports per-project status, one failure does not stop the rest, a missing
   path is skipped, the guard blocks re-entry. *(D1a, D7, S13–S16)*

7. **Wire the sweep and show the receipt.** `index.js` sweeps after
   `workspace.init`, asynchronously, and sends `MIGRATION_COMPLETED`;
   `ipcChannels.js` swaps `LEGACY_LAYOUT_DETECTED` out; `healthNotice.js`
   loses the legacy branch and gains the `info` kind plus one optional action,
   with the matching `health-notice.css`. The banner and its replacement land
   together, so no build has neither. *(D1, D8, D10)*

8. **The foreground modal.** `frameProject.js`'s handler runs the lazy path
   with an `onProgress` callback over `MIGRATION_PROGRESS`; new
   `migrationModal.js` plus its markup in `index.html` (the `settings-modal`
   vocabulary) renders the three end states — progress per artifact, the
   deferred explanation naming the dirty files, and the failure screen with the
   error, the backup path and a retry over `RETRY_MIGRATION`. Wired in
   `src/renderer/index.js`, styles imported from `main.css`. Not tested: the
   testing record lists `src/renderer/` as **Not covered**; the engine
   behaviour behind it is already covered by steps 3–6. *(D13)*

9. **The sample project template.** `src/templates/sample-project/**` rewritten
   to the overlay layout — meta files under `.frame/`, root `CLAUDE.md`/
   `GEMINI.md` dropped — so detection never matches it. *(D11)*
