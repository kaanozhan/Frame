---
keywords: spec, server workspace, self-hosted, frame server, spec list, prompt staging, tasks, tooling
related: spec-in-workspace, server-workspaces, server-workspace-panels, server-onboarding, cli-spec-command-parity
---

# Specs in server workspaces

## Problem

`spec-in-workspace` puts every spec in a workspace's worktree, so it rides the branch and lands in the PR with the code. It left self-hosted workspaces out of scope. On a server workspace the spec flow is broken in three verified ways:

- **The spec list misses server specs.** `specManager.activeWorkspaceRoots` drops a workspace whose folder is not on the Mac's disk (`fs.existsSync`). A spec written on the server shows on no board, Home or workspace row until its branch is merged and pulled locally. The only view is opening the files one by one in the read-only file tree.
- **Spec commands fail.** With a server workspace selected:
  - New Spec stages its prompt with `fs.mkdirSync` under the server path on the Mac. A probe with a `/home/...` root throws `ENOENT`, and the dispatch ends in "Could not stage prompt".
  - `plan`, `tasks` and `implement` for a spec Frame does not see stage the prompt in the Mac's main checkout. The lane runs on the server, where the relative path does not exist.
- **The server has no Frame tooling.** `.frame/runtime/` and `.frame/bin/` are gitignored, so a clone sent by bundle or fetched from the remote has no command templates or hooks. Locally, `workspaceTooling.provision` copies them into each worktree, but only on the local disk.

The point of a server is that an agent keeps working while the laptop is closed. Today that agent can write code there but cannot run the spec flow, which is how Frame works.

## Goal

- **One spec list, server specs included.** For a connected server workspace, the Specs board, Home's Active Specs and the workspace rows show its in-flight specs, with the same dedupe rule as local workspaces (workspace copy wins over main). Opening one selects the workspace and shows spec / plan / tasks / outcome, phase and next action, read through Frame Server.
- **Spec commands run on the server.** New Spec, `spec.plan`, `spec.tasks` and `spec.implement` dispatched for a server workspace stage their prompt in the server worktree, and the lane runs there with a relative path that resolves.
- **Frame tooling in the server worktree.** The command templates, report assets, `.frame/bin` helpers and hooks that `workspaceTooling.provision` puts in a local worktree are present in a server worktree before a spec command runs, so the agent there has spec context and module hints as it would locally.
- **Spec state changes reach the desktop.** Phase changes and reports written on the server show in the desktop's list without a manual refresh while connected, and are current on reconnect.

## Constraints

- `spec-in-workspace` decisions stand: specs live in the workspace and travel with the branch; the staged template is the only spec flow; spec paths go through `frameStore`; never auto-commit.
- Task state never forks (`spec-in-workspace`): `tasks.json` lives in the main checkout. The server agent cannot reach the Mac's main checkout, so how its task updates reach the Tasks board is a decision for this spec (see Open Questions), not a silent second copy.
- Panel calls route explicitly by workspace id or by server root (`server-workspace-panels`, `serverPanels.resolve`). No generic IPC forwarder.
- Server file access follows existing rules: the server watches and pushes (no desktop polling over SSH); writes stay limited to what the spec flow needs (prompt and tooling staging, status updates), not general file editing.
- No protocol number bump for added methods (server-hardening rule). An older server answers "Unknown method", and the desktop says to update Frame Server.
- Frame never handles model tokens; agents on the server run under the user's own CLI sign-ins (`server-onboarding`).
- No new dependencies.

## Success Criteria

- When a server workspace is connected and its worktree holds `.frame/specs/<slug>/`, then the Specs board lists that spec once, tagged with the workspace, and opening it shows its spec.md, plan.md, tasks.md and phase read from the server.
- When the server is offline, then its specs show as unavailable with the host named, and nothing is listed from stale local state as if current.
- When the user starts New Spec with a server workspace selected, then the prompt file exists in the server worktree's `.frame/runtime/prompts/`, the Spec Creator lane runs on the server, and the new folder appears in the desktop list.
- When `spec.plan`, `spec.tasks` or `spec.implement` is dispatched for a server spec, then the lane runs in that server workspace and the instruction's relative path resolves there.
- When an agent in a server worktree edits a file, then Frame's hooks run there (the same hook output as in a local worktree).
- When a server agent advances a spec's phase or writes a report, then the desktop list shows the new phase within the existing push cadence, and View Report opens the server's report.
- When a server agent marks a spec task done, then the Tasks board shows it done once the chosen task-state path delivers it, and merging the branch causes no `tasks.json` conflict.
- When the desktop talks to an older Frame Server, then spec commands for a server workspace are refused with "Update Frame Server…", not a staging error.
- When `npm test` runs, then the existing tests pass, and the server spec list, the remote staging and tooling paths, and the offline rule have tests that fail before the change.

## Out of Scope

- Editing spec files from the desktop on the server (the editor stays read-only for server files)
- Orchestration (conductor and workers) on a server
- Moving a spec between a local and a server workspace
- Codex sign-in via localhost callback on a server
- Spec knowledge layer (`spec-index`) over unmerged server specs

## Open Questions

- **How a server agent's task updates reach `tasks.json`.** Options:
  - (a) The server writes task changes to a per-workspace file Frame Server pushes to the desktop, which applies them to the main checkout's `tasks.json`; offline changes apply on reconnect.
  - (b) In-flight spec task state stays in the spec folder (`tasks.md` / `status.json`), the Tasks board reads it from the server, and the import into `tasks.json` happens on merge.
- **Where server tooling comes from.** Options:
  - (a) The desktop uploads the staged templates and `.frame/bin` into the server worktree before each spec command, as `provision` does locally. They stay current with the desktop's version.
  - (b) The Frame Server package ships them and the server provisions its own worktrees. This works without the desktop, but the templates follow the server's version.
- **Live updates of server spec state.** Options:
  - (a) Frame Server watches `.frame/specs/` in its worktrees and pushes changes, like `git.status`.
  - (b) The desktop re-reads on panel open and on reconnect only.
