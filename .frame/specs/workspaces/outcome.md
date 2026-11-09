# Outcome — Workspaces

## T01 — Rename the project registry

Moved `src/main/workspace.js` to `src/main/projectRegistry.js` (`loadWorkspace` → `loadRegistry`, internals renamed, on-disk `~/.frame/workspaces.json` and its `activeWorkspace`/`workspaces.default` keys untouched), renamed `WORKSPACE_DIR`/`WORKSPACE_FILE` to `FRAME_HOME_DIR`/`PROJECT_REGISTRY_FILE` and the six registry channels to `LOAD_PROJECT_REGISTRY`, `PROJECT_REGISTRY_DATA`, `PROJECT_REGISTRY_UPDATED`, `ADD_PROJECT_TO_REGISTRY`, `REMOVE_PROJECT_FROM_REGISTRY`, `REORDER_REGISTRY_PROJECTS`. The sidebar nav became `projectNav*` / `#project-panel` / `.project-nav-*` across JS, CSS and tour selectors; "Add Project to Workspace…" became "Add Project…" and the loader says "projects". Deviation: `scripts/eval/retrieval-cases.json` was left alone — the corpus is hash-frozen and pinned to a commit where `workspace.js` exists, so editing it broke `retrievalEval.test.js`; and comment-only rewordings landed in files outside the plan's list (`fsSafe.js`, `structureLifecycle.js`, `onboarding*.js`, `paletteSources.js`, `projectSection.js`, `sidebarResize.js`, `app-loader.css`, `view-header.css`) so "workspace" no longer means the registry anywhere.

_Captured: 2026-11-10 · 34 file change(s)_

---

## T02 — Add the pure workspace core

Added `src/shared/workspaceRegistry.js` (add / archive / restore / rename / remove returning `{ ok, records, record }` or `{ ok:false, error:{ code, message, holder } }` without mutating input; one active holder per branch, archived records hold nothing; `reconcile` flags `missing` on active records absent from `git worktree list`, `toStored` strips it), `src/shared/workspaceNames.js` (72-color pool, `nextName` with `-2`/`-3` overflow, `toSlug`, `uniquify` for folder collisions) and `src/shared/copyFilesMatch.js` (gitignore-shaped matcher: unanchored names at any depth, `/`-anchored from root, `*`/`**`/`?`, directory patterns cover contents, `node_modules`/`.git` never match, `.env*` default). The registry also reserves the id `main` and enforces unique names so folder names never collide. Tests: `test/workspaceRegistry.test.js`, `test/workspaceNames.test.js`, `test/copyFilesMatch.test.js` (25 cases).

_Captured: 2026-11-10 · 6 file change(s)_

---

## T03 — Add git primitives

Added a "Workspace helpers" section to `src/main/gitBranchesManager.js`, all on `execGitArgs` (argv): `defaultRemoteBranch` (origin/HEAD → origin/main|master → current/local branch), `fetchBranch` (15 s, never throws), `addWorkspaceWorktree` / `removeWorkspaceWorktree`, `worktreeStatus`, `commitAll`, `discardAll` (`reset --hard` + `clean -fd`, ignored files left for `remove --force`) and `listIgnoredCandidates` (`ls-files --others --ignored --exclude-standard --directory -z`). `execGitArgs` gained an optional `{ timeout, maxBuffer }` and reports timeouts plainly; new branches are created with `--no-track` so a workspace branch never adopts `origin/main` as its upstream — not in the plan, added because the default would make a later push target main. `gitStatusManager` now resolves a `.git` file (`gitdir:`) to the real git dir and watches it (`gitDirFromDotGitFile` / `resolveGitDir`), covered in `test/gitStatusWatcher.test.js`; the helpers were smoke-tested end to end on a scratch repo (create, refuse busy branch, status, discard, commit, remove, branch kept).

_Captured: 2026-11-10 · 3 file change(s)_

---
