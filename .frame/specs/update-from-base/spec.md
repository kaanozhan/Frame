---
keywords: update from base, behind, merge base, rebase, conflicts, fetch, workspace, branch
related: workspaces, workspace-pr-flow, workspace-review
---

# Update workspace from base

## Problem

A workspace branches from `origin/<base>` and then drifts. Other PRs land on the base and the workspace falls behind. The row already shows this as ↓n (`workspace-pr-flow`), but Frame offers no way to act on it. The user has to open a terminal in the worktree and run `git fetch` and `git merge origin/main` by hand. When that conflicts, they work through it alone or retype the situation to the agent. A branch that is behind also causes problems later: its PR can be blocked ("branch is out of date"), its checks run against an old base, and the review (`workspace-review`) diffs against an old merge base. The workspaces, spec-in-workspace, workspace-pr-flow and workspace-review specs all deferred this here.

## Goal

- **Update from base.** One action on a workspace (row menu, palette) does the following:
  - fetches the base;
  - brings the latest `origin/<base>` into the workspace branch;
  - reports the result: up to date, updated by n commits, or stopped on conflicts.
- **Show when it is needed.** The row's ↓n badge and the menu item say how far behind the workspace is. The item is offered when n > 0.
- **Conflicts go to the agent.** When the update stops on conflicts, Frame lists the conflicted files. It offers to:
  - hand them to an agent in the workspace, with a prompt naming the base, the files and what to do (resolve, run the tests, complete the merge, don't push);
  - abort the update, which returns the branch to where it was.
- **Refresh what depends on it.** After an update, the row state (↓n, ↑n) and an open review re-read.

## Constraints

- Git runs in the workspace's folder through argv (`execGitArgs` style), as the user's own git. Frame never force-pushes and never pushes the base (`workspace-pr-flow`). The update itself does not push, and the user pushes as before.
- The work keeps going through a PR (2026-11-09 git-flow decision). The update only changes the workspace branch, never the base or the main checkout.
- Frame never commits on the user's behalf (`workspace-pr-flow`), except for the merge commit that the update itself creates.
- An update must not destroy uncommitted work: a dirty worktree is handled explicitly (see Open Questions), never silently overwritten.
- A conflicted state is never left half-done without the user knowing. The row shows it, and both "hand to agent" and "abort" stay reachable until it is resolved.
- Prompts reach the agent through `agentDispatch`, like Fix Failing Checks. Frame calls no model itself.
- Lane choice for the conflict prompt reuses the review's "workspace agent lane, else new" behaviour (`workspace-review`).
- Builds on `workspaceGitState` (`behind` count, refresh after actions) and on `workspacePr.menuItems` / `runAction` for the row menu.

## Success Criteria

- When a workspace is n commits behind `origin/<base>`, then its row menu offers "Update from <base> (n)" and the palette offers the same command for the selected workspace.
- When the user updates a clean workspace with no conflicts, then the base is fetched, the branch contains the latest `origin/<base>`, ↓n becomes 0, the user sees how many commits came in, and nothing is pushed.
- When the workspace is already up to date, then the user is told so and nothing changes.
- When the update hits conflicts, then the user sees the conflicted files and can either hand them to an agent (one prompt naming the base and the files) or abort, after which the branch is exactly where it was before.
- When the workspace has uncommitted changes, then the update follows the rule decided at plan time and never loses them.
- When an update finishes or is aborted, then the row state and an open review tab refresh.
- When `npm test` runs, then existing tests pass and the pure rules (the result and conflict parsing, the conflict prompt, when the action is offered) have unit tests.

## Out of Scope

- Updating the main checkout (pull on main)
- Changing a workspace's base branch
- GitHub's "Update branch" button / `gh pr update-branch`
- Automatic or scheduled updates
- Resolving conflicts in a Frame UI (a merge editor)
- Self-hosted / remote workspaces

## Open Questions

- **How the base comes in.** Options:
  - (a) always merge `origin/<base>` into the branch. History is kept, so a pushed branch never needs a force-push.
  - (b) rebase when the branch has never been pushed, merge otherwise.
- **Uncommitted changes.** Options:
  - (a) refuse with "commit or stash first" (offering to hand the commit to the agent);
  - (b) stash automatically, update, then restore the stash, stopping if the restore conflicts.
- **Conflict hand-off.** Options:
  - (a) offer "Resolve with agent" and "Abort" in one dialog right after the conflict;
  - (b) always stop and leave the choice to the row menu (where the conflicted state shows as a badge).
