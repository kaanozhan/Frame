---
keywords: copyFiles, gitignore, env, server workspace, file picker, upload, secrets, frame server
related: server-onboarding, workspaces, workspace-hardening, server-workspaces, server-linux-readiness
---

# Send git-ignored files to a server

## Problem

A project reaches Frame Server as its committed history only (`server-onboarding`: `git bundle … HEAD --branches --tags`, `gitBranchesManager.js:568`). That rule is right and stays. But a workspace usually needs files git never sees, such as `.env`, local config and certificates, and today a server workspace gets none of them.

For local workspaces Frame already copies a `copyFiles` selection (Project Settings, e.g. `.env*`) from the main checkout (`workspaceManager.copyIgnoredFiles`, `:112`). Server workspaces skip that step on the desktop (`createOnServer` returns `copied: []`, `:316`). The only way to get `.env` onto the server is to put it there by hand over SSH.

These files are mostly secrets. They should reach another machine only when the user sees exactly what is going and chooses it, which is how Conductor handles them too.

## Goal

- **A file picker modal.**
  - It shows the project's files that git does not carry, as a tree, in two groups: **ignored** (`.env`, local config) and **untracked, not ignored** (new files not yet committed, with a note that committing them is the better path).
  - Each entry has a checkbox; there is "Select all" and per-folder toggling.
  - The modal shows the total size and file count before sending.
  - Changes to tracked files are not offered.
- **Safe defaults.**
  - The modal opens with the project's `copyFiles` matches checked and everything else unchecked; "Select all" is never the default.
  - Dependency and build folders (`node_modules`, `.venv`, `dist`, `.next`, caches) and OS clutter (`.DS_Store`) show collapsed and unchecked, with their size and a note that they must be rebuilt on the server, since Mac-built native modules do not run on Linux.
  - A large selection is warned about before sending.
- **Where it appears.**
  - **When a project first goes to a server.** Chosen files go into the server's main copy of the project, from which Frame Server's own `copyFiles` step gives them to every new server workspace.
  - **When a server workspace is created.** It compares with what the server already has, marks entries "on the server" or "changed on this Mac", and can be passed with one click when nothing is missing.
  - **From a server workspace's row menu** ("Send files to server…"), to resend after a change.
- **Remember the choice.** A "Remember for this project" box saves the selection as the project's `copyFiles` patterns, so the next modal opens with them checked.
- **Say what happened.** After sending, the workspace notice lists what was sent, and what was skipped and why.

## Constraints

- Committed-history-only for the project itself stays as decided in `server-onboarding`. This spec adds an explicit, per-send choice for files outside git; nothing is ever sent without the user ticking it.
- `copyFiles` keeps its meaning and matching rules for local workspaces (`workspaces`, `workspace-hardening` L9/L10: `copyFilesMatch`, `dirsToExpand`, `verbatimSymlinks`, never overwrite).
- Transfer uses the existing SSH channel (`serverInstaller.upload`) into Frame Server's tmp folder, like the bundle. The server unpacks only inside the target project or workspace folder and refuses paths that escape it (`..`, absolute paths, symlinks pointing outside).
- No file content is logged on either side, nor sent to telemetry.
- The file tree is read on the desktop from git (`git ls-files --others`), not by walking `node_modules`. The modal must stay responsive on large repositories.
- Frame Server runs as the user; file modes are kept, so a `0600` `.env` stays `0600`.
- No protocol number bump for added methods; an older Frame Server answers "Unknown method" and the desktop says to update it.
- No new dependencies.
- The renderer has no DOM test harness: the modal's selection, defaults and size rules live in a pure module that is tested.

## Success Criteria

- When the user creates the first server workspace of a project, then the modal opens after the project is sent, listing the git-ignored and untracked files with `copyFiles` matches checked and dependency/build folders unchecked.
- When the user unticks some entries and sends, then exactly the ticked files arrive in the server's copy with their modes, and a server workspace created next has them.
- When the user creates another server workspace, then entries already on the server show as "on the server", entries that differ show as "changed on this Mac", and with nothing missing the modal can be passed with one click.
- When the user picks "Send files to server…" on a server workspace row, then the same modal opens for that workspace and sends into it.
- When "Remember for this project" is ticked, then the project's `copyFiles` holds the selection and the next modal opens with it checked.
- When a file already exists on the server, then it is handled as the plan decides, and the notice says which files were overwritten or skipped.
- When an archive contains a path that escapes the target folder, then the server refuses the whole send and writes nothing.
- When the selection is larger than the warning threshold, then the modal warns with the size before sending.
- When the desktop talks to an older Frame Server, then the modal says to update Frame Server instead of failing silently.
- When `npm test` runs, then the selection/default/size rules, the packing, the server-side unpack (including path-escape refusal and modes) and the comparison with the server have tests that fail before the change.

## Out of Scope

- Syncing files continuously between the Mac and the server
- Pulling files back from the server to the Mac
- Sending uncommitted changes to tracked files
- A secrets manager or encryption at rest on the server
- The same picker for local workspaces (they keep today's automatic `copyFiles`)

## Open Questions

- **A file that already exists on the server.** Options:
  - (a) Skip it and say so, with an explicit "overwrite" tick per file in the modal.
  - (b) Overwrite what the user ticked, since ticking is the consent.
- **Projects in `gitSharing: local` mode.** There, `.frame/config.json` never reaches the server, so Frame Server's own `copyFiles` step has no patterns. Options:
  - (a) For such projects the desktop sends the chosen files into each new server workspace itself, not via the server's main copy.
  - (b) Send them into the main copy and also pass the patterns to the server with each workspace create.
- **The size warning threshold, and whether there is a hard limit.** Options:
  - (a) Warn above 50 MB; no hard limit.
  - (b) Warn above 50 MB and refuse above 1 GB.
