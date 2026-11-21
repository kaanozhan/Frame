---
keywords: frame cloud, cloud hub, cloud projects, project link, projectId, frameProjectId, link.claim, connect folder, on this device, rail cloud icon
related: frame-cloud-sign-in, settings-by-scope
---
Frame Cloud got one home: a rail cloud icon opening `#cloud-overlay` (cloudHub.js + cloudHubTabs.js) with the account (sign-in panes moved out of Settings), a Cloud projects tab and an On this device tab with Connect / Create / Disconnect. Settings → Account is now one row; Project Settings has a Frame Cloud row; the open project shows a Connected mark; palette gains cloud.open / connectProject / disconnectProject.
Why: FrameCloud #18 links a folder by its own `projectId` ("identity, not authority"), replacing the unshipped `cloud` block in config.json and the Home-device model. Settings could not hold two lists and a bulk action.
Shape: pure core `main/cloud/cloudProjects.js` (calls, refusal classes, identity-only `matchFolders`, `planFolderRow`, slugs, guarded `buildWebUrl`, tested with a fake fetch) + Electron shell `cloudProjectsService.js` (folder scan, remote via execFile, one auth wrapper, `userData/cloud-projects.json` cache, 3-at-a-time candidates, token-free push). `callTrpc` now sends GET input as `?input=`; `access`/Plan row are gone; `webOrigin` (origin only) is stored at sign-in, main-only.
Deviations from plan: `release()` itself reads FRAME_PROJECT_MISMATCH as detached; link IPC returns `{ ok, reason }`; list re-reads on entering signed-in, not on every device.me save; slug validation in the renderer goes through CLOUD_CHECK_SLUG (no main code in renderer), so name edits don't re-suggest the slug; the cloud button and mark use rebinding / native title because tooltip.js fixes its text.
Rules: a folder is connected only when a project's `frameProjectId` equals its `projectId`; nothing cloud-related is written into a project (only a first-time `projectId`, and only on connect/create); the renderer sends paths and project ids, never identities or URLs; bulk connect never answers a question; the modal never opens by itself except the sign-in landing (blocked by onboarding/tour); no timer refreshes.
Unverified: the renderer (no DOM harness, D6) and the acceptance walk against a live FrameCloud have not been run.

Chain: spec.md → plan.md → tasks.md → outcome.md
