
## T01 — Add the pure core prFlow.js

Added `src/shared/prFlow.js`: `parseCount`, `checksSummary` (CheckRun status/conclusion and StatusContext state → passing/failing/pending with failing names; SKIPPED/NEUTRAL count as passing), `mapPrView` (draft/open/merged/closed; `ready` = open, not draft, MERGEABLE, no failing or pending checks), `sectionLead`, `composePr` (spec → title + Why/What from the Problem/Goal leads + Done from outcome.md task headings + the spec path; no spec → oldest commit subject as title, subjects oldest-first as the body), `pickMergeMethod` (setting only when allowed, else squash → merge → rebase; unknown flags count as allowed), `fixChecksPrompt` (names checks, `gh pr checks`, `gh run view --log-failed`, tells the agent not to push) and `isPushable` (refuses the base). `normalizeSettings` gained `mergeMethod` (null = repo default) and `archiveOnMerge` (default true). Tests: `test/prFlow.test.js` (9) and an extended `test/workspaceRegistry.test.js`.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T02 — Add git and gh primitives

`gitBranchesManager.js` gained a PR-flow section on `execGitArgs`: `revCount`, `upstreamOf` (`@{u}` or null), `pushBranch` (`push -u origin <branch>` on first push, plain `push` after; 120 s; never forces), `commitSubjects` (newest first, capped) and `fastForwardIfOn` (`pull --ff-only origin <branch>` only when the main checkout is on that branch with no tracked changes). Divergence from the first cut: the cleanliness check ignores untracked files — `worktreeStatus` counts them, which would have blocked every fast-forward in a checkout with an untracked `.env`; `pull --ff-only` already refuses to clobber one. `githubManager.js` gained an argv `runGh(args, cwd, { stdin, timeout })` (execFile, body via stdin) and exports it. Smoke-tested on the scratch repo with a local bare origin: no upstream → `push -u` sets `origin/ws/pushtest`, unpushed 2 → 0, a third commit pushes alone, the remote branch exists, main fast-forwards, and a wrong-branch request is refused with the reason.

_Captured: 2026-11-10 · 2 file change(s)_

---
