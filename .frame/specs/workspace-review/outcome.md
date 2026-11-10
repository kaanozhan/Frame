
## T01 — Add the pure core reviewModel.js

Added `src/shared/reviewModel.js`: `parseNumstat` (`-z` entries incl. binary `-\t-` and the rename form `a\tr\t\0old\0new\0`), `parseNameStatus` (A/M/D/T and R/C with two paths), `mergeChangedFiles` (tracked changes + untracked paths + content hashes → `{ path, oldPath?, status A|M|D|R|U, added, removed, binary, hash }`, deleted files carry no hash, sorted by path, untracked never doubles a tracked path), `reconcileViewed` / `viewedSummary` (a tick survives only an unchanged hash and a path still in the review), `lineAnchor` (new-side line + code with the diff marker stripped; null for old-side-only lines), `composeReviewPrompt` (comments in file/line order with path:line, quoted code, one-line body; ends 'commit, don't push') and `MAX_DIFF_BYTES` (2 MB). `test/reviewModel.test.js` (7) uses fixtures copied from real `git diff -z` output captured on a scratch repo.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Review git in main: REVIEW_FILES and REVIEW_FILE_DIFF

REVIEW_FILES lists every change since the merge base (origin/<base>, else local base): committed + uncommitted tracked files with status, +/- and content hash, plus untracked files with line counts. REVIEW_FILE_DIFF returns one file's diff vs the merge base (or --no-index for untracked) with binary detection and the 2 MB ceiling.

_Captured: 2026-11-10 · src/main/gitDiffManager.js,src/shared/ipcChannels.js file change(s)_

---

## T03 — Review tab: file list, diffs, viewed state; opened from the row menu, palette and ⌘⌥R

A Review tab opens over a workspace's changes: left, every changed file (status, +/-) under 'N files · M left'; right, the selected file's diff with Split/Unified. Viewed ticks move to the next unreviewed file, persist per workspace in localStorage and drop when a file's content changes. Opened from 'Review Changes…' (first PR item in the workspace menu), the palette command workspace.review and File ▸ Review Changes… (⌘⌥R); each selects the workspace first.

_Captured: 2026-11-10 · src/renderer/reviewSection.js,src/renderer/workspacePr.js,src/renderer/index.js,src/main/menu.js,src/renderer/styles/components/review.css,src/renderer/styles/main.css file change(s)_

---

## T04 — Line comments in the review tab

Clicking a new-side line number (split or unified) opens an inline comment box under the line (⌘↵ saves, Esc cancels); in split view a matching spacer keeps the old side aligned. Saved comments wait in a Comments list under the files (path:line, quoted code, text) with Edit and Remove, and the commented row is marked. Scroll positions survive re-renders; comments live in memory while the tab is open.

_Captured: 2026-11-10 · src/renderer/reviewSection.js,src/renderer/styles/components/review.css file change(s)_

---

## T05 — Send the review to an agent

Under the pending comments a 'Send to' picker lists the workspace's agent lanes (most recently active first, the default) plus 'New agent'; 'Send review (n)' composes the prompt with composeReviewPrompt and dispatches it through agentDispatch to that lane or a new one, labels the lane 'review: <branch>' and clears the list. A failed dispatch shows an error and keeps the comments and the choice.

_Captured: 2026-11-10 · src/renderer/reviewSection.js,src/renderer/styles/components/review.css file change(s)_

---
