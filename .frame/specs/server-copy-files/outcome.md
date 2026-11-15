
## T01 — File archive format and path guard

Added `src/shared/fileArchive.js`, a gzip (Node `zlib`) record format: a magic line, then for each entry a uint32 header length, a header JSON `{ path, type, mode, size, target? }` and the bytes. It provides `pack`, `readEntries` (refuses foreign, truncated or corrupt input; inflation capped at 1.1 GB) and `checkEntries`. `checkEntries` returns the first entry that must not be written: absolute, backslash, non-normalized (`./a`, `a//b`, `a/../b`), `..`, inside `.git`, duplicate, unknown type, a mode outside 0–0o7777, or a symlink resolving outside the folder or into `.git`. Beyond the plan, non-normalized paths and duplicates are also refused, so each path names exactly one file. Tests in `test/fileArchive.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---
