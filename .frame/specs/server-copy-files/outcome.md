
## T01 — File archive format and path guard

Added `src/shared/fileArchive.js`, a gzip (Node `zlib`) record format: a magic line, then for each entry a uint32 header length, a header JSON `{ path, type, mode, size, target? }` and the bytes. It provides `pack`, `readEntries` (refuses foreign, truncated or corrupt input; inflation capped at 1.1 GB) and `checkEntries`. `checkEntries` returns the first entry that must not be written: absolute, backslash, non-normalized (`./a`, `a//b`, `a/../b`), `..`, inside `.git`, duplicate, unknown type, a mode outside 0–0o7777, or a symlink resolving outside the folder or into `.git`. Beyond the plan, non-normalized paths and duplicates are also refused, so each path names exactly one file. Tests in `test/fileArchive.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T02 — Selection rules for the send-files modal

Added `src/shared/sendFilesModel.js` (pure). `buildTree` builds the ignored and untracked groups from git's lists; collapsed folders are leaves, and leaves carry size, `sizeCut`, `heavy` and server state. `defaultSelection` ticks `copyFiles` matches, never heavy or server-identical ones. The module also has `toggle`, `selectAll`, `selectionSize`, `sizeVerdict` (ok, warn above 50 MB, refuse above 1 GB), `patternsFor` and `mergePatterns`. `patternsFor` remembers ignored leaves only: a root file becomes `/.env`, so it is not every `.env` at any depth; nested paths stay as they are, being already anchored; a folder becomes `folder/**`. The heavy list (`node_modules`, `.venv`, `dist`, `build`, `.next`, caches, `.DS_Store`…) adds `.parcel-cache` and `.gradle` to the plan's list. Tests in `test/sendFilesModel.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---
