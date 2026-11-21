# Outcome — Start Work in workspaces

## T01 — The task run names its tasks file

Added an optional `tasksPath` to `buildTaskPrompt` in `src/renderer/tasks/runPrompt.js`. When it is set, the completion line names that absolute path and adds "Use that exact file, not a tasks.json inside the working folder". A blank or missing value leaves the prompt byte-identical. Beyond the plan, which named only the completion sentence, the format step's "Read this task in tasks.json" now names the same path, because a Begin task row with no acceptance criteria would otherwise send the agent to the worktree's copy, where the row does not exist. Tests in `test/taskRunPrompt.test.js`.

_Captured: 2026-11-19 · 2 file change(s)_

---

## T02 — Refs are unique across checkouts

`specSlugs` in `src/main/cloud/cloudStartService.js` now returns the union of the main checkout's `.frame/specs/` folder names and every slug `specManager.listSpecs(folderPath)` reports (main, active workspaces, cached server workspaces). A failed `listSpecs` is logged and falls back to the folder names alone. No test was added: the service needs Electron, and `allocateRefs`, which consumes the list, is already covered.

_Captured: 2026-11-19 · 1 file change(s)_

---

## T03 — Start Work drops the dirty check and the stash

Removed the `changeCount`/`dirty` refusal, the stash step, `stashMessage` and the `currentBranch`, `changeCount` and `stash` deps from `handleStartRequest`. `prepareView` no longer takes or returns `currentBranch` and `changeCount`, and the service lost its `changeCount` helper and the matching wiring. Tests in `test/cloudStart.test.js` replace the two stash tests with one asserting that no dirty-folder dep is ever called, even when a request still sends `stash: true`. Until T04 lands, the branch is still checked out in the main checkout, so uncommitted changes carry over onto it instead of being stashed.

_Captured: 2026-11-19 · 3 file change(s)_

---

## T04 — Start Work opens the part in a new workspace

`handleStartRequest` now cuts the branch without a checkout (`git.createBranch(…, false, …)`), reads `baseSha` from the new branch's tip (`deps.branchSha` → `git.branchTipSha`, replacing `headSha`), and opens the branch with `workspaceManager.create({ from: 'branch', branch, base: workspaceBase(base) })`. A failure there, or an answer with no id or path, returns `partial('workspace')` and leaves the branch in place. A spec part's files go to the workspace root (`writeSpec(slug, files, root)`) and a task part's row stays in the main checkout. Success adds `workspace`, `setupScript` and, for a task, `begin.tasksPath` (`frameStore.resolvePath`); tests in `test/cloudStart.test.js` (65 pass). Followup: the service calls `workspaceManager.create` outside the per-project `serialize` queue the IPC path uses, because the plan keeps `workspaceManager` unchanged. A `createQueued` export, like `archiveQueued`, would order it behind a New Workspace create started at the same moment.

_Captured: 2026-11-19 · 3 file change(s)_

---

## T05 — The start copy names the workspace

In `src/renderer/cloudBriefsCopy.js`, `PARTIAL_STEPS` drops `stash` and gains `workspace` ("opening a workspace on its branch failed"), which tells the reader the branch is there. `startedNotice` drops `stashMessage` and ends with ", in workspace <name>" when the result carries a workspace name. Without one, it ends at the branch as before. Tests in `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-19 · 2 file change(s)_

---

## T06 — The lane opens in the new workspace after setup

`openBeginLane` in `src/renderer/cloudBriefsPanel.js` now takes the whole start result. A new `selectBegunWorkspace` runs `workspaceSection.load()`, selects the listed record (falling back to the result's workspace), awaits `runSetupThenAgent({ setupScript, openAgent: false })` when there is a script, and selects again. If the project changed meanwhile, no lane opens. Then `/spec.plan` or the task run opens as before, with `tasksPath` passed through `runTaskWithOptions` to `buildTaskPrompt`, and `UPDATE_TASK in_progress` still goes to the main checkout. The re-select runs only after a setup script, since nothing can move the user without one. DOM code, so no new test.

_Captured: 2026-11-19 · 1 file change(s)_

---

## T07 — The dialog drops the dirty prompt and the stash

Removed `showDirty`, the `stash` dialog state and its `data-action`, the dirty placeholder element, the `stash` request field and the `reason === 'dirty'` branch from `src/renderer/cloudStartDialog.js`. `dirtyWarning` and `STASH_AND_CONTINUE_LABEL` are gone from `src/renderer/cloudBriefsCopy.js`, and the copy test now asserts both are absent. The now-unused `.cloud-briefs-start-dirty` CSS rule is left for T08, which owns the dialog styles.

_Captured: 2026-11-19 · 3 file change(s)_

---

## T08 — The dialog shows where the work goes

`src/renderer/cloudStartDialog.js` shows a Workspace line under the branch row. It follows the typed branch, or the suggestion when the field is empty, through `copy.beginWorkspaceName`, which uses `toSlug`/`uniquify` against the loaded local workspaces' names. With a saved server (`serverConnect.getServers()`), a Location line shows "This Mac" checked and a disabled "Server · Coming soon" (`.cloud-briefs-start-soon`), and `onChange` now ignores radios outside the part choice. The naming helper lives in `cloudBriefsCopy.js`, beside the new labels and the updated descriptions and `beginHint`, so it is testable. Styles for both lines replace the dead `.cloud-briefs-start-dirty` rule. The layout was not checked in the running app.

_Captured: 2026-11-19 · 4 file change(s)_

---

## T09 — workspaceSection.onChange

Added `onChange(fn)` to `src/renderer/workspaceSection.js`. It returns an unsubscribe function, and each listener gets the active workspace list after every `load()` that lands, right after `render()`. A load overtaken by a newer one, or by a project switch, calls nothing, and a throwing listener is logged without stopping the others. DOM module, so no new test.

_Captured: 2026-11-19 · 1 file change(s)_

---

## T10 — The Briefs card names the part's workspace

Added `partWorkspace(part, workspaces)` and `partWorkspaceHint(name)` to `src/renderer/cloudBriefsCopy.js`. `partWorkspace` returns the active local workspace (not archived, missing or on a server) on `begunBranch`, else the cloud `branch`. `renderPartRow` in `src/renderer/cloudBriefsPanel.js` adds a `.cloud-briefs-prow-ws` chip after the status text, and its `select-part-workspace` action selects the listed workspace. Rows redraw through `renderPartSlots` on `workspaceSection.onChange`, so an archived workspace's chip drops and the row reads its plain state (plan decision, spec Open Question 2). The match uses the record's `branch`, not the git-reported `headBranch`. Tests in `test/cloudBriefsCopy.test.js` (118 pass).

_Captured: 2026-11-19 · 4 file change(s)_

---

## T11 — The part is cut from a fresh base

Added after T10, when the user asked whether the base menu should offer origin's branches. It already did, but nothing was fetched, and the default was the local target, which can be behind origin. `pickBase` in `src/main/cloud/cloudStart.js` now prefers `origin/<target>`, then the local target. `handleStartRequest` fetches an `origin/` base through a new `fetchBase` dep, after every check and before `brief.start`, and returns `fetch: { fetched, error, skipped }`. A failed or throwing fetch is no refusal: the branch is cut from the last fetched copy. A local base, picked or defaulted, is not fetched. `cloudStartService.js` wires `fetchBase` to `git.fetchBranch` (15 s cap, never throws). `fetchFailedNotice` in `cloudBriefsCopy.js` reads "Couldn't fetch origin/<base> — cut from the last fetched copy.", shown by `cloudBriefsPanel.js` as an info toast after the started one, as New Workspace does. The dialog's closed "from" button now shows the base's local or origin icon. This overturns `frame-cloud-brief-start`'s "Frame does not fetch" (plan decision "The base is origin's, fetched at start"). Tests in `test/cloudStart.test.js` (70 pass) and `test/cloudBriefsCopy.test.js` (119 pass). Neither the button nor the toast was checked in the running app.

_Captured: 2026-11-19 · 7 file change(s)_

---
