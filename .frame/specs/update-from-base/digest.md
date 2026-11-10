---
keywords: update from base, behind, merge, conflicts, fetch, abort, workspace, agent
related: workspaces, workspace-pr-flow, workspace-review
---
Workspaces can take their base in. "Update from <base> (n)" (row menu, palette `workspace.updateFromBase`) runs main's `workspaceGitState.updateFromBase`:
- An existing merge returns its conflict.
- Tracked uncommitted changes are refused ("commit or stash first").
- It fetches the base, falling back to the last fetched `origin/<base>` with a note when offline.
- 0 behind reports "up to date"; otherwise it runs `git merge --no-edit origin/<base>`.
- A merge that stops without conflicts is aborted.
Results: updated (n commits, not pushed), up to date, dirty, conflict. On a conflict, a dialog lists the files and offers Resolve with agent, Abort update or Later. The row keeps a "⚠ merging" badge plus "Resolve Conflicts with Agent (n)" / "Abort Update" (also in the palette) until the merge is resolved or aborted. `rowState` carries `merging` and `conflicts`. An open review reloads when its workspace's row state moves.
Why this path: always merge, so a pushed branch with an open PR never needs a force-push (rejected: rebase when unpushed). Dirty worktrees are refused, so `merge --abort` can never touch user work (rejected: auto-stash, which stacks a second conflict). Conflicts get a dialog at once and a durable row state (rejected: badge only).
Rules for future work:
- ↓n reflects the last fetch (the poller never fetches), so the update item always shows and the action fetches first.
- Update rules are pure in `prFlow` (`parseConflicts`, `updateMenuState`, `conflictPrompt`, `updateMessage`) and git primitives sit in `gitBranchesManager` (`trackedDirtyCount`, `mergeInProgress`, `conflictedFiles`, `mergeRef`, `abortMerge`).
- Agent-lane choice for any workspace hand-off goes through `workspacePr.workspaceAgentLanes`: the most recently active agent lane, else a new one.
- Verified with a scratch origin and a fake `claude` lane; no real agent or GitHub was used.
Followups: none required for Initiative 1; next is self-hosted Frame (Initiative 2).

Chain: spec.md → plan.md → tasks.md → outcome.md
