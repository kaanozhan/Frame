---
keywords: fsSafe, atomic write, corruption recovery, logger, redaction, crash, tests
related: audit-q3-performance-resources, audit-q3-product-analytics
---
Ended the bare-writeFileSync era: `fsSafe.js` (writeFileAtomic tmp+fsync+
rename, readJsonWithRecovery with .bak restore + .corrupt-<ts> preservation,
safeWatch) adopted by every state writer (workspace, tasksManager,
userSettings, aiToolManager, spec status.json, orch bus). Corrupt tasks.json
now restores or rebuilds instead of killing CRUD (returns `{corrupt:true}`
+ TASKS_FILE_ERROR). Added the repo's FIRST test infrastructure (node --test,
zero deps) and electron-log-backed logger.js with hooks-level secret
redaction; promptLogger redacts + caps. 24 swallowed catches routed through
logger (shell-probe catches stay silent deliberately — expected absence).
Rule: no state write bypasses fsSafe; no new local toast/log patterns.

Chain: spec.md → plan.md → tasks.md → outcome.md
