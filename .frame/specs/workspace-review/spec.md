---
keywords: review, diff, line comments, viewed, workspace, base, agent feedback, diff2html
related: workspaces, workspace-pr-flow, spec-in-workspace
---

# Workspace review

## Problem

Before a workspace's work becomes a PR, someone has to read it — and Frame cannot show it. The existing diff tab (`diffSection.js`, `GET_GIT_DIFF`) only shows a single file's uncommitted or staged change against `HEAD`; an agent that commits as it goes leaves nothing there, and nothing in Frame shows "everything this branch changes against its base". Feedback goes back to the agent by retyping file names and line numbers into its terminal. Conductor's most-praised surface is exactly this loop (diff with line comments sent to the agent, files marked viewed), and with `workspace-pr-flow` shipped it is the missing step between "the agent worked" and "Create PR". The workspaces spec deferred the review panel here (B1).

## Goal

- **Review a workspace.** From a workspace's row menu, the palette or a shortcut, open a review of everything the workspace changes against its base: committed work since the merge base with `origin/<base>`, plus uncommitted and untracked changes. A file list shows each changed file with its status and +/- counts; selecting a file shows its diff (diff2html, side-by-side or unified, the existing `.frame-diff` look).
- **Mark files viewed.** Each file can be ticked as viewed; viewed files collapse in the list and the count of remaining files is shown. A viewed file whose content changes afterwards (the agent edits it again) returns to unviewed.
- **Comment on lines.** Clicking a line in the diff opens a small comment box; comments collect as a pending review listed in the panel (file, line, quoted code, text) and can be edited or removed.
- **Send the review to the agent.** One action sends all pending comments as a single prompt (file:line, quoted line, comment) to an agent in the workspace; sent comments are cleared from the pending list.

## Constraints

- Reuses diff2html and the existing `.frame-diff` styling; no new dependency.
- All git runs in the workspace's folder through argv (`execGitArgs` style); the review is read-only — no staging, no reverting, no editing in this spec.
- The base comparison uses the merge base with `origin/<base>` so commits that landed on the base after the workspace branched do not show as the workspace's changes.
- Prompts reach the agent through `agentDispatch` (text then Enter), like every other dispatch; Frame calls no model itself.
- Large diffs must not freeze the window: the file list loads first, a file's diff loads when selected, and very large or binary files show a placeholder.
- Works for any workspace (the main row has no base to compare with and is out of scope for this view; the existing Changes panel keeps serving it).
- Builds on `workspaces` (records, `state.getWorkspaceRoot()`), `workspace-pr-flow` (row menu delegation through `workspacePr`) and leaves the existing diff tab working unchanged.
- ⌘⇧D is the Tasks dashboard; the shortcut must not collide.

## Success Criteria

- When the user opens Review on a workspace with commits and uncommitted changes, then the file list shows every file changed since the merge base with `origin/<base>` (committed, uncommitted and untracked) with status and +/- counts, and files changed only on the base after branching are absent.
- When the user selects a file, then its diff against the merge base renders in diff2html, and switching side-by-side / unified keeps the file.
- When a file is marked viewed, then it collapses and the remaining count drops; when that file's content changes afterwards, then it is unviewed again.
- When the user clicks a diff line and writes a comment, then it appears in the pending list with file, line and the quoted line, and can be edited or removed.
- When the user sends the review, then one prompt containing every pending comment (file:line, quoted line, text) is dispatched to an agent in the workspace, and the pending list empties.
- When a file is binary or its diff is very large, then a placeholder shows instead of the diff and the window stays responsive.
- When `npm test` runs, then existing tests pass and the changed-files parsing, viewed-state rules and review-prompt composition have unit tests.

## Out of Scope

- Editing, staging or reverting from the review
- Fetching, replying to or resolving GitHub PR review threads
- An AI "review my changes" action
- update-from-base
- Reviewing the main checkout against a base
- Self-hosted / remote workspaces

## Open Questions

- **Where the review lives.** Options: (a) a section tab in the center (like today's diff tab) with its own file list and comment list; (b) Conductor's right-hand git panel beside the terminals.
- **Which agent gets the review.** Options: (a) the workspace's existing agent lane when there is exactly one, else ask (existing lanes or a new one); (b) always a new lane.
- **Viewed state persistence.** Options: (a) remembered per workspace across restarts (machine-local); (b) for the session only.
- **Shortcut.** Options: (a) ⌘⌥R ("review"); (b) ⌘⌥D ("diff").
