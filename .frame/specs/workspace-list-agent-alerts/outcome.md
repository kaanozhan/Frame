## T01 — Attention logic: the waiting queue of a project's agents

Added `src/renderer/workspaces/attention.js` (pure) with `waitingQueue`, `workspaceWait`, `othersWaiting`, `nextWaiting` and `waitLabel`, exported `bucketOf` from `workspaces/rollup.js` for it, and covered all five in `test/workspaceAttention.test.js`. Not in the plan's wording: a wait with no known start sorts last of its kind and labels as the kind alone, under a minute reads `<1m`, an hour or more reads in hours, and the agent name falls back to the terminal's name.
Followup: `test/structureRead.test.js:107` is flaky on the server host (same-tick rewrite), unrelated to this spec.

_Captured: 2026-11-18 · 3 file change(s)_

---
