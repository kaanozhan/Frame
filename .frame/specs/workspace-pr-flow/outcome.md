
## T01 — Add the pure core prFlow.js

Added `src/shared/prFlow.js`: `parseCount`, `checksSummary` (CheckRun status/conclusion and StatusContext state → passing/failing/pending with failing names; SKIPPED/NEUTRAL count as passing), `mapPrView` (draft/open/merged/closed; `ready` = open, not draft, MERGEABLE, no failing or pending checks), `sectionLead`, `composePr` (spec → title + Why/What from the Problem/Goal leads + Done from outcome.md task headings + the spec path; no spec → oldest commit subject as title, subjects oldest-first as the body), `pickMergeMethod` (setting only when allowed, else squash → merge → rebase; unknown flags count as allowed), `fixChecksPrompt` (names checks, `gh pr checks`, `gh run view --log-failed`, tells the agent not to push) and `isPushable` (refuses the base). `normalizeSettings` gained `mergeMethod` (null = repo default) and `archiveOnMerge` (default true). Tests: `test/prFlow.test.js` (9) and an extended `test/workspaceRegistry.test.js`.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T02 — Add git and gh primitives

`gitBranchesManager.js` gained a PR-flow section on `execGitArgs`: `revCount`, `upstreamOf` (`@{u}` or null), `pushBranch` (`push -u origin <branch>` on first push, plain `push` after; 120 s; never forces), `commitSubjects` (newest first, capped) and `fastForwardIfOn` (`pull --ff-only origin <branch>` only when the main checkout is on that branch with no tracked changes). Divergence from the first cut: the cleanliness check ignores untracked files — `worktreeStatus` counts them, which would have blocked every fast-forward in a checkout with an untracked `.env`; `pull --ff-only` already refuses to clobber one. `githubManager.js` gained an argv `runGh(args, cwd, { stdin, timeout })` (execFile, body via stdin) and exports it. Smoke-tested on the scratch repo with a local bare origin: no upstream → `push -u` sets `origin/ws/pushtest`, unpushed 2 → 0, a third commit pushes alone, the remote branch exists, main fast-forwards, and a wrong-branch request is refused with the reason.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T03 — Add workspaceGitState in main

Added `src/main/workspaceGitState.js`: per active workspace it reads uncommitted count, upstream, unpushed (`@{u}..HEAD`, or `origin/<base>..HEAD` without an upstream) and behind (`HEAD..origin/<base>`), and — only when gh access is authed with a GitHub repo and the branch is pushed or had a PR last time — `gh pr view <branch> --json …` mapped through `prFlow.mapPrView`; pushes `WORKSPACE_GIT_STATE` for the watched project (set by `WORKSPACE_GIT_REFRESH`), with one `pollGate.gatedInterval` (3 min), a per-window focus refresh, coalesced concurrent refreshes, and a refresh from `workspaceManager.notify`. Channels for the whole PR flow went into `ipcChannels.js`; wired in `src/main/index.js` (re-entrant: the poller is created once, focus is per window). Also made `githubManager.runGh` always close stdin — a fake gh used for testing hung on an open pipe, and a real command could too. Smoke-tested with a fake `gh` on the scratch login PATH: before push `{ dirty 1, unpushed 1, upstream no, pr null }`, after push and a PR `{ unpushed 0, upstream yes, pr #7 open, 1 failing check 'lint', 1 comment, ready false }`.

_Captured: 2026-11-10 · 5 file change(s)_

---
