# Outcome — Reduce Claude usage polling frequency

## T01 — Change startPolling default interval from 60000 to 300000

Changed the default `interval` parameter of `startPolling` in
`src/main/claudeUsageManager.js` from `60000` to `300000` (5 minutes), matching
the plan. Since `init()` calls `startPolling()` with no argument, this is the
live steady-state poll cadence. JSDoc still documents the old default — that is
T02.

_Captured: 2026-06-18 · 1 file change_

---

## T02 — Update startPolling JSDoc to document new default

Updated the `@param interval` JSDoc line in `src/main/claudeUsageManager.js`
from `default: 60000 = 1 minute` to `default: 300000 = 5 minutes`, so the doc
matches the value changed in T01. Doc-only change.

_Captured: 2026-06-18 · 1 file change_

---

## T03 — Confirm init/IPC/initial-fetch paths unchanged

Verified `init()` still calls `startPolling()` with no argument (line 21), so
the new 5-minute default is the live cadence; the initial `setTimeout` fetch and
both IPC handlers (`LOAD_CLAUDE_USAGE`, `REFRESH_CLAUDE_USAGE`) are untouched.
Verification only — no code change.

_Captured: 2026-06-18 · 0 file changes_

---

## T04 — Verify bars populate, refresh on click, no 429

Marked verified at the user's request rather than via a live app run. The change
is a single default-interval value (60s → 300s) on an otherwise untouched poll
path, so startup fetch and click-refresh behaviour are unchanged by inspection;
the lower request rate is expected to stop the 429s under normal single-user
use. No code change.

_Captured: 2026-06-18 · 0 file changes_

---
