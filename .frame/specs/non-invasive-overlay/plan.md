# Plan — Frame footprint: meta files move into `.frame/`, delivery stays native

## Architecture

### Resolved plan-time decisions

**Business**

- **Default sharing mode at init** — fork: `repo` pre-selected / `local` pre-selected / no pre-selection. **Chosen: `repo` pre-selected, `local` selectable** in the init modal. Rationale: Frame's value is shared context and orchestration needs tracked `.frame/`; a repo that already tracks `.frame/` is `repo` regardless. (asked)
- **`STRUCTURE.json` class vs. tracking** — fork: keep tracked / move to ignored + regenerate on open. **Chosen: stays tracked** in this spec; the managed `.frame/.gitignore` block does *not* list it. Rationale: teammates and worktrees rely on it today and regeneration depends on the staged parser being present; "derived → ignored" is a later, separate decision. (asked)
- **Where the sharing control and "Remove Frame" live** — fork: Settings → Workflow section / new Project Settings modal. **Chosen: Settings → Workflow**, beside the existing per-project Spec-Driven toggle, reusing its `ipcRenderer.invoke` pattern. Rationale: existing surface, no new modal/CSS, one place for per-project workflow switches. (asked)
- **Migration consent UI** — fork: renderer modal / Electron `dialog.showMessageBox`. **Chosen: renderer modal** (`migrationModal.js`, markup beside the init modal) because the receipt (moved / restored / backed-up / review list) needs a list and a persistent close, which the native dialog cannot show. (silent)
- **Migration trigger** — fork: startup sweep over all projects / on project selection. **Chosen: on selection**, inside the existing `CHECK_IS_FRAME_PROJECT` round-trip, so the modal appears for the project the user is looking at and never for a project they did not open. (silent)
- **Unmigrated projects keep working** — fork: force migration before use / dual layout resolution. **Chosen: dual resolution** — `frameStore` reads and writes the root layout for a legacy project (one that has the `config.json.files` record and the file at the root) until the user migrates; new files are always created under `.frame/`. Rationale: "Later" must not break a working project, and the `.frame/bin` scripts already resolve this way. (silent)
- **Claude Code version floor, no root fallback** — `.claude/rules/*.md` is the only pointer mechanism; the init modal and docs state the minimum Claude Code version. One mechanism beats two. (silent, from spec C6)
- **Gemini** — all `GEMINI.md` creation, consumption and symlink code is removed; migration only removes a Frame-planted `GEMINI.md` symlink. (silent, spec D2)

**Technical**

- **Seam key** — fork: `frameStore` API takes `projectPath` (resolves `projectId` internally) / takes `projectId` (callers migrate). **Chosen: `projectPath`**. Every call site, IPC payload and renderer already carries the path; the id lives in `config.json` and `frameStore.getProjectId()` exposes it. Spec D7's sentence "all `frameStore` calls take the id" is refined accordingly: the id is *stored and exposed*, not the API key. (asked)
- **Test posture** — **Everything testable**: `node --test` over the pure modules (`frameStore`, `gitExclude`, `gitSharing`, `layoutMigration`, scripts, templates), a tree-walk init test with Electron stubbed (the `specTasksSync.test.js` pattern), and a native-context test that runs `claude -p` against a scratch repo and skips when `claude` is not on `PATH` or `CI` is set. Renderer untested (no harness, per the testing record). (asked)
- **Renderer reads go through IPC** — `structureMap.js` currently `fs.readFileSync`s `STRUCTURE.json` from the renderer. **Chosen:** new `LOAD_STRUCTURE_MAP` invoke channel served by `frameStore`; no renderer module joins a meta path. (silent, spec S6)
- **Hook entry form** — command becomes `sh -c '[ -f .frame/bin/spec-hint.js ] && exec node .frame/bin/spec-hint.js <mode>'`; the literal string is the Frame marker (exact-match add/remove). Old unguarded entries are replaced by migration. (silent, spec D3)
- **AGENTS.md upgrade during migration** — fork: rewrite the whole file / leave it / targeted edit. **Chosen: targeted edit** — replace the known template lines (`**STRUCTURE.json**`, `**PROJECT_NOTES.md**`, `**tasks.json**` navigation bullets, the reference table's first column, and the trailing "A `CLAUDE.md` symlink is provided" note) with their `.frame/` forms; if a line is not found, leave the file and list it under "review" in the receipt. Users customise `AGENTS.md`; a full rewrite would be hostile (the same reasoning `ensureSpecDrivenArtifacts` already records). (silent)
- **In-flight footprints** — `audit-q3-performance-resources` is `implementing` by status but has `outcome.md` + `measurements.md`: treated as finished, no collision. `audit-q3-cross-platform` is `planned` and untouched: this spec lands first; cross-platform re-plans on top (it shares `frameProject.js`, `aiToolManager.js`, `frameTemplates.js`, `overviewManager.js`). (silent)
- **Sample project** — `src/templates/sample-project/` ships the legacy root layout; it is converted to the new layout so the sample never triggers the migration modal. (silent, found in evidence)

### Design

**Layout resolution (frameStore).** One rule, used by the app and mirrored by the `.frame/bin` scripts:

```
resolve(projectPath, name):
  overlay = <projectPath>/.frame/<name>
  if exists(overlay)                          → overlay
  if config.files record present
     and exists(<projectPath>/<name>)         → root (legacy, until migrated)
  else                                        → overlay   (new files always under .frame/)
```

`frameStore` is the only module that joins these paths. Public API (all `projectPath`-keyed):

```
frameStore.getTasks(p) / saveTasks(p, data)        // fsSafe.writeFileAtomic + .bak, as tasksManager does today
frameStore.readNotes(p) / appendNote(p, text)
frameStore.getStructure(p) / saveStructure(p, obj)
frameStore.readQuickstart(p)
frameStore.readAgents(p) / writeAgents(p, text)
frameStore.readConfig(p) / writeConfig(p, cfg)
frameStore.getProjectId(p) / ensureProjectId(p)    // crypto.randomUUID(); stamped into config.json
frameStore.metaDir(p)                              // directory to watch for tasks.json (root or .frame)
frameStore.isLegacyLayout(p)                        // files record + root file present
frameStore.setupIPC(ipcMain)                        // LOAD_STRUCTURE_MAP
```

Files remain the source of truth; every read hits disk (no write-behind cache — agents edit these files with their own tools and `tasksManager`'s watcher must see it). `tasksManager` keeps its parse-once cache keyed on mtime+size (perf spec) — that is a read cache invalidated by the watcher, not a write buffer.

**File classes → `.frame/.gitignore` managed block** (spec D6; `STRUCTURE.json` tracked per the business decision):

```
# managed by Frame — machine-local; edit outside this block
runtime/
index/
worktrees/
orchestration/
bin/
migration-backup/
implement-permissions.json
specs/*/implement-report.html
specs/*/plan-report.html
specs/*/report-data.json
*.bak
*.tmp
*.corrupt-*
# end managed by Frame
```

**Pointer file** `.claude/rules/frame.md`:

```
<!-- Written by Frame. Loads Frame's project instructions; delete to detach. -->
@../../.frame/AGENTS.md
```

**Sharing modes** (`config.settings.gitSharing`):

| mode | `.git/info/exclude` (anchored) | hooks file | `.frame/.gitignore` |
| --- | --- | --- | --- |
| `repo` | block removed | `.claude/settings.json` | managed block present |
| `local` | `/.frame/`, `/.claude/rules/frame.md` — only while `.frame/` is untracked | `.claude/settings.local.json` | managed block present |

`gitExclude` resolves the exclude file via `git rev-parse --git-path info/exclude` (correct for linked worktrees and sub-directory projects, where the path is prefixed with `git rev-parse --show-prefix`), rewrites only its own marker block, and is a no-op outside git. Tracked state = `git ls-files --cached -- .frame/` non-empty. `gitSharing.setMode` writes config, applies exclude, and moves Frame's hook entries between the two settings files; it never runs `git rm` — a tracked `.frame/` under `local` yields a warning string for the UI.

**Init (new project)** writes, in order: `.frame/config.json` (`projectId`, `settings.gitSharing`, no `files` record), `.frame/{AGENTS,PROJECT_NOTES,QUICKSTART}.md`, `.frame/{STRUCTURE,tasks}.json`, `.frame/docs/REFERENCE.md`, `.frame/specs/.gitkeep`, `.frame/bin/` (codex wrapper + staged parsers + command files), `.frame/.gitignore`, `.claude/rules/frame.md`, hook entries in the mode's settings file, `.git/hooks/pre-commit` (vanilla only), `.git/info/exclude` (local only). It reads nothing it will delete: the consume/symlink block (`frameProject.js:243-267, 300-334`) and `createSymlinkSafe` are removed.

**Migration (`layoutMigration.js`)** — `plan(projectPath)` is pure (returns artifacts with dispositions `move` / `delete-identical` / `backup-conflict`, symlinks to remove, restorable `CLAUDE.md` block, dirty list, tracked list); `run(projectPath, plan, onProgress)` executes. Fingerprint: `config.files` record **and** at least one listed file at the root. Dirty check: `git status --porcelain -- <rels>` with lines compared against `show-prefix + rel`. Moves: copy to `.frame/migration-backup/<name>` and `.frame/<name>` via `fsSafe.writeFileAtomic`, byte-compare, then unlink root. Conflict: root differs from existing `.frame/` copy → root goes to backup only, reported. Then: remove Frame-planted `CLAUDE.md`/`GEMINI.md` symlinks (target basename `AGENTS.md`), restore `CLAUDE.md` from the `## Existing Instructions (from CLAUDE.md)` block verbatim, targeted `AGENTS.md` edit, write pointer, replace hook entries, `ensureProjectId`, drop `files` record, write `.frame/.gitignore`, apply sharing mode (derived: `repo` if any artifact was tracked, else `local`), refresh staged scripts (`structureBootstrap.copyParserScripts`), log `migration.*` activity events, return receipt. Idempotent: a second `plan()` finds no fingerprint.

**Remove Frame** (`frameProject.removeFrame`): delete `.frame/`, `.claude/rules/frame.md`, Frame hook entries from both settings files, the pre-commit marker block, the exclude block; `workspace.removeProject`. Never touches user files.

### Flows touched by IPC

- `CHECK_IS_FRAME_PROJECT` → main additionally answers `layout: 'overlay' | 'legacy' | 'none'`; renderer opens the migration modal on `legacy`.
- New: `GET_LAYOUT_MIGRATION_PLAN`, `RUN_LAYOUT_MIGRATION` (invoke), `LAYOUT_MIGRATION_PROGRESS` (send), `GET_GIT_SHARING_STATE`, `SET_GIT_SHARING`, `REMOVE_FRAME_FROM_PROJECT`, `LOAD_STRUCTURE_MAP`.

## Files

**New**
- `src/main/frameStore.js` — data-centric meta-file seam (resolution rule, typed read/write, projectId, `LOAD_STRUCTURE_MAP` handler).
- `src/main/gitExclude.js` — `.git/info/exclude` marker block: ensure/remove anchored entries, tracked detection, worktree/sub-dir aware, non-git no-op.
- `src/main/gitSharing.js` — `gitSharing` mode read/write, `.frame/.gitignore` managed block, hook-file target per mode, UI state (mode, tracked, warning).
- `src/main/layoutMigration.js` — legacy → `.frame/` migration: pure `plan()`, `run()`, receipt, activity events.
- `src/renderer/migrationModal.js` — consent modal (plan summary → Migrate/Later → progress → receipt).
- `test/frameStore.test.js` — resolution rule (overlay / legacy / new-file), typed read/write round-trips, projectId stamping, atomic write + `.bak`.
- `test/gitExclude.test.js` — block add/remove, anchored entries, user lines preserved, linked worktree resolves the common exclude, sub-dir prefix, non-git no-op, tracked detection.
- `test/gitSharing.test.js` — mode switch effects on exclude + hook file target + `.frame/.gitignore`; tracked-under-local warns, never `git rm`; user lines outside the block preserved.
- `test/layoutMigration.test.js` — fingerprint (symlink-only repo untouched; `files`-record project planned), dirty deferral incl. sub-dir project, move/identical/conflict dispositions, byte-equal backup, symlink removal, `CLAUDE.md` restoration verbatim, targeted `AGENTS.md` edit, hook replacement, idempotent second run, interrupted-run reconciliation, receipt shape.
- `test/frameProjectInit.test.js` — init on a scratch repo with Electron stubbed: tree-walk asserts only `.frame/`, `.claude/rules/frame.md`, `.claude/settings*.json`, `.git/` internals changed; user `CLAUDE.md`/`.claude/CLAUDE.md`/`AGENTS.md`/`.cursorrules`/`.husky/pre-commit` checksum-equal; `repo` vs `local` side effects; re-init idempotent; non-initialized project + agent launch writes nothing; `removeFrame` leaves no Frame bytes.
- `test/scriptsProjectRoot.test.js` — copies `scripts/{update-structure,find-module,check-freshness}.js` into `<tmp>/.frame/bin/` and runs them without env: `update-structure.js` writes `<tmp>/.frame/STRUCTURE.json` with the fixture's modules; `find-module`/`check-freshness` resolve the same root; `FRAME_PROJECT_ROOT` still wins.
- `test/nativeContext.test.js` — scratch repo with a user `CLAUDE.md` ("tabs") + `.frame/AGENTS.md` (marker) + `.claude/rules/frame.md`; `claude -p` with no Frame flags must report both; skipped when `claude` is absent or `CI` is set.

**Modified**
- `src/shared/frameConstants.js` — `CLAUDE_RULE_PATH`, `FRAME_GITIGNORE_FILE`, `LEGACY_SYMLINKS` (`CLAUDE.md`, `GEMINI.md`), `FRAME_FILE_CLASSES`, `MIGRATION_BACKUP_DIR`; `FRAME_FILES.GEMINI_SYMLINK` dropped.
- `src/shared/frameTemplates.js` — AGENTS template: `.frame/` paths in Navigation and the reference table, footer note replaced (pointer sentence, no symlink); config template: `projectId`, `settings.gitSharing`, no `files`; new `getClaudeRuleTemplate()`, `getFrameGitignoreBlock()`; `SPEC_HINT_HOOKS` moved here with the guarded command; Codex wrapper finds `.frame/AGENTS.md`; structure hook snippet stages `.frame/STRUCTURE.json`; REFERENCE template prose → `.frame/…` names.
- `src/main/frameProject.js` — init rewrite (no root files, no consume, no symlinks, pointer, hooks via mode, projectId, sharing radio value); `checkExistingFrameFiles` / confirmation text; `installSpecHintHook(projectPath, {file})` + `removeSpecHintHook`; `ensureClaudePointer`; `removeFrame`; spec-driven enable/disable/upgrade read `.frame/AGENTS.md` via `frameStore`; `CHECK_IS_FRAME_PROJECT` answers layout; new IPC handlers (sharing, remove, migration).
- `src/main/tasksManager.js` — paths and reads/writes via `frameStore`; watcher watches `frameStore.metaDir()`.
- `src/main/overviewManager.js` — `loadStructure/loadTasks/loadDecisions` via `frameStore`.
- `src/main/structureBootstrap.js` — lefthook/husky snippet text, `hasFrameSnippet` target, `copyParserScripts` exported for migration, initial scan target `.frame/STRUCTURE.json`.
- `src/main/orchestrationManager.js` — merge-reconcile message names `.frame/tasks.json` / `.frame/PROJECT_NOTES.md`.
- `src/main/index.js` — `frameStore.setupIPC(ipcMain)`; wire `gitSharing`/`layoutMigration` init with `activityLog`.
- `src/shared/ipcChannels.js` — the seven new channels.
- `src/renderer/structureMap.js` — `ipcRenderer.invoke(LOAD_STRUCTURE_MAP)` instead of `fs`.
- `src/renderer/state.js` — init modal passes the selected sharing mode; opens `migrationModal` on `layout: 'legacy'`.
- `src/renderer/settingsModal.js` — Workflow section: Git sharing select (+ warning line) and "Remove Frame from this project" (confirm → `REMOVE_FRAME_FROM_PROJECT`).
- `src/renderer/index.js` — "Created:" line lists the new layout; `migrationModal.init()`.
- `src/renderer/sampleBanner.js` — strings name `.frame/QUICKSTART.md` / `.frame/AGENTS.md`.
- `index.html` — init modal file list (new layout, sharing radios, Claude Code version note), Workflow rows, migration modal markup.
- `src/renderer/styles/components/settings-modal.css` — sharing row + remove button styles.
- `src/renderer/styles/components/ui.css` — migration modal list/receipt styles (same family as the init modal).
- `scripts/update-structure.js`, `scripts/find-module.js`, `scripts/check-freshness.js` — root resolution like `spec-index.js:51-54` (`.frame/bin` → project; `scripts` → repo; `FRAME_PROJECT_ROOT` wins) + `resolveMetaPath` (overlay first, legacy fallback, never create at root).
- `.githooks/pre-commit` — stage `.frame/STRUCTURE.json` (root fallback until this repo migrates).
- `src/templates/orchestration/CONDUCTOR.md`, `src/templates/orchestration/WORKER.md`, `src/templates/commands/claude-code/spec.implement.md`, `src/templates/commands/claude-code/spec.tasks.md`, `src/templates/commands/claude-code/spec.plan.md` — prose paths → `.frame/tasks.json`, `.frame/PROJECT_NOTES.md`.
- `src/templates/CLAUDE.md` — same edits as the AGENTS template (static copy).
- `src/templates/sample-project/**` — converted to the new layout (`.frame/` meta, `.claude/rules/frame.md`, no root `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`).
- `README.md`, `docs/capabilities/index.html`, `docs/index.html` — layout and "how Claude gets context" sections.
- `test/projectAgnostic.test.js`, `test/specDrivenToggle.test.js`, `test/tasksManager.test.js` — expectations follow the new paths/templates.

**Deleted**
- none (the Gemini code paths and `createSymlinkSafe` are removed inside `frameProject.js`).

## Footprint
- src/main/frameStore.js
- src/main/gitExclude.js
- src/main/gitSharing.js
- src/main/layoutMigration.js
- src/main/frameProject.js
- src/main/tasksManager.js
- src/main/overviewManager.js
- src/main/structureBootstrap.js
- src/main/orchestrationManager.js
- src/main/index.js
- src/shared/frameConstants.js
- src/shared/frameTemplates.js
- src/shared/ipcChannels.js
- src/renderer/migrationModal.js
- src/renderer/structureMap.js
- src/renderer/state.js
- src/renderer/settingsModal.js
- src/renderer/index.js
- src/renderer/sampleBanner.js
- src/renderer/styles/components/settings-modal.css
- src/renderer/styles/components/ui.css
- index.html
- scripts/update-structure.js
- scripts/find-module.js
- scripts/check-freshness.js
- .githooks/pre-commit
- src/templates/orchestration/CONDUCTOR.md
- src/templates/orchestration/WORKER.md
- src/templates/commands/claude-code/spec.implement.md
- src/templates/commands/claude-code/spec.tasks.md
- src/templates/commands/claude-code/spec.plan.md
- src/templates/CLAUDE.md
- src/templates/sample-project/**
- README.md
- docs/capabilities/index.html
- docs/index.html
- test/frameStore.test.js
- test/gitExclude.test.js
- test/gitSharing.test.js
- test/layoutMigration.test.js
- test/frameProjectInit.test.js
- test/scriptsProjectRoot.test.js
- test/nativeContext.test.js
- test/projectAgnostic.test.js
- test/specDrivenToggle.test.js
- test/tasksManager.test.js

## Dependencies
None. `projectId` uses `crypto.randomUUID()`; git operations use `child_process` as `gitStatusManager`/`structureBootstrap` already do.

## Sequencing

1. **Seam under the existing layout** — add `frameConstants` additions, `frameStore.js` with the resolution rule and typed API, `LOAD_STRUCTURE_MAP`; route `tasksManager` (incl. watcher dir), `overviewManager`, `frameProject`'s spec-driven read/write paths and `structureMap.js` through it. Behaviour is unchanged for every existing project (legacy fallback). Tests: `test/frameStore.test.js`; `test/tasksManager.test.js` adjusted.
2. **Scripts resolve the project root correctly** — `update-structure.js`, `find-module.js`, `check-freshness.js` adopt the `.frame/bin`-aware root + `resolveMetaPath`; `.githooks/pre-commit` and the structure hook snippet stage `.frame/STRUCTURE.json` with root fallback. Tests: `test/scriptsProjectRoot.test.js`.
3. **Init writes the new layout, natively delivered** — `frameTemplates` (AGENTS/config/rule/Codex/REFERENCE/hooks), `frameProject.runProjectInit` rewrite (no root files, no consume, no symlinks, pointer, guarded hooks, `projectId`), confirmation/modal/"Created:" strings, `sampleBanner` strings, `src/templates/CLAUDE.md`, sample-project conversion. Tests: `test/frameProjectInit.test.js` (tree-walk, byte-identical user files, re-init idempotent, non-initialized launch writes nothing), `test/nativeContext.test.js`, `test/projectAgnostic.test.js` + `test/specDrivenToggle.test.js` adjusted.
4. **Sharing mode** — `gitExclude.js`, `gitSharing.js`, `.frame/.gitignore` block, init radios (`repo` pre-selected), Settings → Workflow sharing control with tracked-under-local warning, `GET_GIT_SHARING_STATE`/`SET_GIT_SHARING`. Tests: `test/gitExclude.test.js`, `test/gitSharing.test.js`.
5. **Consented migration** — `layoutMigration.js` (plan/run/receipt/activity events, `copyParserScripts` reuse), `CHECK_IS_FRAME_PROJECT` layout answer, `GET_LAYOUT_MIGRATION_PLAN`/`RUN_LAYOUT_MIGRATION`/`LAYOUT_MIGRATION_PROGRESS`, `migrationModal.js` + markup + styles, `state.js` wiring. Tests: `test/layoutMigration.test.js`.
6. **Remove Frame** — `frameProject.removeFrame` + `REMOVE_FRAME_FROM_PROJECT` + the Workflow button with confirm; `removeSpecHintHook`, exclude/pre-commit block removal. Tests: removal cases in `test/frameProjectInit.test.js`.
7. **Prose and docs follow the layout** — orchestration and spec command templates, `orchestrationManager` message, README, `docs/capabilities/index.html`, `docs/index.html` (layout, pointer file, sharing modes, Claude Code minimum version).
8. **Dogfood: migrate this repository** — open it in the built app, accept the migration modal, verify the receipt and `git status` (`.frame/*` added, root files deleted, `CLAUDE.md` symlink gone, `.claude/rules/frame.md` added), run `npm test` and `npm run structure`, commit as `chore: move Frame meta into .frame/`. This is success criterion 5 on the real project.
