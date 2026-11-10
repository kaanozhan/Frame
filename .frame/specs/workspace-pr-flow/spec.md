---
keywords: pull request, push, gh, checks, CI, merge, workspace, branch, archive
related: workspaces, spec-in-workspace, github-view-tree-layout, status-bar-branch-picker
---

# Workspace PR flow

## Problem

A workspace can be created, worked in and archived, but its work has no way out of Frame: there is no push and no "Create PR", so finishing means leaving for a terminal or GitHub, and nothing in Frame tells whether a workspace's PR exists, is green, has review comments or was merged. This was the step PROJECT_NOTES 2026-11-09 called the most important part of the git flow (user, verbatim: "branch e commit, pr üzerinden gitmeye devam etmeliyiz"), and it is the one Conductor users expect from the workspace row. With `spec-in-workspace` the branch now carries the spec, so the PR can carry the "why" next to the code.

## Goal

- **Ready to ship, at a glance.** Each workspace row shows its git state: uncommitted changes, commits ahead of / behind its base, and — once one exists — its PR (number, draft / open / merged / closed) and checks (passing / failing / pending), plus the count of review comments.
- **Push.** A workspace can be pushed (`<branch>` → `origin/<branch>`, upstream set on first push). Push is also done as part of Create PR.
- **Create PR.** From the workspace (row menu, command palette, a shortcut) Frame opens a PR from the workspace branch into its base through the user's `gh`. The title and body are prefilled; when the workspace holds a spec, the body carries the spec's summary and, once written, its outcome. The user can edit title/body and choose draft before it is created.
- **Fix failing checks.** When checks fail, one action sends the workspace's agent a prompt naming the failing checks and how to read their logs.
- **Merge.** When the PR is mergeable and its checks pass, Frame merges it through `gh`; after merge the main checkout fast-forwards its base when it is on that branch and clean, and the workspace is archived (configurable).
- **Degrades clearly.** Without `gh`, without auth, or without a GitHub remote, the PR actions are disabled with the reason; push still works for any remote.

## Constraints

- Frame never force-pushes, never pushes the base branch, never auto-commits, and never deletes a branch without an explicit user action (workspaces C4; PROJECT_NOTES 2026-11-09).
- Everything goes through the user's own `git` and `gh` login. Frame stores no GitHub token and calls no model API itself (self-hosted direction, PROJECT_NOTES 2026-11-09).
- Agents commit; Frame does not commit on their behalf. A push with uncommitted changes warns and pushes what is committed.
- New branches were created with `--no-track` (workspaces T03), so the first push must set the upstream explicitly to `origin/<branch>`.
- PR state refresh must respect the visibility-gated polling rules (`pollGate`, audit-q3-performance-resources): no per-workspace timers while the window is hidden.
- Reuses `githubManager`'s access checks (`checkGhCli` / `checkGhAuth` / `checkGitHubRepo`) rather than a second detection path.
- Builds on `workspaces` and `spec-in-workspace`: workspace records, `state.getWorkspaceRoot()`, the slug → checkout map; `gitSharing: local` specs are not committed, so their PR carries no spec files (the body still carries the summary).
- Orchestration stays out of scope.

## Success Criteria

- When a workspace has commits not on `origin`, then its row shows them as ahead, and Push sends them to `origin/<branch>` with the upstream set; a second Push sends only new commits.
- When the user pushes, then Frame never pushes the base branch and never uses `--force`; when there are uncommitted changes, it says so before pushing.
- When the user creates a PR from a workspace, then `gh pr create` opens it from the workspace branch into the workspace's base with the edited title/body (draft when chosen), the branch is pushed first if needed, and the row shows the PR number.
- When the workspace holds a spec, then the prefilled PR body contains that spec's summary (and outcome when present).
- When the PR's checks fail, then the row shows failing checks and "Fix failing checks" dispatches a prompt to an agent in that workspace naming them.
- When the PR is mergeable with passing checks and the user merges, then it is merged through `gh`, the main checkout's base fast-forwards when safe, and the workspace is archived when the setting is on.
- When `gh` is missing or not authenticated, or the remote is not GitHub, then the PR actions are disabled with the reason and Push still works.
- When the window is hidden, then no PR-status polling runs.
- When `npm test` runs, then existing tests pass and the git-state parsing, PR-state mapping, PR-body composition and merge-readiness rules have unit tests.

## Out of Scope

- workspace-review (diff vs base, line comments to the agent, viewed state, resolving review threads)
- update-from-base (rebase/merge of the base into the workspace)
- Direct merge without a PR
- GitLab / Bitbucket and other forges
- Creating workspaces from PRs or issues
- Self-hosted / remote workspaces
- Orchestration

## Open Questions

- **Who writes the PR title and body.** Options: (a) Frame composes them deterministically (spec title/summary/outcome, else the commit subjects) and the user edits them in the dialog; (b) the workspace's agent drafts them through a staged prompt and runs `gh pr create` itself.
- **Merge method.** Options: (a) a per-project setting (squash / merge / rebase), defaulting to the first one the repository allows (`gh repo view`); (b) ask in the merge dialog every time.
- **After merge.** Options: (a) archive the workspace automatically (project setting, on by default); (b) ask each time.
- **PR status refresh.** Options: (a) gated polling every few minutes plus on window focus and after each Frame action; (b) only on focus and after actions.
- **Create PR shortcut.** ⌘⇧P is the command palette. Options: (a) ⌘⇧R; (b) no default shortcut, palette only.
