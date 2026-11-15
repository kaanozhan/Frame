---
keywords: copyFiles, gitignore, env, server workspace, file picker, upload, secrets, frame server
related: server-onboarding, workspaces, workspace-hardening, server-workspaces, server-linux-readiness
---
Files git does not carry (`.env`, local config, certs) can now reach a server workspace, but only those the user ticks.

- **Modal (`sendFilesModal`).** It lists git's ignored paths and untracked files in two groups.
  - Opens after a server workspace is created and before its setup and agent start; also from a server row's "Send files to server…".
  - Defaults: `copyFiles` matches ticked; heavy folders (`node_modules`, build output, caches, `.DS_Store`) and files identical on the server unticked.
  - Size: warn above 50 MB, refuse above 1 GB. "Remember" merges anchored patterns into `copyFiles`.
- **Transfer.** Files go as a small zlib archive of our own (`fileArchive`), not `tar`, over the existing SSH upload.
  - The server refuses the whole send if any path is absolute, contains `..`, touches `.git`, or is a symlink pointing outside.
  - It skips a file whose path crosses a symlinked folder, keeps modes, and removes the archive.
- **Destination.** Ignored files go to the workspace and the server's main copy; untracked ones to the workspace only.
  - The desktop passes its `copyFiles` patterns with `workspaces.create`, and the server copies matching files from the main copy into each new workspace. This works the same in local mode.
- **Never sent:** `.frame/`. The desktop re-checks every path against git, never trusting the renderer.

Live-check findings, now rules:
- Sent files are written into the main copy's `.git/info/exclude` (a Frame-managed block). The main copy's checkout can be older than `.gitignore`; otherwise a sent `.env` would show as untracked there and never reach new workspaces.
- A path git also lists inside a collapsed folder is dropped, so the folder is not drawn twice.

Rejected:
- Sending `copyFiles` matches automatically (secrets need a visible, ticked choice).
- System `tar` (bsdtar/GNU differences make up-front path checks unsafe).
- Workspace-only delivery (resend for every workspace).

Chain: spec.md → plan.md → tasks.md → outcome.md
