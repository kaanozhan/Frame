# Outcome — Frame footprint: meta files move into `.frame/`, delivery stays native

## T01 — Add `src/main/frameStore.js` and the new `frameConstants` entries

Added `src/main/frameStore.js` as the single owner of meta-file paths: the
overlay → legacy-if-`config.files`-record-and-root-file → overlay rule, plus the
`projectPath`-keyed typed API (`getTasks`/`saveTasks`, `readNotes`/`appendNote`,
`getStructure`/`saveStructure`, `readQuickstart`, `readAgents`/`writeAgents`,
`readConfig`/`writeConfig`, `getProjectId`/`ensureProjectId`, `metaDir`,
`isLegacyLayout`, and `resolvePath` for migration and the IPC layer), reading
from disk and writing through `fsSafe.writeFileAtomic` with its `.bak`.
`src/shared/frameConstants.js` gained `CLAUDE_RULE_PATH`, `FRAME_GITIGNORE_FILE`,
`LEGACY_SYMLINKS`, `MIGRATION_BACKUP_DIR` and `FRAME_FILE_CLASSES`, and dropped
`FRAME_FILES.GEMINI_SYMLINK`; `frameProject.js`'s two remaining `GEMINI.md`
references now use a local constant so init keeps working until T04 deletes that
block. Deviation from plan.md: `getTasks` returns fsSafe's
`{ data, source, error }` record instead of a bare object, because tasksManager's
corruption UX distinguishes "restored from `.bak`" from "nothing to restore", and
`setupIPC`/`LOAD_STRUCTURE_MAP` was left to T02 as planned.

_Captured: 2026-08-22 · 4 file change(s)_

---

## T02 — Route every meta-file caller through the seam

Pointed every meta-file caller at `frameStore`: `tasksManager` (path via
`resolvePath`, read via `getTasks`, write via `saveTasks`, watcher on
`metaDir(projectPath)` keeping the `filename === 'tasks.json'` check, plus a new
`restartWatching(projectPath)` for T09 to call after a migration),
`overviewManager`'s `loadStructure`/`loadTasks`/`loadDecisions`, `frameProject`'s
spec-driven AGENTS.md reads and writes, and `specManager`'s tasks.json watcher
path. Added the `LOAD_STRUCTURE_MAP` channel with `frameStore.setupIPC` wired in
`src/main/index.js`, so `src/renderer/structureMap.js` invokes for the parsed map
and no longer requires `fs`/`path`. Beyond plan.md: `specManager`'s watcher path
was routed too (S6 counts it as a meta-path join even though the module is
exempt for specs), and `test/specTasksSync.test.js` needed its fixture under
`.frame/` for the same reason as `test/tasksManager.test.js`, which also gained a
legacy-layout case. The S6 grep now leaves only `frameProject`'s
`checkExistingFrameFiles` list plus the "Created:" line (T05) and
`structureBootstrap`'s hook snippets (T03).
Followup for T08: `frameStore`'s atomic writes leave `<name>.bak` beside a
legacy artifact at the project root (as `tasks.json.bak` already does today), so
migration must treat a `.bak` sibling of a legacy artifact as Frame's — move it
into `.frame/migration-backup/`, never leave it at the root.

_Captured: 2026-08-22 · 10 file change(s)_

---

## T03 — Scripts resolve their own project root; hooks stage `.frame/STRUCTURE.json`

Gave `update-structure.js`, `find-module.js` and `check-freshness.js` the
`spec-index.js` root rule (`FRAME_PROJECT_ROOT` → `.frame/bin` two up →
`scripts/..` → cwd) and a local `resolveMetaPath` that prefers `.frame/`, falls
back to an existing root file and never creates one at the root; the parser
mkdirs `.frame/` before writing. `.githooks/pre-commit` and
`frameTemplates.getStructureHookSnippet` stage `.frame/STRUCTURE.json` when it
exists and the root copy otherwise, and `structureBootstrap`'s lefthook
instructions and prose follow (`copyParserScripts` was already exported, so
migration's refresh path needed no change). Departure from plan.md:
`check-freshness`'s `resolveMetaPath` returns `{ path, rel }` because its
QUICKSTART check hands the path to git as a pathspec, and
`test/projectAgnostic.test.js` had to follow the parser's new target — the
js-src-app fixture keeps its root golden, so it now covers the legacy fallback
while the other five cover the overlay case.

_Captured: 2026-08-22 · 8 file change(s)_

---

## T04 — Init writes the new layout, delivered natively

Rewrote `runProjectInit` to write only `.frame/*` and `.claude/rules/frame.md`
(new `ensureClaudePointer`), stamp identity via `frameStore.ensureProjectId`,
and install the guarded `sh -c '[ -f .frame/bin/spec-hint.js ] && …'` hooks
through `installSpecHintHook(projectPath, {file})` chosen by sharing mode;
`createSymlinkSafe`, the consume block and every `GEMINI.md` path are deleted,
and `removeSpecHintHook` lands ready for T10. `frameTemplates` moved to `.frame/`
paths throughout and gained `getClaudeRuleTemplate`, `getFrameGitignoreBlock`,
`SPEC_HINT_HOOKS` + `LEGACY_SPEC_HINT_COMMANDS`, a `projectId` and
`settings.gitSharing` in the config template and no `files` record. Departures
from plan.md: re-init carries the existing `projectId`/`gitSharing` forward
rather than regenerating them, and the sample-project conversion (nominally T05)
landed here because the init suite asserts it. `test/nativeContext.test.js`
skips without the CLI but ran for real here — `claude -p` returned both the
repo's own CLAUDE.md codeword and the `.frame/AGENTS.md` one, which is success
criterion 3.

_Captured: 2026-08-23 · 12 file change(s)_

---
