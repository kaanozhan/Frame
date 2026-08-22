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
