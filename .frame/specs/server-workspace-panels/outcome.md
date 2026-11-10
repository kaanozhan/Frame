
## T01 — Pure rules: path → server root, git-state merge

Added serverRootFor (longest separator-safe match of a root or file path to a server workspace folder; trailing slashes ignored) and mergeGitStatePayloads (local and server rows in one WORKSPACE_GIT_STATE payload for the desktop project, the server's gh access kept as serverAccess, null when no server) to src/shared/serverRouting.js, with two tests in test/serverRouting.test.js.

_Captured: 2026-11-10 · 2 file change(s)_

---

## T02 — Server panels: files, git, review

Added src/server/panels.js (registered in src/server/index.js): files.tree, files.read (2 MB cap, readOnly), git.watch/unwatch/refresh with the server gitStatusManager's GIT_STATUS_DATA broadcast as git.status, git.diff, git.branches/switch, review.files/fileDiff. Extracted gitDiff from the GET_GIT_DIFF handler in src/main/gitDiffManager.js and exported startWatching/stopWatching/pushStatus from src/main/gitStatusManager.js so the server can drive them.

_Captured: 2026-11-10 · 5 file change(s)_

---
