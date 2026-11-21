# Outcome — Frame Cloud milestones

## T01 — Read the whole milestone in the core

Extended `normalizeMilestone` in `src/main/cloud/cloudBriefs.js` to keep `goal`, `targetDate`, `targetBranch`, `startedAt`, `closedAt` and `briefs`, and added `buildMilestoneWebUrl` (`{project url}/milestones/{encoded id}`, null for an empty id or under `buildWebUrl`'s guards). Went one step past D18: `targetDate` must be a real calendar day, not only `YYYY-MM-DD`-shaped, so `2026-02-30` reads as null. Rewrote the `listMilestones` test for the full shape and added cases for an older server, bad counts, bad dates and the URL builder in `test/cloudBriefs.test.js`.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T02 — Serve milestones from main

Added `milestones(folderPath)` to `src/main/cloud/cloudBriefsService.js` (one `milestone.list` through `call`, `NOT_CONNECTED` for an unconnected folder) and registered it on the new `IPC.CLOUD_MILESTONES_LIST` in `src/shared/ipcChannels.js`, placed right after `CLOUD_BRIEFS_OPEN_ON_WEB` as planned. `openOnWeb` now opens `buildMilestoneWebUrl` for a `{ milestoneId: string }` target; the service header and the channel comment say so. No test, per D14 (the service is the Electron shell).

_Captured: 2026-11-15 · 2 file change(s)_

---

## T03 — Port the milestone rules and words

Ported `lib/milestone.ts` and the strip's words from `board-milestone.tsx` into a Milestones section of `src/renderer/cloudBriefsCopy.js`, with tests for every rule in `test/cloudBriefsCopy.test.js`. Diverged from the web on purpose: `countsWithBriefs` filters to the milestone's own briefs itself (the panel passes every shown brief) and returns null without server counts, so D11's name-only case needs no extra checks. Added `endsLine`, `NO_END_DATE_LABEL`, `STARTED_MILESTONE_LABEL` and `milestoneProgressLabel` beyond the plan's list so the panel and Home share one wording; `milestoneRowFacts` shows the end date only while the milestone is open.
Followup: the existing `formatDate` test fails under `TZ=Pacific/Kiritimati` (noon UTC is the next day at UTC+14); unrelated to this spec.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T04 — Draw the started-milestone strip above the columns

`renderBoard` in `src/renderer/cloudBriefsPanel.js` now draws `renderMilestoneStrip` between the tracking box and the columns, from `milestoneSummary` over `countsWithBriefs(started, shownBriefs())`, so held moves count at once. The name is an `open-milestone-web` button when `canOpenWeb`, routed through a small `openMilestoneOnWeb` to `openOnWeb({ milestoneId })`; styles for the strip, name link, Overdue badge and bar are in `cloud-briefs.css`. As planned; checked with a throwaway fake-DOM harness, since the project has no DOM tests.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T05 — Narrow the board to the started milestone

Added `narrowedTo` to `src/renderer/cloudBriefsPanel.js`, toggled by the strip's `aria-pressed` "Show only this milestone" / "All briefs" button and honored only while it names the started milestone. While it does, `renderBoard` filters the columns, Closed and the count with `briefsInMilestone` and shows `NARROWED_EMPTY_LABEL` when nothing is open; `hide()` and a folder change in `onCloudChange` clear it. The tracking box now tests the whole board for an Active brief (D22), and the strip always draws its facts row, so an older server's name-only strip still carries the toggle. Checked with the throwaway harness: narrowing, widening, hide/show, a folder change and the empty state.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T06 — Open Briefs narrowed to a milestone

Added and exported `openMilestone(id)` in `src/renderer/cloudBriefsPanel.js`, guarded like `openBrief`. It narrows at once when the panel is visible; otherwise it goes through `pendingNarrow` and `showPanel('cloudBriefs')`, and `show()` moves `pendingNarrow` into `narrowedTo` before the first load. As planned; the harness confirmed the mounted, visible and stale-milestone paths.

_Captured: 2026-11-15 · 1 file change(s)_

---

## T07 — Badge the started milestone on cards

`renderCards` / `renderCard` in `src/renderer/cloudBriefsPanel.js` now take `{ byId, startedId }`, and a new `renderCardMilestone` draws the started milestone's name as `.cloud-briefs-milestone-badge` (styled in `cloud-briefs.css`), leaving planned and closed names as plain `.cloud-briefs-milestone` text. The badge follows the board's `startedMilestone` pick, not the status alone, so an older server's extra started milestones get no badge.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T08 — Rewrite the detail's Milestone row

`renderMeta` in `src/renderer/cloudBriefsPanel.js` now receives the detail's `canOpenWeb` and draws the Milestone row with a new `renderMilestoneRow`: the name as an `open-milestone-web` button, `milestoneRowFacts`, and Overdue for the started milestone, counted from `shownBriefs()` exactly as the strip counts. `onDetailClick` routes `open-milestone-web`, and `cloud-briefs.css` styles the row. As planned; the harness confirmed the started, done and planned readings.

_Captured: 2026-11-15 · 2 file change(s)_

---

## T09 — Home reads the started milestone

Added the `milestone` source to `src/renderer/home/homeData.js`: `refresh('milestone')` (one `CLOUD_MILESTONES_LIST` read, gated on `cloudBriefsPanel.isAvailable()`), `refreshMilestoneIfStale()` (30 s), `setBoardMilestone(path, milestone)`, a clear-and-read on project change, and `cloudHub` subscriptions keyed on the folder's path, cloud project and availability. Beyond the plan: reads and handoffs share one sequence so a handoff is never overwritten by an older read, and a failed read keeps the last value except on `notConnected` / `unauthorized` / `roleForbidden`. Checked with a throwaway stubbed harness (pull, freshness, push keying, handoff order, project change, failure handling).

_Captured: 2026-11-15 · 1 file change(s)_

---

## T10 — Hand the board's started milestone to Home

`renderBoard` in `src/renderer/cloudBriefsPanel.js` now ends with `handOffMilestone`, passing `homeData.setBoardMilestone` the started milestone with `countsWithBriefs` over `shownBriefs()` (or null), so every draw, the held-move redraws included, keeps Home in step. `holdMoveToDone` calls `homeData.refresh('milestone')` once the move settles if the panel is hidden (D20); `homeData` is required lazily and the handoff is wrapped so Home can never break the board. Harness-checked: the first draw, a held move, a hidden settle and no started milestone.

_Captured: 2026-11-15 · 1 file change(s)_

---

## T11 — Draw Home's milestone tracker

The Agents widget (`src/renderer/home/widgets/agents.js`) reads `['aiTool', 'milestone']` and puts a hidden `.home-milestone` button beside "Welcome to Frame!" in a new `.home-composer-head`, filled from `milestoneSummary` (name, Overdue, end date, bar, "N of M done", chevron) and rebuilt only when the summary changes. A click calls `cloudBriefsPanel.openMilestone(id)`; `mount` and window focus (while connected) call `homeData.refreshMilestoneIfStale()`, and the existing `dispose()` now removes that listener. `home-board.css` styles the wrapping row and the pill (hover, `:focus-visible`, light scheme); the `[hidden]` rule is restated because the pill's `display` would override it.

_Captured: 2026-11-15 · 2 file change(s)_

---
