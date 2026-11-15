# Plan — Send git-ignored files to a server

## Architecture

### Resolved plan-time decisions

The user accepted every recommendation on 2026-11-15 ("önerilerinle ilerleyelim").

Business:
- **B1 A file that already exists on the server.** Overwrite what the user ticked. The modal already shows each entry as "on the server" or "changed on this Mac", so ticking is the consent. Entries identical on the server start unticked, and the notice lists what was overwritten. Rejected: skip by default with a per-file "overwrite" box, which asks for the same consent twice.
- **B2 Where sent files go.** Every send writes into the target server workspace and into the server's main copy of the project. The main copy is "what was last sent".
  - When a server workspace is created, the desktop passes its own `copyFiles` patterns with `workspaces.create`. The server copies matching files from the main copy into the new worktree. This works the same in `repo` and `local` mode, and a pattern saved with "Remember" applies at once.
  - Untracked-but-not-ignored files go to the workspace only. In the main copy they would make it look dirty.

  Rejected: workspace-only, which means resending from the Mac for every workspace.
- **B3 Size.** Warn above 50 MB; refuse above 1 GB. Rejected: warning only. A selection that large is almost always a dependency or build folder ticked by mistake.

Technical:
- **T1 Test posture: everything testable.**
  - The archive format, path guard and modes.
  - The selection rules: defaults, heavy folders, size, Remember → patterns.
  - The server's receive and compare: main copy vs workspace, the untracked group.
  - The desktop send path with a stubbed connection and upload.
  - The `copyFiles` hand-off on create.
  - The modal's DOM is untested (no DOM harness). Rejected: pure logic only.
- **T2 (silent) Archive format.** A small format in `src/shared/fileArchive.js`, gzip via Node's `zlib`, one record per entry: `{ path, type: 'file'|'symlink', mode, size, target? }` followed by the bytes. System `tar` is not used: bsdtar and GNU tar differ, and every path has to be validated before anything is written. The whole archive is refused if any entry:
  - is absolute, or contains `..`;
  - is or lies under `.git`;
  - is a symlink whose target resolves outside the target folder.
- **T3 (silent) Order.** The modal opens after a server workspace is created and before its setup script and agent start (`newWorkspaceModal` → `runSetupThenAgent`), because setup often needs `.env`.
- **T4 (silent) Heavy folders.** `node_modules`, `.venv`, `venv`, `dist`, `build`, `.next`, `.nuxt`, `.cache`, `target`, `__pycache__`, `.turbo`, `coverage` and `.DS_Store` start collapsed and unticked, with the note "rebuild on the server". Their size comes from a bounded walk: at most 20 000 entries and 300 ms, shown as "≥ N MB" when cut. Their contents are never hashed or compared.
- **T5 (silent) Comparison cost.** The desktop hashes (SHA-256) only files ≤ 5 MB outside heavy folders; larger files compare by size. The server answers `files.compare` with the same rule. Nothing is hashed until the modal opens.
- **T6 (silent) Older Frame Server.** "Unknown method" on `files.compare` or `files.receive` makes the modal say "Update Frame Server to send files". No protocol bump.

### Data shapes

```
SEND_FILES_LIST  { projectPath, workspaceId } → { groups: { ignored: [node], untracked: [node] }, compared: bool, error? }
  node: { path, type: 'file'|'dir', size, sizeCut?, heavy?, children?, server?: 'same'|'changed'|'missing' }
SEND_FILES_SEND  { projectPath, workspaceId, paths: [rel], remember: bool } → { sent: [rel], overwritten: [rel], skipped: [{ path, reason }], error? }

files.compare { projectPath, root, entries: [{ path, size, sha256|null }] } → { [path]: 'same'|'changed'|'missing' }
files.receive { archive: 'files-<rand>.fpk', projectPath, root } → { written: [rel], overwritten: [rel], toMainCopy: [rel] }
workspaces.create + { copyFiles: [pattern] }
```

### Components

- `src/shared/fileArchive.js` (**New**, pure): `pack(entries)` builds the archive as a Buffer; `readEntries(buffer)` parses it; `checkEntries(entries, root)` returns the first violation or null. Everything is validated before any write.
- `src/shared/sendFilesModel.js` (**New**, pure):
  - `buildTree(ignoredPaths, untrackedPaths, sizes)`.
  - `defaultSelection(tree, copyFiles)`: `copyFiles` matches ticked, heavy folders and server-identical entries unticked.
  - `isHeavy(path)`, `selectionSize(tree, selected)` and `sizeVerdict(bytes)` (ok / warn above 50 MB / refuse above 1 GB).
  - `patternsFor(selected)` turns the selection into `copyFiles` patterns for Remember: a file stays its path, and a fully ticked folder becomes `folder/**`.
- `src/main/sendFiles.js` (**New**):
  - The IPC for `SEND_FILES_LIST` and `SEND_FILES_SEND`.
  - Lists the ignored paths with the existing `git.listIgnoredCandidates`, and `listIgnoredIn` when a folder is expanded, plus `ls-files --others --exclude-standard`.
  - Does the bounded sizes, hashes and `files.compare`.
  - Packs into a temp file, uploads it with `serverInstaller.upload` to `.frame-server/tmp/files-<rand>.fpk`, then calls `files.receive`.
  - Remember merges the patterns into `copyFiles` through `frameProject.setWorkspaceSettings`.
- `src/server/sendFiles.js` (**New**):
  - `files.compare` and `files.receive`, with the same project/workspace guard as `specs.js`: a registered project and one of its active workspaces.
  - Receive accepts only `files-*.fpk` in the server's tmp folder and validates every entry first.
  - It writes each file via a temp file and rename with its mode, ignored files to both the workspace and the main copy, untracked files to the workspace only.
  - It removes the archive in `finally`.
- `src/main/workspaceManager.js`:
  - `copyIgnoredFiles(projectPath, worktreePath, patterns?)` uses the given patterns when passed.
  - `create(…, { copyFiles })` passes them through.
  - `createOnServer` sends the desktop's `copyFiles` with `workspaces.create`.
- `src/server/projects.js`: `workspaces.create` forwards `copyFiles`.
- `src/renderer/sendFilesModal.js` (**New**): the tree with checkboxes, "Select all", per-folder toggles, server-state labels, the size line and warnings, "Remember for this project", Send / Skip.
- `src/renderer/newWorkspaceModal.js`: for a server workspace, opens the modal before `runSetupThenAgent`, and adds what was sent to the notice.
- `src/renderer/workspaceSection.js`: the row menu gets "Send files to server…" for connected server workspaces.

## Files

- `src/shared/fileArchive.js` — **New**: archive pack/read and path guard
- `src/shared/sendFilesModel.js` — **New**: tree, defaults, heavy folders, size verdict, Remember patterns
- `src/main/sendFiles.js` — **New**: list, compare, pack, upload, receive; IPC
- `src/main/index.js` — **Modified**: register `sendFiles.setupIPC`
- `src/shared/ipcChannels.js` — **Modified**: `SEND_FILES_LIST`, `SEND_FILES_SEND`
- `src/main/workspaceManager.js` — **Modified**: `copyFiles` override in `copyIgnoredFiles` / `create`; `createOnServer` passes the desktop's patterns
- `src/server/sendFiles.js` — **New**: `files.compare`, `files.receive`
- `src/server/index.js` — **Modified**: register the part
- `src/server/projects.js` — **Modified**: `workspaces.create` forwards `copyFiles`
- `src/renderer/sendFilesModal.js` — **New**: the modal
- `src/renderer/newWorkspaceModal.js` — **Modified**: modal before setup, notice
- `src/renderer/workspaceSection.js` — **Modified**: "Send files to server…" row action
- `src/renderer/styles/components/send-files-modal.css` — **New**: modal styles
- `src/renderer/styles/main.css` — **Modified**: import it
- `test/fileArchive.test.js` — **New**: round trip, modes, symlinks, every refusal
- `test/sendFilesModel.test.js` — **New**: tree, defaults, heavy, size verdict, patterns
- `test/serverSendFiles.test.js` — **New**: receive (main copy vs workspace, overwrite, modes, escape refusal, tmp guard), compare, `copyFiles` on create
- `test/sendFilesDesktop.test.js` — **New**: list groups, compare call, pack + upload + receive with a stubbed connection, Remember, old server, size refusal

## Footprint

- src/shared/fileArchive.js
- src/shared/sendFilesModel.js
- src/main/sendFiles.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/main/workspaceManager.js
- src/server/sendFiles.js
- src/server/index.js
- src/server/projects.js
- src/renderer/sendFilesModal.js
- src/renderer/newWorkspaceModal.js
- src/renderer/workspaceSection.js
- src/renderer/styles/components/send-files-modal.css
- src/renderer/styles/main.css
- test/fileArchive.test.js
- test/sendFilesModel.test.js
- test/serverSendFiles.test.js
- test/sendFilesDesktop.test.js

## Dependencies

None.

## Sequencing

1. **Archive format.** `src/shared/fileArchive.js` with pack, read and the path guard. Tests in `test/fileArchive.test.js`, failing first.
2. **Selection rules.** `src/shared/sendFilesModel.js`. Tests in `test/sendFilesModel.test.js`, failing first.
3. **Frame Server receives and compares.**
   - `src/server/sendFiles.js` (`files.compare`, `files.receive`), registered in `src/server/index.js`.
   - Tests in `test/serverSendFiles.test.js`, failing first.
4. **Patterns on create.**
   - The `copyFiles` override in `workspaceManager.copyIgnoredFiles` / `create`; `projects.js` forwards it; `createOnServer` sends the desktop's patterns.
   - Tests in `test/serverSendFiles.test.js`, failing first.
5. **Desktop list and send.**
   - `src/main/sendFiles.js`, the IPC channels and registration in `src/main/index.js`.
   - Tests in `test/sendFilesDesktop.test.js`, failing first.
6. **The modal and its entry points.**
   - `sendFilesModal.js` and its CSS.
   - Opened from `newWorkspaceModal.js` before setup, and from the row menu in `workspaceSection.js`.
   - Live check in an isolated app against a Frame Server package built from this branch.
