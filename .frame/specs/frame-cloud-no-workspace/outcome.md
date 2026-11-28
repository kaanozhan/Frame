# Outcome — Frame Cloud no workspace

## T01 — Pin the null workspace in the sign-in core

Added doc-comment lines to `runSignIn` and `refreshSession` in `src/main/cloud/deviceFlow.js` saying `session.workspace` may be null, with no code change, since both already pass the server's `workspace` through (D4). Added three tests to `test/cloudDeviceFlow.test.js`: register answering `workspace: null` signs in, `me` answering null returns null, and a later `me` returns a new workspace. The 412 `NO_WORKSPACE` test is unchanged.

_Captured: 2026-09-28 · 2 file change(s)_

---

## T02 — The /new link

Extracted the origin guards into a private `webBase(apiUrl, webOrigin)` in `src/main/cloud/cloudProjects.js`, used by `buildWorkspaceWebUrl` (and so by `buildWebUrl`) and by the new exported `buildNewWorkspaceWebUrl` → `<origin>/new`. Added four tests to `test/cloudProjects.test.js`: https, loopback over http, an http origin for an https API, and non-http or missing origins. The existing builder tests pass unchanged.

_Captured: 2026-09-28 · 2 file change(s)_

---

## T03 — The projects service stops at no workspace

Added `hasWorkspace()` to `src/main/cloud/cloudProjectsService.js`. Signed in without one, `status()` answers `'noWorkspace'` and `refresh()` only scans folders, drops `autoShowPending` and pushes. `loadCandidates` is skipped, `linkBlocked`/`checkSlug` refuse with `noWorkspace`, the cache is not loaded for an empty slug, and `openWorkspaceOnWeb` opens `/new`. As planned, the service stays untested (Electron wrapper, D3).

_Captured: 2026-09-28 · 1 file change(s)_

---

## T04 — Re-read on focus

Added a `focus` listener in `cloudSession.init(window)` (`src/main/cloud/cloudSession.js`). While the state is `signedIn` and `state.workspace` is empty, it calls `refresh()` at most once per `NO_WORKSPACE_FOCUS_MS` (10 s). The throttle stamps on the attempt, not on success, so an unreachable server is not asked on every focus.

_Captured: 2026-09-28 · 1 file change(s)_

---

## T05 — The copy

Wrote `src/renderer/cloudNoWorkspace.js` (`NO_WEB_ORIGIN`, `workspaceRow`, `panel` with 0/1/N wording, `settingsRow`) and `test/cloudNoWorkspace.test.js` (8 tests, including a no-trial/plan/Pro/price guard). Two departures from `plan.md`: the body says briefs are seen "from the web" as `spec.md` has it, dropping the plan example's "and your phone"; and `settingsRow()` also returns the `action` label ("Open Frame Cloud"). "Has a workspace" means a non-empty slug, the same test as `hasWorkspace()` in main.

_Captured: 2026-09-28 · 2 file change(s)_

---

## T06 — The G-A panel in the Frame Cloud window

Added `#cloud-workspace-link-label`, `id="cloud-tabbar"` and `#cloud-no-workspace` to `index.html`. `src/renderer/cloudHub.js` now draws the Workspace row from `workspaceRow()`, and a new `renderNoWorkspace()` swaps the tab bar, tabs and devices notice for the card (button through the existing `openWorkspace` action, disabled with `NO_WEB_ORIGIN` without `canOpenWeb`) and swaps back when a workspace appears. `cloudHubTabs.render` returns early on `noWorkspace`, and `.cloud-no-workspace` is styled in `cloud-hub.css`. Beyond the plan, `setTab` keeps both tab panels hidden while there is no workspace, so `open({ tab })` or the devices prompt cannot reveal an empty tab behind the card.

_Captured: 2026-09-28 · 4 file change(s)_

---

## T07 — Project Settings row

Added a `projects.status === 'noWorkspace'` branch before the `!listed` one in `renderCloudRow` (`src/renderer/projectSettingsModal.js`). It shows `settingsRow()`'s "No workspace" label and description with an "Open Frame Cloud" button that opens the window without a tab, since the no-workspace panel stands in for both. Without this branch the row would read "Loading…" forever.

_Captured: 2026-09-28 · 1 file change(s)_

---

## T04 follow-up — Drop the no-workspace focus throttle

In the manual walk, the first return to Frame after creating a workspace did not update. Clicking "Create a workspace ↗" focuses Frame, which started the 10 s throttle, and a quick trip to the browser came back inside that window and was skipped. Removed `NO_WORKSPACE_FOCUS_MS` and its timestamp from `src/main/cloud/cloudSession.js`, which overturns D9: focus fires once per return to the window, and `refresh()` already shares one request, so the throttle protected nothing and could miss a real return. The re-read still runs only while signed in without a workspace.

_Captured: 2026-09-28 · 1 file change(s)_

---

## T08 — Walk it

Walked by the user twice in the dev build against FrameCloud's dev server on `feat/desktop-no-workspace`. Walk 1: signing in without a workspace reached the no-workspace card, and after creating a workspace on the web the list appeared, but only on the second return to Frame (the focus throttle, fixed in the T04 follow-up). Walk 2, after that fix: the list appeared on the first return. The walk reports did not separately confirm the relaunch with no `project.list` in the server log, the Project Settings row, the missing Connected mark and Briefs row, or sign-out.

_Captured: 2026-09-28 · 0 file change(s)_

---

