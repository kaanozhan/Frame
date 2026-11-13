
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

## T04 — Add the PR actions in main

`workspaceGitState.js` gained `push` (refuses the base via `isPushable`, sets the upstream on first push, returns the uncommitted count), `prDraft` (the workspace's held spec from `specManager.listSpecs`/`getSpec` → `composePr`, else `git log origin/<base>..HEAD` subjects), `prCreate` (gh access checked, push first, `gh pr create --base --head --title … --body-file -` with the body on stdin, `--draft` when chosen) and `merge` (refuses non-open or not-`ready` PRs, method from the setting or `gh repo view` flags via `pickMergeMethod`, `gh pr merge <n> --<method>`, `fastForwardIfOn` for the main checkout, then `workspaceManager.archive` when `archiveOnMerge`, reporting rather than forcing when the workspace is dirty), each re-pushing state; IPC for all four. End-to-end smoke with the fake gh: a spec'd workspace drafted 'Login form' with Why/What/Done/spec path, a title with quotes, backticks and `$` reached gh intact as argv with the body on stdin, the branch was pushed, merge was refused while checks were pending, then merged with `--squash`, fast-forwarded main and archived the workspace.

_Captured: 2026-11-10 · 1 file change(s)_

---

## T05 — Show git state on workspace rows and add Push

Added `src/renderer/workspacePr.js`: keeps the current project's `WORKSPACE_GIT_STATE` (asks main with `WORKSPACE_GIT_REFRESH` on init and project change, which also makes that project the polled one), renders row badges (●uncommitted, ↑unpushed, ↓behind, `#n` coloured by draft/open/merged/closed with a passing/failing/pending checks dot and a tooltip naming failing checks and comments) and row-menu items, and owns the Push action (confirms first when there are uncommitted changes, then toasts). `workspaceSection.js` renders the badges under the labels, puts the PR items above its own with a separator and routes their clicks through `runAction`; `index.js` inits it and registers `workspace.push`; badge styles in `workspaces.css`. Live over CDP with a fake gh on the scratch PATH: a commit showed `↑1`, the menu offered `Push (1)`, pushing cleared it, and a PR with a failing check showed `#55` with a red dot titled `PR #55 · open · 1 failing: lint · 1 comment`.

_Captured: 2026-11-10 · 4 file change(s)_

---

## T06 — Build Create PR

Added the `#create-pr-modal` dialog (`index.html`, task-run modal shell, styles in `workspaces.css`) and `workspacePr.openCreatePr`: asks main for `WORKSPACE_PR_DRAFT`, shows `branch → base · N commits`, prefills title and body, lets the user edit them and tick draft, and creates through `WORKSPACE_PR_CREATE` (button reads 'Pushing and creating…'; errors stay in the dialog; ⌘↩ creates, Esc cancels). The row menu offers 'Create Pull Request…' until the workspace has an open/draft PR, disabled with the gh/auth/remote reason when PR actions are unavailable; `workspace.createPr` (⌘⌥P) in the command registry and File menu. Live over CDP with the fake gh: the dialog opened prefilled from the commit ('add pr file', `feat/kaan/blue → main · 1 commit`), the edited title and draft reached gh as argv (`--title 'Add the PR file' … --draft`), and the row turned into `PR #101 · draft · 1 check running`.

_Captured: 2026-11-10 · 5 file change(s)_

---

## T07 — Add checks and fixes

The row already showed passing/failing/pending with failing names in its tooltip (T05); this task added the actions: 'Fix Failing Checks (n)' (tooltip lists them) selects the workspace and dispatches `prFlow.fixChecksPrompt` to a new agent lane through `agentDispatch.dispatch`, labelled `fix checks: #n`; 'Open PR #n on GitHub' sends the URL over the existing `OPEN_GITHUB_ISSUE` channel (shell.openExternal); `workspace.fixChecks` palette command, enabled only when the selected workspace's PR has failing checks. Live over CDP with the fake gh: a failing 'unit tests' check produced both menu items, and Fix selected `blue` and opened a lane in its worktree; prompt delivery itself is the existing dispatch path (agent readiness, text-then-Enter), not re-tested — the isolated test home has no logged-in CLI. 'Open on GitHub' was not clicked live, to avoid opening a real browser.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T08 — Add Merge

Row menu 'Merge PR #n' (disabled with the reason: draft, not mergeable, checks failing or running, or no gh access) and the `workspace.merge` command call `workspacePr.merge`: confirm, then `WORKSPACE_PR_MERGE`, and one toast summing up method, whether the main checkout was fast-forwarded (or why not) and whether the workspace was archived (or why not). Project Settings → Workspaces gained 'Merge method' (Repository default / Squash / Merge commit / Rebase → `mergeMethod`) and 'Archive after merge' (`archiveOnMerge`), saved per field and disabled with the others for non-Frame projects (`projectSettingsModal.js`, `index.html`). Live over CDP with the fake gh: Rebase saved to `.frame/config.json`, a green PR's menu offered 'Merge PR #101', merging called `gh pr merge 101 --rebase`, and the workspace left the list (archived). Last task: wrote `digest.md` and set the phase to done.

_Captured: 2026-11-10 · 5 file change(s)_

---
