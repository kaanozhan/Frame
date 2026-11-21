## T01 — Add `src/main/cloud/cloudBriefs.js` with `test/cloudBriefs.test.js`

Added the pure read core: `listBriefs` (sends `includeClosed` only when true), `listMilestones`, `getBrief` (`brief.getByNumber` by project slug and number, parts sorted by position), `briefEvents` and `buildBriefWebUrl` (project URL + `/briefs/<n>`, built on `cloudProjects.buildWebUrl`, so its origin and slug guards apply). The normalizers keep only the fields the view draws (no `assigneeId`, `version`, `decidedAt`), fold unknown enum values to safe defaults and drop rows without an id. 16 tests cover input shapes, normalization, the `BRIEF_NOT_FOUND` → `notFound` path and URL guards. Files: `src/main/cloud/cloudBriefs.js`, `test/cloudBriefs.test.js`.

_Captured: 2026-09-18 · 2 file change(s)_

---

## T02 — Export `call` and add `connectedProject(path)` in `cloudProjectsService.js`

Exported the existing `call()` wrapper and added `connectedProject(path)`, which matches the folder against the cached `project.list` via `core.matchFolders` and returns `{id, slug, name}` or null. It reads the service's current `folders` without rescanning, so it answers exactly what the renderer's Connected mark was last pushed, and it returns null whenever the service is signed out. File: `src/main/cloud/cloudProjectsService.js`.

_Captured: 2026-09-18 · 1 file change(s)_

---

## T03 — Add `cloudBriefsService.js`, the three IPC channels and its `setupIPC`

Added `src/main/cloud/cloudBriefsService.js`: `list` runs `listBriefs` and `listMilestones` in parallel, `get` runs `getBrief` then `briefEvents`, and `openOnWeb` opens the project URL, or the brief URL when given a number. All calls go through `cloudProjectsService.call`, and a path that `connectedProject` does not resolve returns `{ok:false, reason:'notConnected'}` before any request. "You" comes from `cloudSession.getPublicState().user.id`, as the plan decided, not `auth.me`. `list`/`get` also return `canOpenWeb` so the panel can hide Open on web when no origin is known, which the plan did not name. Files: `cloudBriefsService.js`, `src/shared/ipcChannels.js`, `src/main/index.js`.

_Captured: 2026-09-18 · 3 file change(s)_

---

## T04 — Port the web's brief helpers into `cloudBriefsCopy.js`

Ported `groupByColumn`, the column copy from `brief-board.tsx`, `KIND_COPY`, `priorityLabel`, `endingFact`, `actorLabel`, `formatDate` and `eventSentence` from FrameCloud `lib/brief.ts` into pure CommonJS, and added `reasonMessage` for the panel's read failures. Beyond the port, the file adds `statusLabel` and `endingLine` for the detail header and cards, drops the write copy (Transform label, mutation error sentences, search params), and gives an unknown event or status a safe fallback where the web's TS relies on exhaustive types. 13 tests in `test/cloudBriefsCopy.test.js` cover grouping order, ending precedence, every event branch and You vs A workspace member.

_Captured: 2026-09-18 · 2 file change(s)_

---

## T05 — `#cloud-briefs-panel` markup, `PANEL_REGISTRY` entry and visibility rules

Added `#cloud-briefs-panel` to `index.html` beside Sessions: a shared `.view-header` (count, Show closed checkbox, Refresh, Open on web), a `#cloud-briefs-content` body, and an `aside` carrying `specs-dashboard-detail` / `-bar` / `-back` / `-content` so the Specs drawer's slide comes for free. The drawer bar has only the back button, not the Specs × close, because this panel's own header has no close. Registered `cloudBriefs` in `PANEL_REGISTRY` (lazy require, so it is inert until T07's module exists) and added the hidden-at-home / `.visible` rules with `position: relative` to anchor the drawer in `panels.css`.

_Captured: 2026-09-18 · 3 file change(s)_

---

## T06 — Briefs row after Sessions and the `available()` hide pass

Added the `cloud-briefs` row (◇ Briefs, surface `panel:cloudBriefs`, no count) after Sessions in the Context group, with `available: () => require('./cloudBriefsPanel').isAvailable()`. `refreshWorkspaceNav` now hides any row whose `available()` is false or throws. Unlike the plan's bare `row.hidden`, it also sets an inline `display: none`, because `.workspace-nav-item`'s `display: flex` overrides the `[hidden]` attribute and no nav CSS file is in the footprint. The throw guard keeps the row hidden until T07's module exists. File: `src/renderer/projectListUI.js`.

_Captured: 2026-09-18 · 1 file change(s)_

---

## T07 — `cloudBriefsPanel.js` shell and its wiring

Created `src/renderer/cloudBriefsPanel.js` with `init(cloudHub)`, `show`, `hide`, `isVisible` and `isAvailable`. `isAvailable` is `cloudProjectMark.openFolder()`'s folder being `connected` with a `project`. `init` subscribes to `hub.onProjects`, `hub.onSession` and `state.onProjectChange`, and each change calls `projectListUI.updateWorkspaceNav()` (lazy require, to avoid a cycle with the nav). The hide-when-disconnected and reload-while-visible behaviour the plan puts in `init` is left to T10, as `tasks.md` splits it there. Wired `cloudBriefsPanel.init(cloudHub)` in `src/renderer/index.js` right after the Connected mark.

_Captured: 2026-09-18 · 2 file change(s)_

---

## T08 — Render the board

`cloudBriefsPanel.show()` resets Show closed to off and loads through `CLOUD_BRIEFS_LIST`. Loads are sequence-numbered, so a stale answer from another project, a toggle or a second refresh is dropped, and `hide()` bumps the number too. A refresh of the same folder keeps the board and spins the button, while a different folder starts from the loading state. The board draws Backlog / Active / Done (web copy and hints), a Closed section when toggled, and escaped cards (`#n`, kind badge, work-only priority dot, milestone name, ending line), plus empty-with-Open-on-web and error-with-Retry states, and `unauthorized` renders nothing because the session push hides the view. The header count is the number of briefs shown, and Open on web hides when main reports no web origin. New `styles/components/cloud-briefs.css` is imported in `main.css` after `cloud-hub.css`.

_Captured: 2026-09-18 · 3 file change(s)_

---

## T09 — Render the detail drawer

A card click slides the Specs-class drawer in with a loading state and loads through `CLOUD_BRIEF_GET`, guarded by its own sequence number. Back, Esc (only while the drawer is open) and `hide()` close it. The drawer shows a header (`#n`, kind, status, title, ending line, Open on web to the brief URL), a meta row (priority for work, milestone name from the board's list, target branch, "Created <date> by You / A workspace member" from the `created` event), and four tabs with counts. Description is the body escaped as `pre-wrap` text plus `http(s)`-only attachment links opened via `shell.openExternal`; Parts, Comments and History use the web's empty-state copy. A failed load shows a notFound-specific message with Retry. Deviation from the plan: the drawer covers the panel header, so `index.html` gains a second Refresh button in the drawer bar that reloads both the board and the brief.

_Captured: 2026-09-18 · 3 file change(s)_

---

## T10 — Keep the panel live

`onCloudChange` (projects push, session push, project switch) still refreshes the nav. While the panel is visible it now calls `hide()` when `isAvailable()` turns false, and the host's MutationObserver returns to terminals. The board reloads, and the open brief with it, only when a key of folder path, cloud project id and the list's `lastUpdated` changes. The key is needed because the hub also pushes on every candidate lookup, which would otherwise re-fetch briefs repeatedly. A change of folder also closes the drawer, since that brief belongs to the previous project. Checked in code, not in a running app: sign-out, disconnect and a switch to an unconnected folder all route through `isAvailable()`.

Followup: exercise the panel against a live FrameCloud `feat/desktop-projects` server (switch, sign-out, disconnect) — no DOM tests cover it.

_Captured: 2026-09-18 · 1 file change(s)_

---

## T11 — Reload the Briefs panel when the Frame window regains focus

Added a renderer `window` `focus` listener to `cloudBriefsPanel.js`. While the panel is visible it hides if the folder is no longer connected; otherwise, 30 s or more after the panel's last load, it runs `refresh()` (the board, plus the brief when the drawer is open). No main-process change was needed. Beyond the plan: the same 30 s window now also suppresses T10's reload when only the project list's `lastUpdated` moved. Without it, one return to the app would reload twice, once from this handler and again when `cloudProjectsService`'s own focus refresh lands. A change of folder or project still reloads at once. Added after implementation at the user's request; in-app navigation back to Briefs already reloaded through `show()`.

_Captured: 2026-09-19 · 1 file change(s)_

---
