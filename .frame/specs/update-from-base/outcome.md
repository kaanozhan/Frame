
## T01 — Pure update rules in prFlow.js

Added parseConflicts, updateMenuState, conflictPrompt and updateMessage to src/shared/prFlow.js with four tests in test/prFlow.test.js. updateMenuState labels a merge with no conflicted files left 'Finish Merge with Agent' (not in the plan) so a merge whose conflicts are staged but uncommitted still has a way out.

_Captured: 2026-11-10 · 2 file change(s)_

---
