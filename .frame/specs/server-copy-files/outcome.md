
## T01 — File archive format and path guard

Added `src/shared/fileArchive.js`, a gzip (Node `zlib`) record format: a magic line, then for each entry a uint32 header length, a header JSON `{ path, type, mode, size, target? }` and the bytes. It provides `pack`, `readEntries` (refuses foreign, truncated or corrupt input; inflation capped at 1.1 GB) and `checkEntries`. `checkEntries` returns the first entry that must not be written: absolute, backslash, non-normalized (`./a`, `a//b`, `a/../b`), `..`, inside `.git`, duplicate, unknown type, a mode outside 0–0o7777, or a symlink resolving outside the folder or into `.git`. Beyond the plan, non-normalized paths and duplicates are also refused, so each path names exactly one file. Tests in `test/fileArchive.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T02 — Selection rules for the send-files modal

Added `src/shared/sendFilesModel.js` (pure). `buildTree` builds the ignored and untracked groups from git's lists; collapsed folders are leaves, and leaves carry size, `sizeCut`, `heavy` and server state. `defaultSelection` ticks `copyFiles` matches, never heavy or server-identical ones. The module also has `toggle`, `selectAll`, `selectionSize`, `sizeVerdict` (ok, warn above 50 MB, refuse above 1 GB), `patternsFor` and `mergePatterns`. `patternsFor` remembers ignored leaves only: a root file becomes `/.env`, so it is not every `.env` at any depth; nested paths stay as they are, being already anchored; a folder becomes `folder/**`. The heavy list (`node_modules`, `.venv`, `dist`, `build`, `.next`, caches, `.DS_Store`…) adds `.parcel-cache` and `.gradle` to the plan's list. Tests in `test/sendFilesModel.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T03 — Frame Server receives and compares files

Added `src/server/sendFiles.js`, registered in `src/server/index.js`. `files.compare` answers same, changed or missing: SHA-256 for files up to 5 MB, size otherwise, and a folder only as present or missing. `files.receive` reads only a `files-*.fpk` upload in the server's tmp folder and refuses the whole send on the first bad entry (`fileArchive.checkEntries`), before writing anything. It writes each file through a temp file and a rename with its mode: ignored files to the workspace and the main copy, `untracked` paths to the workspace only. It reports written, overwritten, skipped and toMainCopy, and removes the archive in `finally`. Both methods use the same project/workspace guard as `specs.js`. Beyond the plan: a file whose path passes through a folder that is a symlink (or a file) on the server is skipped with the reason, never followed, so an archive that is clean on its own cannot write outside through the target's own symlinks. `files.receive` takes the untracked list as a parameter, because the archive records carry no group. Tests in `test/serverSendFiles.test.js` run against a project received by bundle and a real server workspace.

_Captured: 2026-11-15 · 3 file change(s)_

---

## T04 — The desktop's copyFiles patterns reach server workspace creation

`workspaceManager.copyIgnoredFiles` takes optional `patterns`, and `create` takes `copyFiles` and passes it through. `createOnServer` sends this desktop's `copyFiles` with `workspaces.create`. Frame Server's `projects.js` forwards only a list of strings, so a new server workspace gets the files from the main copy that match the desktop's patterns. An empty list copies nothing. With no patterns passed (an older desktop), the server falls back to its own config, as before. Tests in `test/serverSendFiles.test.js`; the desktop half (`createOnServer` actually sending them) is pinned in T05's `test/sendFilesDesktop.test.js`.

_Captured: 2026-11-15 · 3 file change(s)_

---

## T05 — Desktop lists and sends files

Added `src/main/sendFiles.js`, with the `SEND_FILES_LIST` / `SEND_FILES_SEND` channels in `src/shared/ipcChannels.js`, registered in `src/main/index.js`. `list` runs git's ignored list (`--directory`, so ignored folders come collapsed) and untracked list. It sizes collapsed folders with a walk capped at 20 000 entries and 300 ms, hashes files up to 5 MB outside heavy folders, asks `files.compare`, and returns the raw lists, sizes, server states and `copyFiles` for the renderer to build the tree. `send` re-reads the candidates and refuses any path git does not leave out. It packs files, symlinks and whole collapsed folders with their modes, refuses above 1 GB, writes the archive 0600 to a temp file, uploads it, and calls `files.receive` with the untracked paths. Remember merges `patternsFor` into `copyFiles` via `frameProject.setWorkspaceSettings`; an older server gets 'Update Frame Server…'. Deviations: `.frame/` is never offered, because the server provisions its own tooling and in local mode that folder holds tasks.json and specs; and `list` returns raw lists rather than tree nodes, since the tree is built by the shared model in the renderer. The 1 GB refusal is tested in `sendFilesModel`, not with a real 1 GB file. Tests in `test/sendFilesDesktop.test.js`, including T04's desktop half (`createOnServer` sends the patterns).

_Captured: 2026-11-15 · 4 file change(s)_

---

## T06 — The send-files modal and its entry points

Added `src/renderer/sendFilesModal.js`, built on the shared `spec-modal` shell, with styles in `send-files-modal.css` imported from `main.css`. It shows two groups (Ignored by git / Not committed yet) with checkboxes, tri-state folders, Select all / none, labels for server state and heavy folders, a size line with warnings, Remember, and Send or Skip / Continue without files. `newWorkspaceModal` opens it for a server workspace before `runSetupThenAgent`, and the row menu of a connected server workspace offers 'Send files to server…'; both show a summary notice. Added `formatBytes` to `sendFilesModel`. The live check (an isolated app driven through the real New workspace modal, against a server package built from this branch) found two defects, both fixed with regression tests. (1) The server's main copy can be checked out at a commit older than `.gitignore`: a sent `.env` then showed as untracked there and would never reach new workspaces. `files.receive` now writes sent paths into the main copy's `.git/info/exclude` under a Frame-managed block. (2) Git can list a collapsed folder and a path inside it: `buildTree` now drops paths under a collapsed folder, so `.claude/` appeared only once. A folder that exists on the server is labelled 'folder on the server', since its contents are not compared. Confirmed live: defaults; `.frame/` not offered; files with mode 0600 in the workspace and the main copy; a clean main copy; resend labels; Remember; a second server workspace receiving `.env` by itself.

_Captured: 2026-11-15 · 11 file change(s)_

---
