---
keywords: spec, server workspace, self-hosted, frame server, spec list, prompt staging, tasks, tooling
related: spec-in-workspace, server-workspaces, server-workspace-panels, server-onboarding, cli-spec-command-parity
---
The spec flow now works in server workspaces: specs written on the server show on the desktop board (chip `name · host`, `· offline` when unreachable), open from the server, and New Spec / Plan / Tasks / Implement run there.

How:
- Frame Server's `src/server/specs.js` runs specManager's per-checkout readers (`listSpecsIn` and the rest, scoped by `inCheckout`). Its methods are `specs.list/get/report/status/stage/watch/unwatch`, and it pushes `specs.changed { root }`. Every call must name a server project in the server's registry and one of its active workspaces.
- `specs.stage` provisions the server clone from the package (parser and hook scripts, command templates, spec index), copies the tooling into the worktree, and builds the prompt with `{tasks_path}` set to the clone's tasks.json.
- The desktop keeps a server spec cache merged into the synchronous `listSpecs`. The IPC handlers (`GET_SPEC`, `READ_SPEC_REPORT`, `UPDATE_SPEC_STATUS`, `BUILD_SPEC_COMMAND_FILE`) route server slugs or a server `workspaceId` to the server. `getSpec` stays synchronous for workspaceGitState.

Why: the server builds prompts from its own package (rejected: the desktop uploading prompts and tooling). Task state stays in the server clone and is imported as completed after merge (rejected: live mirroring into the Mac's tasks.json, which means two writers).

Rules for future work:
- Server rows reach workspaceManager only when the renderer re-lists, so the cache follows `workspaces.updated` after 1.5 s and re-lists a root right after staging there.
- Decide `gitSharing: local` on the desktop: in local mode `.frame/` never reaches git, so the server clone has no config that says so. The live check found this.
- An offline `GET_SPEC` is getSpec-shaped (last known title and phase, the reason as spec.md), so every view renders it unchanged.
- Rename and delete of server specs are refused.

Chain: spec.md → plan.md → tasks.md → outcome.md
