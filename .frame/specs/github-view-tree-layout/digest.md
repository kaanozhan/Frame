---
keywords: github panel, sidebar rail, pull requests, issues, branches, worktrees, gh cli, gh auth, tree view, vscode layout, confirm modal
related: dock-panel-readonly-views, audit-q3-ux-error-feedback, agent-orchestration, sidebar-nav-groups
---
Rebuilt the sidebar's GitHub tab as four collapsible sections (Pull Requests · Issues · Branches · Worktrees) of dense 22px rows with one filter field, real pull requests through `gh`, and a state block that tells `gh` missing, not signed in and not a GitHub remote apart.

- Pure, tested logic lives in `src/renderer/github/`: `sectionState.js` (open/closed state persisted app-wide under `localStorage['frame-github-sections']`, with the Remote sub-group as a fifth key), `accessState.js` and `rowModels.js`. 50 new tests; `npm test` 686 pass. `githubPanel.js` is only the DOM host and keeps `init/show/hide`, so the rail tab, `revealSidebarTab` and ⌘⇧G stand.
- Main: `githubManager.checkAccess` runs `gh --version` → `gh auth status` → `gh repo view` with a 10s timeout, cached per project and forced by the head refresh. A signed-out `gh` no longer reads as "Not a GitHub repository". Rejected: checking from the renderer per section, which runs three `gh` processes per expand. New channels: `GITHUB_ACCESS_STATE`, `LOAD_GITHUB_PULL_REQUESTS`, `CHECKOUT_GITHUB_PR`. PR links reuse `OPEN_GITHUB_ISSUE`, and existing payloads are unchanged. PR checkout refuses a dirty tree (`uncommitted_changes`), with no auto-stash.
- Decisions: Start work only creates and checks out `issue-<n>-<slug>`; opening the New Spec launcher was rejected and left for a follow-up spec. A row click selects, and the browser opens only through Open on GitHub. Pull Requests and Branches start expanded. Sign in runs `gh auth login` in a lane through an `openLane` hook injected from `index.js`; rejected: `githubPanel.js` requiring `multiTerminalUI`, which makes a require cycle.
- Branch delete/force delete and worktree remove/force remove go through `taskConfirmModal`, which gained `heading`/`message`/`confirmLabel` options. A second modal was rejected, and no `confirm()` is left.
- The GitHub rules moved to `components/github.css`, and 890 lines left `panels.css`. Rejected: editing them in place, where eight earlier specs had layered changes.
- Refresh: the head reloads every expanded, available section; a section's refresh reloads only that section (the old button always reloaded issues). Expanding shows the cache, then reloads behind it, and a result that arrives after a project change is dropped.
- Deviations: at the 180px floor the panel is about 100px wide, so each title has a short form ("PRs", "Trees", "Branch") that a container query swaps in below 170px, where row meta is also hidden. Outside the footprint, `gitBranchesManager.loadBranches` now filters `refs/remotes/*/HEAD` by full refname, because it had listed a local branch named `origin`.
- Reverses `dock-panel-readonly-views` D8 ("keeping its refresh / filter / create-branch chrome"), as plan.md records.
- Verified under Playwright at 280, 180 and 320px. PR and issue rows were never seen live, because `gh` was not signed in on that machine; they rest on the row-model tests.
- Rules: GitHub is reached only through `gh` in `src/main/`, with no REST client and no token storage; pure row and state logic stays in `src/renderer/github/` with tests.

Chain: spec.md → plan.md → tasks.md → outcome.md
