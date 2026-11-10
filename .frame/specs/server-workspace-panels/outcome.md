
## T01 — Pure rules: path → server root, git-state merge

Added serverRootFor (longest separator-safe match of a root or file path to a server workspace folder; trailing slashes ignored) and mergeGitStatePayloads (local and server rows in one WORKSPACE_GIT_STATE payload for the desktop project, the server's gh access kept as serverAccess, null when no server) to src/shared/serverRouting.js, with two tests in test/serverRouting.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---
