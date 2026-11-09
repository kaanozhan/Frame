---
keywords: workspace, worktree, branch, sidebar, archive, setup script, copy files, conductor
related: terminals-view, terminals-home-agents, project-dropdown, sidebar-nav-groups, restore-ai-sessions-on-relaunch, sessions-from-transcripts, codex-parity, status-bar-branch-picker, github-view-tree-layout, agent-orchestration
---

# Workspaces

## Problem

Frame runs agents in one checkout per project. Parallel work means users juggle branches and worktrees by hand, agents step on each other, and there is no unit that carries "this piece of work": its branch, its files, its terminals, its agents. Users coming from Conductor (Cloud shuts down 2026-11-20, the Mac app winds down) expect exactly that unit. It is also the foundation of two follow-up initiatives: the PR flow (`workspace-review`, `workspace-pr-flow`) and self-hosted Frame, which will only add a location to a workspace. Decisions behind this spec are recorded in PROJECT_NOTES (2026-11-09 and 2026-11-10 entries).

## Goal

A project shows a **workspace list** in the sidebar, Conductor-style:

- A special **main** row on top: the project's main checkout ("project home"). Terminals can be opened there as today; project-level meta (`tasks.json`, `PROJECT_NOTES.md`, `STRUCTURE.json`) lives there. No PR flow for main.
- One row per **workspace** = a branch + its git worktree + its terminals/agents. The row shows the branch name (PR title later) as the primary label, an auto-generated short name (Conductor's city-name style) as the secondary label, and agent status (running / needs input / needs permission) from the existing lane status.
- **New workspace** (⌘⇧N and a ＋ button): starts from a fresh branch off the fetched `origin/<base>`, or from an existing branch. It creates the worktree at `~/frame/workspaces/<repo>/<name>` (configurable), names the branch `<prefix>/<name>`, copies the files matched by the project's `copyFiles` globs from the main checkout, runs the project's setup script (logs viewable, rerunnable), and can open an AI terminal (Claude or Codex) right away.
- **Selecting a workspace scopes the app to it**: the terminals view, file tree, git changes and diff all point at that worktree. Selecting main points them at the main checkout.
- **Archive**: from the row's menu and the command palette. With uncommitted changes, Frame asks commit / discard / cancel and never auto-commits. Archiving closes the workspace's terminals, removes the worktree and keeps the branch. Archived workspaces are listed behind a filter and can be restored (worktree recreated from the branch).
- **Rename**: workspace short name and branch can be renamed by the user.
- Claude and Codex sessions started in a workspace are listed and resumable for that workspace.
- Project settings gain **Setup script** and **Files to copy** (`copyFiles` globs, default `.env*`).

## Constraints

- The center stays terminals running the official, unmodified CLIs in PTYs. No chat harness, no token handling (self-hosted direction, PROJECT_NOTES 2026-11-09).
- Worktrees live outside the repo. In-repo worktrees borrow the main checkout's `node_modules` and make Claude Code load the main checkout's CLAUDE.md/rules on top of the branch's (PROJECT_NOTES 2026-11-10).
- A branch is checked out in at most one workspace.
- Never auto-commit, never force-push, never delete a branch without an explicit user action.
- The workspace registry is the source of truth for "which worktree belongs to which project and workspace". Path-prefix checks (`github/rowModels.worktreeSlug`, `codexSessionsManager.belongsTo`) move to it. `claudeSessionsManager` today reads only the project root's encoded path, so it must also read workspace paths.
- The registry and per-workspace state are designed so a later `location` field (Mac / server) can be added without a migration. No location UI ships here.
- Today's code meaning of "workspace" (the project registry: `workspace.js`, `~/.frame/workspaces.json`, `WORKSPACE_*` IPC, `workspace-nav-*` classes, ~29 files) is renamed first. The on-disk `~/.frame/workspaces.json` filename stays to avoid a migration. The word "workspace" in UI and new code means only the new concept.
- Orchestration (conductor/worker, `.frame/worktrees/`, `frame/<slug>/work`) is out of the menu and out of scope. Do not design around it; avoid breaking it outright where it costs nothing (PROJECT_NOTES 2026-11-09).
- Per-project UI state that becomes per-workspace (terminals-view layout and tabs from `terminals-view` / `terminals-home-agents`, session restore records from `restore-ai-sessions-on-relaunch`) keeps working for main exactly as today.
- Works on macOS and Linux paths; no new native dependencies.

## Success Criteria

- When a project is opened, then the sidebar shows a main row above the project's workspaces, and existing users see their current terminals under main with nothing lost.
- When the user presses ⌘⇧N and confirms, then a worktree exists under `~/frame/workspaces/<repo>/<name>` on a new branch based on the freshly fetched base, the `copyFiles` matches are present in it, the setup script has run with its log viewable, and the new workspace is selected.
- When a workspace is created from an existing branch that is already checked out in another workspace, then Frame refuses and names that workspace.
- When the user selects a workspace, then the terminals view, file tree and git changes show that worktree; switching back to main restores main's terminals and layout.
- When an agent in a non-selected workspace needs input or permission, then that workspace's row shows the attention state.
- When the user archives a workspace with uncommitted changes, then Frame offers commit / discard / cancel; after archiving, the worktree folder is gone, the branch still exists, and the workspace appears under the archived filter.
- When the user restores an archived workspace, then the worktree is recreated from its branch and it reappears in the list.
- When Claude or Codex was run in a workspace, then its sessions are listed for that workspace and can be resumed there.
- When Frame restarts, then the workspace list, the selected workspace and each workspace's terminals/sessions come back.
- When `npm test` runs, then all existing tests pass and the registry, naming, branch-collision and archive rules have unit tests.

## Out of Scope

- spec-in-workspace (writing specs inside a workspace, Spec tab, merged spec list)
- workspace-review (diff vs base, line comments to the agent, viewed state)
- workspace-pr-flow (push, Create PR, checks, merge, archive-on-merge)
- update-from-base
- Run button, preview URLs, per-workspace ports
- Creating a workspace from a PR, a GitHub issue or Linear
- All-projects workspace list, pinned/custom sections, manual ordering
- Workspace location (Mac / server) and everything self-hosted
- Rebuilding orchestration on workspaces

## Open Questions

- **Panel layout in v1.** Reuse today's sidebar views (Files / Changes / GitHub), scoped to the selected workspace, or introduce Conductor's right-hand git panel now? Options: (a) scope the existing views and leave the right panel to `workspace-review`; (b) build the right panel here.
- **Where Setup script / Files to copy are stored.** Options: (a) `.frame/config.json` (shared via git in `repo` mode) with a machine-local override file; (b) a dedicated `.frame/workspace.json`.
- **Project-registry rename.** Options: (a) the first task of this spec; (b) its own small spec (`rename-project-registry`) shipped first.
- **Base branch.** Options: (a) always the remote's default branch (`origin/HEAD`); (b) default branch plus a per-project setting and a picker in the new-workspace dialog.
- **Short-name pool.** Options: (a) city names like Conductor; (b) another neutral pool (e.g. adjective-noun) to avoid looking like a copy.
