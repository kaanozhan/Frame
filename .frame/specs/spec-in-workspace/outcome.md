
## T01 — Add the pure core workspaceSpecs.js

Added `src/shared/workspaceSpecs.js`: `provisionEntries` (`.frame/bin`, `.frame/runtime/commands`, `.frame/index`, plus `.claude/settings.local.json` in local mode), `mergeSpecLists` (entries tagged `workspace` or null, workspace copy wins a slug clash, first-listed workspace wins between two, listSpecs' own sort), `rootForSlug`, `commandPaths` (`project_path` = the agent's root, `tasks_path` = main) and `handBackSlugs` (local mode only; new slugs and strictly newer copies). `rootForSlug` was not named in the plan; it is the slug → root rule step 3 needs, kept pure here. Tests: `test/workspaceSpecs.test.js` (6 cases).

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Provision Frame tooling into worktrees and hand specs back

Added `src/main/workspaceTooling.js`: `provision` copies `provisionEntries` (bin, runtime/commands, index, plus `.claude/settings.local.json` in local mode) from the main checkout into a worktree, overwriting; `handBack` copies spec folders chosen by `handBackSlugs` into main through `frameStore.specsRoot`/`resolveSpecDir` (status.json `updated_at` as the stamp). `workspaceManager.js` provisions after create and restore, hands back before the archive's `worktree remove --force`, and serves the new `WORKSPACE_PROVISION` channel. Smoke-tested on a scratch Frame project in local mode with Frame's info/exclude entries: all four paths land in the new worktree, and a spec written there is in main's `.frame/specs` after archive while the folder is gone (without those exclude entries the provisioned files would make a worktree look dirty). One full-suite run hung once (killed after 2 min; every file passes alone, `structureLifecycle.test.js` takes ~25 s) and the rerun passed in 34 s — noted as flaky, not caused by this change.

_Captured: 2026-11-10 · 3 file change(s)_

---
