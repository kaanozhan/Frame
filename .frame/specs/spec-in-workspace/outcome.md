
## T01 — Add the pure core workspaceSpecs.js

Added `src/shared/workspaceSpecs.js`: `provisionEntries` (`.frame/bin`, `.frame/runtime/commands`, `.frame/index`, plus `.claude/settings.local.json` in local mode), `mergeSpecLists` (entries tagged `workspace` or null, workspace copy wins a slug clash, first-listed workspace wins between two, listSpecs' own sort), `rootForSlug`, `commandPaths` (`project_path` = the agent's root, `tasks_path` = main) and `handBackSlugs` (local mode only; new slugs and strictly newer copies). `rootForSlug` was not named in the plan; it is the slug → root rule step 3 needs, kept pure here. Tests: `test/workspaceSpecs.test.js` (6 cases).

_Captured: 2026-11-10 · 2 file change(s)_

---
