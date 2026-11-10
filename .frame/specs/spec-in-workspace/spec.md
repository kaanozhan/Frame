---
keywords: spec, workspace, worktree, branch, spec list, tasks, hooks, frame bin, PR
related: workspaces, new-spec-agent-handoff, cli-spec-command-parity, spec-knowledge-layer, non-invasive-overlay, frame-bin-out-of-repo, agent-orchestration
---

# Specs inside workspaces

## Problem

`workspaces` gave every piece of work its own branch and worktree, but specs are still written in the main checkout. A spec and the code it describes therefore live on different branches: the spec never reaches the PR that implements it, moving work between machines (self-hosted) needs a separate meta sync, and two workspaces writing specs and task state into the main checkout step on each other. PROJECT_NOTES 2026-11-09 decided option B: specs are written inside the workspace and travel with the branch. Two gaps found while scoping this make it urgent: Frame's hooks (`.frame/bin/*`, gitignored) are absent in a worktree, so agents in workspaces silently lose spec context and module hints; and `.frame/tasks.json` is tracked, so per-worktree task updates would conflict at merge.

## Goal

- **Spec work happens in a workspace.** Starting a new spec (New Spec modal, `/spec.new` dispatch) runs in the selected workspace; from main it first creates a workspace for it. `spec.plan`, `spec.tasks` and `spec.implement` for a spec run in the workspace that holds it. The spec folder (`.frame/specs/<slug>/`) is written in that worktree and committed on its branch, so it lands in the same PR as the code.
- **One spec list per project.** Specs board, Home's Active Specs and the sidebar count show the merged specs from the main checkout plus in-flight specs from every active workspace. Each in-flight spec shows which workspace it lives in, and opening it selects that workspace. A slug present in both places shows once: the workspace copy while the workspace is active.
- **Workspace pane for its spec.** A selected workspace that holds a spec shows that spec (spec / plan / tasks / outcome, phase, next action) one click away.
- **Frame tooling works inside a worktree.** Hooks, `.frame/bin` helpers and staged command prompts are available to agents running in a workspace exactly as in the main checkout.
- **Task state does not fork.** Spec task status changed by an agent in a workspace is reflected on the project's Tasks board, and merging the branch does not produce `tasks.json` conflicts.

## Constraints

- Builds on `workspaces` (done): `projectPath` is the project identity, `state.getWorkspaceRoot()` is where checkout-bound work happens; the registry is the source of truth for which worktree belongs to which project.
- The staged template is the only spec flow (`cli-spec-command-parity`, `new-spec-agent-handoff`): no second authoring path, no `createSpec` revival.
- Spec paths are built only through `frameStore` (`specsRoot` / `resolveSpecDir`, guarded by `test/metaPathGuard.test.js`); extend it with a workspace root rather than joining paths elsewhere.
- Project-level meta (`tasks.json`, `PROJECT_NOTES.md`, `STRUCTURE.json`) lives in the main checkout; agents in workspaces do not edit the main checkout's copies directly (orchestration rule, PROJECT_NOTES 2026-11-09).
- The spec knowledge layer (`spec-index`, `spec-context.js`) indexes merged specs only — in-flight specs are not knowledge until merged.
- Both `gitSharing` modes must work. In `local` mode `.frame/` is excluded through `.git/info/exclude` (shared by every worktree), so a spec in a worktree is never committed; its folder must still reach the main checkout.
- Never auto-commit (C4 of `workspaces`); committing spec files is the agent's or user's act, as with code.
- Orchestration stays out of scope (PROJECT_NOTES 2026-11-09).

## Success Criteria

- When the user creates a spec while a workspace is selected, then `.frame/specs/<slug>/` appears in that worktree, not in the main checkout, and the Spec Creator lane runs in the worktree.
- When the user creates a spec from main, then a new workspace is created and selected first and the spec is written there.
- When a workspace holds an in-flight spec, then the Specs board lists it once with its workspace name, and opening it selects the workspace.
- When the workspace's branch is merged and the main checkout is updated, then the spec appears as a merged spec and the duplicate disappears.
- When an agent in a workspace edits a file, then Frame's PreToolUse / UserPromptSubmit hooks run there with the same output as in the main checkout.
- When an agent in a workspace marks a spec task done, then the project's Tasks board shows it done, and merging that branch causes no conflict in `.frame/tasks.json`.
- When the project uses `gitSharing: local`, then archiving or merging a workspace leaves its spec folder in the main checkout's `.frame/specs/`.
- When `npm test` runs, then existing tests pass and the merged-list, slug-dedupe and spec-path rules have unit tests.

## Out of Scope

- workspace-pr-flow (push, Create PR, PR body from the spec)
- workspace-review (diff, line comments, viewed state)
- update-from-base
- Moving a spec between workspaces
- Self-hosted / remote workspaces
- Rebuilding orchestration on workspaces

## Open Questions

- **Where spec task state lives inside a workspace.** Options: (a) agents keep updating `.frame/tasks.json`, but in a workspace it is redirected to the main checkout's copy (env/flag the templates read), so the branch never carries `tasks.json` changes; (b) task state for a spec lives in the spec folder (`tasks.md` checkboxes / `status.json`) and the Tasks board reads in-flight spec tasks from workspaces, importing them into `tasks.json` on merge.
- **How Frame tooling reaches a worktree.** Options: (a) provision `.frame/bin` and `.frame/runtime` into each worktree on create/restore (they are gitignored there too); (b) point workspace hooks and prompts at the main checkout's `.frame/bin` by absolute path (env var such as `FRAME_HOME_BIN`, as orchestration's `FRAME_ORCH_BIN` does).
- **New spec from main.** Options: (a) always create a workspace first (pure Conductor); (b) ask "new workspace or main?" with workspace as the default.
- **`gitSharing: local` hand-back.** Options: (a) copy the spec folder into the main checkout on archive and on merge; (b) write in-flight specs to the main checkout in local mode (B applies to `repo` mode only).
