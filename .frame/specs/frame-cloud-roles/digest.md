---
keywords: frame cloud, roles, admin, developer, viewer, permissions, role forbidden, workspace role
related: frame-cloud-projects, frame-cloud-no-workspace, frame-cloud-sign-in, frame-cloud-briefs-create, frame-cloud-brief-done, frame-cloud-brief-start
---
Frame now reads the workspace role (admin | developer | viewer, FrameCloud #28) and offers only what it allows.
- One map in main: `cloudProjects.WORKSPACE_PERMISSIONS` / `can` / `permissionsOf` copy the protocol literally; an unknown role holds nothing (D1; rejected "treat as viewer" and "hide nothing").
- `cloudProjectsService.can` / `refuseUnless` guard every write in main after the signed-in/workspace/connected checks; `publicState().permissions` ({ work, manage }) is all the renderer gets. Background writes (`sendBranch`, done reports) skip silently; the agent bus refuses through a local `workCall` so the cores stay pure.
- Viewer: no cloud surface in Frame (D2, overturning the spec's read-only Briefs): no Briefs row, no Connected mark, no Connect/Disconnect, palette commands hidden; the window shows a viewer card in the no-workspace stand-in panel; Project Settings says "Viewer in …".
- Developer: Create hidden, "An admin adds projects to Frame Cloud." in its place (D3: hidden over disabled).
- `ROLE_FORBIDDEN` → `roleForbidden`, one sentence in `src/renderer/cloudRoles.js`; `call()` re-reads `device.me` on it and on `noWorkspace`, never retries.
- Role changes arrive by `device.me` on every window focus while signed in (D9, no timer) and are pushed when permissions change under the same session.
Rules: no workspace beats viewer (D7); reads are never role-gated; new cloud writes must call `refuseUnless` and map `roleForbidden` to `cloudRoles.ROLE_FORBIDDEN`; role copy lives only in `cloudRoles.js`.

Chain: spec.md → plan.md → tasks.md → outcome.md
