## T01 — Read `off` and the PR facts in the core

Added `off` to `MERGE_TRACKING`, read the five PR fields in `normalizePart` with D10's guards (`prUrl` through `isHttpUrl`, non-string folded first) and carried them in `partRow`. Added `mergeTrackingOf` (needs_github → off → ready, tolerant of a non-array) and `buildSettingsWebUrl` to `src/main/cloud/cloudBriefs.js` and exported both; the service's local `mergeTrackingOf` stays until T02. `test/cloudBriefs.test.js` gains the PR-field, `mergeTrackingOf` and Settings-URL cases, and the `addPartCounts` row assertion now includes the five fields.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T02 — Use them in main

Swapped `list` to `core.mergeTrackingOf` and deleted the service's own copy. Split the auth lookup into `webInputs` so `webUrl` and the new `settingsWebUrl` share it, and made `openOnWeb(folderPath, target)` open Settings for `'settings'`, the brief for a number, the project for `undefined`/`null`, and nothing otherwise; the handler, the header and the `CLOUD_BRIEFS_OPEN_ON_WEB` comment follow. Files: `src/main/cloud/cloudBriefsService.js`, `src/shared/ipcChannels.js`; no service tests exist, as before.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T03 — The row order in the copy

Gave `partStatus`/`partStatusOf` a `tracking` (default `'ready'`) and Flow 1's order in `src/renderer/cloudBriefsCopy.js`: the lane check now runs before the PR rows (new `prStatus`, `REVIEW_LABELS`, `prLabel`), the record's own state after them, then a new `completionSha` → "Implemented" row; PR rows carry `pr: { number, url, kind, base }` (url and base null when absent) and the record's Run. Ported the labels from FrameCloud's `partRow` source, and exported `prLabel`/`REVIEW_LABELS` (not named in the plan) so the panel can split "PR #N" from "· state" in T04. Twelve new cases in `test/cloudBriefsCopy.test.js`; every existing row assertion is unchanged.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T04 — Draw the PR rows in the panel

Passed `tracking: brief.mergeTracking` from `partFacts`, and drew a PR row's words through new `renderPartStatusText`/`renderPrLink` in `src/renderer/cloudBriefsPanel.js`: "PR #N" then "· state" for an open PR (split on the `prLabel` prefix), the label then "PR #N" off-target, the number as an `open-pr` button with `data-ref` and escaped `data-url`, or plain text without an http(s) URL. Handled `open-pr` in `onPartAction` (`isWebUrl` → `shell.openExternal`), and added the `tone-review` dot/label (`--info`, as the web's info tone) and `.cloud-briefs-prow-pr` to `cloud-briefs.css`. Panel untested per D6.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T05 — Summary and attention in the copy

Gave `partsSummary` a `tracking` (default `'ready'`) with D13's pieces in `src/renderer/cloudBriefsCopy.js`, counting "changes requested" by `pr.kind === 'changes'` and "in progress" as `active` plus attention without `pr`; under not-ready the head counts `implemented` + `done` tones. Added `partAttention(entries, target)` with the web's two K2 sentences (falling back to "another branch" when an off-target PR has no base, as the web does) and " · N more". In `test/cloudBriefsCopy.test.js`, the old `[implemented, done]` → "1 of 2 merged" assertion now expects "· 1 implemented" (the drift D13 names), and nine cases cover both modes and the attention line over real rows.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T06 — Summary and attention on the card

Passed `brief.mergeTracking` to both `partsSummary` calls (`renderCardParts` and the Parts tab in `renderTab`) in `src/renderer/cloudBriefsPanel.js`, computing the card's statuses once so the summary and the new attention line share them. Drew `partAttention`'s line only on Active cards, inside `renderCardParts` so `renderPartSlots` keeps it in step with the rows, and styled `.cloud-briefs-prows-attention` (warning ink, filled dot) in `cloud-briefs.css`. Panel untested per D6.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T07 — The `part-merged` sentence

Ported the web's `part-merged` case into `eventAction` in `src/renderer/cloudBriefsCopy.js` (the sha shortened to 7 characters inline, as the web's `shortSha` does) and made `isObserved` true for it, so the History tab reads it as a whole sentence with no actor; this overturns frame-cloud-brief-manual-done D8, which the `isObserved` comment and the header now say. The plan's test lines 721–723 had moved to 913–915; replaced them there with the full sentence, " through PR #N", the no-title/target/sha cases, a non-number `pr` and an actorless event.

_Captured: 2026-11-15 · 2 file change(s)_

---
## T08 — The board under `off`

Replaced `MERGE_TRACKING_NOTICE` with `TRACKING_WARNINGS`/`trackingWarning` in `src/renderer/cloudBriefsCopy.js`, copied from FrameCloud's `project-header.tsx` (an own-key lookup, null for `ready` and anything unknown). In `src/renderer/cloudBriefsPanel.js`, `renderTrackingNotice` draws the box's title and description for `needs_github` and `off`, "Open on web" became `open-settings-web` → `openOnWeb('settings')`, Ready for Done needs `mergeTracking === 'ready'`, and the header names the tracking work; `cloud-briefs.css` adds the title style. Move to Done under `off` needed no code: `needsReason` already keys on `ready` (D20). Replaced the old notice assertion in `test/cloudBriefsCopy.test.js` (no longer at line 613) with both warnings and the null cases.

_Captured: 2026-11-15 · 4 file change(s)_

---
