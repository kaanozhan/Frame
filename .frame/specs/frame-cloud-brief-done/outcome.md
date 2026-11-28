# Outcome — Frame Cloud brief done

## T01 — Read the Done fields in cloudBriefs.js

Added the six Done fields to `normalizePart` (`branch`, `completionSha`, `mergedAt`, `mergedBase`, `droppedAt`, `dropReason`, each string or null) and carried them through `partRow`; `normalizeBrief` reads `mergeTracking` (`ready` unless the server says `needs_github`), so the detail has it too. Added `recordBranch` and `recordCompletion`, each a POST that returns the normalized detail and lets the server's refusals (`PART_DROPPED`, `PART_MERGED`, …) surface as CloudErrors for the caller to read. `mergeSha`, `mergeEvidence` and `doneAt` stay unread (D17), and the module header and `addPartCounts`' comment now say so. Files: `src/main/cloud/cloudBriefs.js`, `test/cloudBriefs.test.js`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T02 — Make part rows read the cloud in cloudBriefsCopy.js

Added `countsAsMerged(part, target)` and gave `partStatus` a `target` and Flow 3's order: dropped ("Dropped · <reason>", or "Dropped" with no reason) → merged ("Merged into <target>", tone `done`, no Run) → the local record, where a live lane still wins and a finished spec or task now reads "Implemented" (tone `implemented`) → the cloud `branch` unless `branchGone` → `begunBranch` → Not started with Begin. `partsSummary` now reads "<merged> of <live> merged", keeps the in-progress and elsewhere pieces, and ends with "· N dropped". `countsAsMerged` also refuses an empty target, so a brief without one never shows a merge; the panel passes no `target` until T04, so merged rows appear only from then. Files: `src/renderer/cloudBriefsCopy.js`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T03 — Add branchGone to withBegunBranches

`withBegunBranches` now sets `branchGone` on each part: true only when this machine's begun entry is dropped for a missing local branch and that branch is also the part's cloud `branch`. A cloud branch with no entry here (another machine's), or one that differs from this machine's older entry (another machine's re-Begin), is never gone, and without a local branch list nothing is. Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T04 — Wire the new rows into cloudBriefsPanel.js and add the tones

`partFacts(part, brief)` now passes `brief.targetBranch` to `partStatus`, and `renderPartRow` takes the brief instead of its number, so the card, the Parts tab and the live redraw of the open detail all read merges against the brief's target. `runPart` still calls `partFacts` without a brief: it only asks a rendered Run button for its command, and merged or dropped rows never render one. Added `tone-implemented` (a success-colored ring and status) and `tone-dropped` (muted dot and status, struck-through title) to `cloud-briefs.css`; merged keeps the existing `done` look (D16). Files: `src/renderer/cloudBriefsPanel.js`, `src/renderer/styles/components/cloud-briefs.css`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T05 — Add the GitHub-not-connected notice

`cloudBriefsService.list` now returns `mergeTracking`: `needs_github` when any listed brief says so, else `ready` (also with no briefs), and the `CLOUD_BRIEFS_LIST` channel comment names it. The board shows a non-dismissible `cloud-briefs-tracking` line above the columns while the Active column is non-empty and tracking is `needs_github`. Its button reuses the board's existing `open-web` action (`CLOUD_BRIEFS_OPEN_ON_WEB` with no number) and appears only when the web URL can be built. Diverged from D2's wording: `OPEN_ON_WEB_LABEL` is "Open on web", matching the two buttons already in this view, not "Open on the web". Files: `src/main/cloud/cloudBriefsService.js`, `src/shared/ipcChannels.js`, `src/renderer/cloudBriefsCopy.js`, `src/renderer/cloudBriefsPanel.js`, `src/renderer/styles/components/cloud-briefs.css`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-04 · 6 file change(s)_

---

## T06 — Make Begin record the branch

The begun entry now keeps an optional `baseSha` (only a 40-char lowercase hex id; anything else is dropped and older entries read unchanged). `handleStartRequest` reads `deps.headSha()` right after `createBranch` (a throw or a non-id counts as none), passes it to `recordBegun`, and once the part is recorded fires `deps.recordBranch({ id, partId, branch, baseSha })` through an async wrapper, so a synchronous throw is swallowed too; it is skipped without a `baseSha` or after a partial failure. `cloudStartService` wires `headSha` to `git.getHeadSha` and `recordBranch` to `sendBranch`, which goes through `cloudProjectsService.call` and logs a failure. It also exports `begunEntry(projectId, number, partId)` for the reporter. Files: `src/main/cloud/cloudStart.js`, `src/main/cloud/cloudStartService.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-04 · 3 file change(s)_

---

## T07 — Add the pure reporter core cloudDone.js

Added `src/main/cloud/cloudDone.js`. `plan` takes Active briefs only (status `active` with `startedAt`) and live parts (a `recordRef`, not dropped, not counted as merged). It sends a branch only while the cloud has none and this machine's entry has a 40-hex `baseSha`. For a completion it reads the cloud's `branch` when this folder has it, else the begun branch when this folder has it, else nothing. Also added `isFinished`, which mirrors `collectSpecTasks`/`derivePhase` for specs and checks a task's own row, and `completionDue` (D12), which refuses a non-id tip. `countsAsMerged` is defined here rather than imported from the renderer copy; a test asserts both give the same answer on every case. A begun branch is sent even when this folder has since lost it, since D10 does not ask for the branch to exist locally. Files: `src/main/cloud/cloudDone.js`, `test/cloudDone.test.js`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T08 — Add the git read helpers to gitBranchesManager.js

Added `branchTipSha` (`rev-parse --verify --quiet refs/heads/<name>^{commit}`), `showFileAt` (`git show <ref>:./<relPath>`), `commitExists` (`cat-file -e <sha>^{commit}`) and `isAncestor` (`merge-base --is-ancestor`), all through `execGitArgs`. Each returns null or false on any failure and refuses an argument that starts with `-`. Diverged from the plan by giving `execGitArgs` an optional `options` argument: `showFileAt` needs a 32 MB `maxBuffer`, because this repo's `tasks.json` is already ~0.7 MB against execFile's 1 MB default. Smoke-tested against this repo (tip, missing branch, file at tip, unknown commit, ancestry both ways); not unit-tested, per D7. Files: `src/main/gitBranchesManager.js`.

_Captured: 2026-11-04 · 1 file change(s)_

---

## T09 — Add the reporter shell cloudDoneService.js

Added `src/main/cloud/cloudDoneService.js`: `report` is single-flight per folder, skips git when no brief is Active, resolves each branch tip once, checks D12 before reading (`commitExists`/`isAncestor` only when a different SHA is stored), and reads `tasks.json` at the tip with `git show` (path from `frameStore.resolvePath`), memoized by folder, tip, shape and ref. Sends go through `cloudProjectsService.call`; final refusals log as info, other failures as warnings, and `CLOUD_BRIEFS_CHANGED { folderPath }` is pushed only when a send lands. Added the channel to `ipcChannels.js` and `init(window)` to `index.js`, and smoke-tested the shell in a throwaway repo with stubbed cloud calls across seven cases (completion from the tip while another branch is checked out, same tip, a new commit, an unknown stored SHA, a refusal, single-flight, a Done brief). Files: `src/main/cloud/cloudDoneService.js`, `src/shared/ipcChannels.js`, `src/main/index.js`.

Followup: a project with `gitSharing: local` never commits `tasks.json`, so `git show` at a tip finds no record and its parts never send a completion; it needs its own decision.

_Captured: 2026-11-04 · 3 file change(s)_

---

## T10 — Start a report after each read, and reload on CLOUD_BRIEFS_CHANGED

`cloudBriefsService.list` and `get` now hand their briefs (after `withBegunBranches`) to `cloudDoneService.report` through `reportAfter`, which defers with `setImmediate` so the read answers first (D8). `cloudBriefsPanel.js` listens for `CLOUD_BRIEFS_CHANGED` and, while the panel is visible and the push names the open folder, reloads the board and any open brief detail. A push that follows a detail read reloads whichever brief is open, not one matched by number, because the payload carries only the folder. Files: `src/main/cloud/cloudBriefsService.js`, `src/renderer/cloudBriefsPanel.js`.

_Captured: 2026-11-04 · 2 file change(s)_

---

## T11 — Walk it against a local FrameCloud server in a project GitHub can see

The developer walked it against a local FrameCloud server (`main`, which carries brief-done as #25) in a new GitHub-connected repository, `testing-todo-app`, and reported every step working; no code changed, and the agent did not drive it because sign-in, the GitHub App and the push are the developer's. Done arrived late after a direct merge, on the web and in Frame at the same moment, because the server asks GitHub only inside a read, at most once a minute per project (`MERGE_CHECK_INTERVAL_MS`), and nothing reads after a push. That finding led to the 2026-11-07 direction on the "Active ve Done Akışı" page (https://claude.ai/artifact/Upc2JqXyPWMLyeqgvKUKUQ): merge, PR and review stay as part states inside Active, and Done becomes a person's move that asks for a reason when parts are missing, so this walk's "the brief moves to Done" step describes behaviour that is going away.

Followup: phase 1 of that page, moving a brief to Done by hand on the web board and in Frame's Briefs view, needs a FrameCloud spec and a Frame companion spec.

_Captured: 2026-11-07 · 0 file change(s)_

---
