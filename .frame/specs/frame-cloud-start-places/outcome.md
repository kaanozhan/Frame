# Outcome — Start Work in Three Places

## T01 — The begun store learns the checkout

Added `place: 'checkout'` and `title` to the begun entry (kept only together and never with a `serverKey`), `begunPlace` on a live checkout part in `withBegunBranches`, and the pure `checkoutBusy` and `checkoutBlock` helpers; an untitled checkout entry is named by its ref, and a detached HEAD (empty current branch) is never busy. Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-25T11:44:44.166Z · 2 file change(s)_

---

## T02 — Bases per place and the view

Gave `pickBase` a `prefer: 'local'` option, added `placeBases(target, targetOn)` and made `prepareView` return `placeBases`, `checkout` (busy without a branch and a non-positive count read as none) and `workspaceFolder`; without `targetOn` every place's base is null, so the service must pass it (T04). Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-25T11:45:34.068Z · 2 file change(s)_

---

## T03 — The checkout path of handleStartRequest

Added `place` to `handleStartRequest` with the checkout path: the lock from `deps.checkoutState()` first, the local-first base, `createBranch(…, { checkout: true })`, no workspace, the spec under `deps.checkoutPath`, and `place: 'checkout'` plus the title in the begun record; every answer names its place and a checkout answer carries `checkout: { from }`. Two choices the plan left open: the place/serverKey mismatch is refused before the brief is read, and a missing `checkoutState` dep refuses with `other`. Files: `src/main/cloud/cloudStart.js`, `test/cloudStart.test.js`.

_Captured: 2026-11-25T11:47:17.719Z · 2 file change(s)_

---

## T04 — The service wires the checkout

Wired the checkout into `cloudStartService`: `checkoutState` (current branch, change count, busy via `core.checkoutBusy` and a project-folder `finishedIn`), `prepare` passing `targetOn`, the checkout with a `~`-short path and the workspace folder, and `start` passing `place`, `checkoutState`, `checkoutPath` and the `checkout` flag to `git.createBranch`. A git status failure fails `prepare` as `other`, like any other unreadable folder state, and a record the folder no longer holds keeps the checkout locked. Files: `src/main/cloud/cloudStartService.js`.

_Captured: 2026-11-25T11:48:26.177Z · 1 file change(s)_

---

## T05 — The three places' words

Added the three places' words and rules to `cloudBriefsCopy.js` — step labels, card titles/meta/facts, `checkoutLock`, `serverCardState`, the server states, the branch section's label/base note/outcome line, `startPlaceLabel`, the `checkoutDirty`/`checkoutBusy` sentences, the checkout `startedNotice`, `partStatus`'s `setup` and the checkout row label — and rewrote the dialog description and `beginHint` without a workspace. Diverged from the plan's T05 step: the Location radio words are not retired yet, because the dialog still uses them until T09 (D21's own rule); T09 removes them. Files: `src/renderer/cloudBriefsCopy.js`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-25T11:51:14.434Z · 2 file change(s)_

---

## T06 — serverConnect.open({ onClose })

Gave `serverConnect.open` an `onClose({ handoff })` listener, called once on the next close and kept by an `open` without one, with `handoff: true` from `openServerTerminal` and `openSetupTerminal`. Files: `src/renderer/serverConnect.js`.

_Captured: 2026-11-25T11:51:37.064Z · 1 file change(s)_

---

## T07 — The dialog's two steps

Split `cloudStartDialog.js` into step 1 (every part, Orchestrate disabled, Next) and step 2 (the picked part with Change, the branch row, Back/Cancel and Start), with Begin opening on step 2 and the branch name kept in `branchText` across steps; added the step counter and picked-line styles and removed the now-unused `.cloud-briefs-start-part`. Step 2 keeps the Location radios until T08. Files: `src/renderer/cloudStartDialog.js`, `src/renderer/styles/components/cloud-briefs.css`.

_Captured: 2026-11-25T11:53:21.782Z · 2 file change(s)_

---

## T08 — The three place cards

Replaced the Location radios with the three place cards (checkout lock, server states, Server select, Connect / Add a server… through `serverConnect.open({ onClose })` with Start Work hidden via `style.display` because the backdrop's `display: flex` beats `hidden`), per-place bases from `view.placeBases`, and a live server card that redraws only when its shown state changes. Diverged from the plan's sequencing: `place` and `serverKey` went into the request here rather than in T09, so no commit starts a checkout pick as a workspace. Files: `src/renderer/cloudStartDialog.js`, `src/renderer/styles/components/cloud-briefs.css`.

_Captured: 2026-11-25T11:56:19.555Z · 2 file change(s)_

---

## T09 — The branch section and Start

Made the branch section depend on the picked place — a pending line before, then the place-named label, the row and `copy.placeBranchLine`'s base note and outcome — and named the place on Start; removed the Workspace line, the Location words, their tests and the Location row styles, and added `.cloud-briefs-label-sub`. Beyond D21's list, `startSubmitLabel` was retired too, since `startPlaceLabel` replaced its only use. Files: `src/renderer/cloudStartDialog.js`, `src/renderer/cloudBriefsCopy.js`, `src/renderer/styles/components/cloud-briefs.css`, `test/cloudBriefsCopy.test.js`.

_Captured: 2026-11-25T11:57:52.568Z · 4 file change(s)_

---

## T10 — The card rows and the checkout lane

Added the panel's `settingUp` state (set around `selectBegunWorkspace`, passed to `copy.partStatus`), the plain-text 'project checkout · <branch>' row label for `begunPlace`, and the checkout path of `openBeginLane` (select the project checkout, `REFRESH_GIT_STATUS`, then the lane with no setup), with a non-clickable chip style for the label. Files: `src/renderer/cloudBriefsPanel.js`, `src/renderer/styles/components/cloud-briefs.css`.

_Captured: 2026-11-25T11:58:43.593Z · 2 file change(s)_

---


## T11 — Walk both specs

The developer walked both specs in one walk, as C8 set out: this spec's S1–S9 and `frame-cloud-start-on-server`'s S1–S11 (its T11). They reported both working on 2026-11-26. No code changed. The report did not go through the steps one by one, so it does not say which server states, server versions or project modes were tried. The agent did not drive the walk, because the cloud sign-in and the Frame Server connection are the developer's.

_Captured: 2026-11-26 · 0 file change(s)_

---
