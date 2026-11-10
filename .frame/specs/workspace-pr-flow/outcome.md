
## T01 — Add the pure core prFlow.js

Added `src/shared/prFlow.js`: `parseCount`, `checksSummary` (CheckRun status/conclusion and StatusContext state → passing/failing/pending with failing names; SKIPPED/NEUTRAL count as passing), `mapPrView` (draft/open/merged/closed; `ready` = open, not draft, MERGEABLE, no failing or pending checks), `sectionLead`, `composePr` (spec → title + Why/What from the Problem/Goal leads + Done from outcome.md task headings + the spec path; no spec → oldest commit subject as title, subjects oldest-first as the body), `pickMergeMethod` (setting only when allowed, else squash → merge → rebase; unknown flags count as allowed), `fixChecksPrompt` (names checks, `gh pr checks`, `gh run view --log-failed`, tells the agent not to push) and `isPushable` (refuses the base). `normalizeSettings` gained `mergeMethod` (null = repo default) and `archiveOnMerge` (default true). Tests: `test/prFlow.test.js` (9) and an extended `test/workspaceRegistry.test.js`.

_Captured: 2026-11-10 · 4 file change(s)_

---
