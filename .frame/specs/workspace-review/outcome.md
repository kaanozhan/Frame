
## T01 — Add the pure core reviewModel.js

Added `src/shared/reviewModel.js`: `parseNumstat` (`-z` entries incl. binary `-\t-` and the rename form `a\tr\t\0old\0new\0`), `parseNameStatus` (A/M/D/T and R/C with two paths), `mergeChangedFiles` (tracked changes + untracked paths + content hashes → `{ path, oldPath?, status A|M|D|R|U, added, removed, binary, hash }`, deleted files carry no hash, sorted by path, untracked never doubles a tracked path), `reconcileViewed` / `viewedSummary` (a tick survives only an unchanged hash and a path still in the review), `lineAnchor` (new-side line + code with the diff marker stripped; null for old-side-only lines), `composeReviewPrompt` (comments in file/line order with path:line, quoted code, one-line body; ends 'commit, don't push') and `MAX_DIFF_BYTES` (2 MB). `test/reviewModel.test.js` (7) uses fixtures copied from real `git diff -z` output captured on a scratch repo.

_Captured: 2026-11-10 · 2 file change(s)_

---
