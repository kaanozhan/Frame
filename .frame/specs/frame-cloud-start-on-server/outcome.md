# Outcome — Start Work on a Frame Server

## T01 — workspaceManager.create({ from: 'new', branch }) and startSha

Let `workspaceManager.create({ from: 'new', branch })` validate the name, refuse a taken one (`Branch "…" already exists.`), cut it from the fetched `origin/<base>` and name the workspace from its last segment; both `from: 'new'` paths now return `startSha`, and `createOnServer` passes it through only when the server answers one. The start point keeps the existing fallback to the local base when `origin/<base>` is missing — the origin-only rule is enforced by the preflight (T02/T06), not here. Files: `src/main/workspaceManager.js`, `test/serverProjects.test.js`.

_Captured: 2026-11-25T09:12:25.109Z · 2 file change(s)_

---

## T02 — Server workspaces.preflight

Added `workspaces.preflight` to `src/server/projects.js`: registered project only, branch and base validated before git, `fetchBranch` then `localBranchExists`/`remoteBranchExists`, answering `{ branchTaken, baseOnOrigin, fetch, tasksPath }`. `base` is a plain branch name (the caller strips `origin/`), and `tasksPath` is null when the clone has no Frame setup, as `tasks.list` answers — a detail the plan did not specify. Files: `src/server/projects.js`, `test/serverProjects.test.js`.

_Captured: 2026-11-25T09:14:22.310Z · 2 file change(s)_

---

## T03 — Server specs.create

Added `specs.create` to `src/server/specs.js` behind `checkout()` and `needSlug()`: string `spec.md`/`status.json` only, create-only folder, atomic writes, answering `{ created }`. Beyond the plan's guard list it also refuses `gitSharing: local` with the module's `LOCAL_MODE` sentence, matching `specs.stage` and the spec's local-mode constraint (the desktop refuses it first in T07). Files: `src/server/specs.js`, `test/serverSpecs.test.js`.

_Captured: 2026-11-25T09:15:34.669Z · 2 file change(s)_

---

## T04 — Server tasks.insert

Added `tasks.insert` to `src/server/tasks.js`: `needFrame(project())`, one load/save, rows appended whole, `metadata.totalCreated` bumped, `{ tasksPath }` answered. It also refuses an id repeated inside the same call and rows without a string id, neither of which the plan named. Files: `src/server/tasks.js`, `test/serverTasks.test.js`.

_Captured: 2026-11-25T09:16:34.372Z · 2 file change(s)_

---

## T05 — Begun store keeps serverKey; per-server liveness

Gave the begun entry an optional `serverKey` and factored liveness into an exported `begunLive`, which `withBegunBranches(…, servers)` now uses; live server parts carry `begunServerKey`, Mac parts keep their exact shape. With `servers` left out every server entry counts, which the plan did not state, matching the existing `localBranches` default. Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-25T09:18:54.503Z · 2 file change(s)_

---

## T06 — Server path of handleStartRequest

Added the server path to `handleStartRequest`: origin-only base, `serverPreflight` refusals before `brief.start`, no Mac `createBranch`, `baseSha` from the server's `startSha`, `serverKey` in `recordBegun`, and `begunStands`/`hostOf` in Begin's guard. Two choices the plan left open: the server task part's `tasksPath` comes from the preflight answer inside the core (not a service `tasksPath` dep), and a server start skips the Mac's `branchTaken` check, deferring to the server's. The core's workspace answer also gains `location`/`serverKey`/`host` on a server so the renderer's fallback select is correct. Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-25T09:21:07.359Z · 2 file change(s)_

---

## T07 — Service wiring for the server location

Exported `workspaceManager.serverProject` and wired the server location into `cloudStartService`: `localMode` refusal, `serverDeps` (preflight with ensure, server create, `specs.create`, `tasks.insert` + `refreshServerTasks`), `begunStands`/`hostOf`, merged `taskIds`, and a `servers` map from `git.branches` for `withBegunBranches` and `prepare` (which now returns `localMode`). There is no service `tasksPath` dep for a server: T06's core takes it from the preflight. A server that holds no findable clone reads as unknown, not gone, a choice the plan left open. Files: `src/main/workspaceManager.js`, `src/main/cloud/cloudStartService.js`.

_Captured: 2026-11-25T09:23:14.505Z · 2 file change(s)_

---

## T08 — Copy: server refusals, server-aware partWorkspace, chip and Location

Added the server refusal sentences, a server-aware `partWorkspace`, `partWorkspaceChip` (D3), the Location label/hint copy, and the host in `startedNotice`. Diverged from plan.md: `SERVER_LOCATION_LABEL` is not dropped here, because `cloudStartDialog.js` still renders it until T09 replaces the Coming soon radio. It goes in T09, "once unused" as the Files section words it. Files: `src/renderer/cloudBriefsCopy.js`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-25T09:25:00.463Z · 2 file change(s)_

---

## T09 — Dialog: Location radios, origin-only bases, per-location names

Replaced the Coming soon location with This Mac / per-server radios (offline and local-mode disabled, with a hint line), filtered the base menu to origin bases on a server with the target-then-first-remote swap, made the workspace-name line count the chosen location's names, and sent `serverKey` with the request. Dropped `SERVER_LOCATION_LABEL` here rather than in T08, once it was unused (see T08). Files: `src/renderer/cloudStartDialog.js`, `src/renderer/cloudBriefsCopy.js`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-25T09:26:18.292Z · 3 file change(s)_

---

## T10 — Card chip for a server part

Made `renderPartWorkspace` draw the D3 chip from `copy.partWorkspaceChip`: a button for This Mac and connected servers, and a dashed, non-clickable span while the server is offline. Added the server, offline and location-hint styles to `cloud-briefs.css`, and removed the Location row's `.cloud-briefs-start-soon` override left unused by T09. Files: `src/renderer/cloudBriefsPanel.js`, `src/renderer/styles/components/cloud-briefs.css`.

_Captured: 2026-11-25T09:27:02.951Z · 2 file change(s)_

---

## T12 — The normal server way on Begin: Send files and the sent notice

Added T12 after T10, outside the original plan. The Flow's step 8 kept `openBeginLane` unchanged, which missed the spec's "normal server way" (New Workspace's Send files step and its sent-project notice). `selectBegunWorkspace` now offers `sendFilesModal` for a server workspace before setup, and `sent` travels from `serverProject({ ensure })` through the preflight and the start's answer to `cloudBriefsCopy.sentNotice`. Files: `src/main/workspaceManager.js`, `src/main/cloud/cloudStartService.js`, `src/main/cloud/cloudStart.js`, `src/renderer/cloudBriefsCopy.js`, `src/renderer/cloudBriefsPanel.js`, `test/cloudStart.test.js`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-25T11:14:41.962Z · 7 file change(s)_

---


## T11 — Walk it, together with frame-cloud-start-places

Walked as part of `frame-cloud-start-places` T11, where `a3f99d0` moved it so one walk covers both specs. The developer reported both specs working on 2026-11-26. No code changed. The report did not list S1–S11 one by one. Two of this spec's decisions did not survive: `frame-cloud-start-places` overturned D2 (This Mac preselected; the place is now picked with none preselected) and replaced the Location radio row (T09) with three place cards.

_Captured: 2026-11-26 · 0 file change(s)_

---
