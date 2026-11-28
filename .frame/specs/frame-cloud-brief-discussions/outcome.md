# Outcome — Frame Cloud brief discussions

## T01 — recordDiscussion call and the provider limit

Added `recordDiscussion` (POST `brief.recordDiscussion`, `url`/`provider` sent only when present) and `LIMITS.provider = 40` to `src/main/cloud/cloudBriefs.js`, with four cases in `test/cloudBriefs.test.js`. Checked the input shape against FrameCloud's `recordDiscussionInputSchema`, which returns the brief. `classifyLinkError` folds `NOT_A_PROPOSAL`/`ALREADY_CLOSED` into `badRequest`, so T02 must read the server code from `err.message` to give the user the real reason.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T02 — The pure discussions core

Wrote `src/main/cloud/cloudDiscussions.js` (ids, immutable store with 90-day prune, `validateRecordInput`, `buildDiscussPrompt`, `handleRecordRequest`, `replyMessage`) with 19 cases in `test/cloudDiscussions.test.js`, and exported `isHttpUrl` from `cloudBriefs.js`. Diverged from plan: server refusals are caught inside the function passed to `call()` and returned as values, because `call()` classifies them all as `badRequest`; the command path is single-quoted rather than double-quoted. Followup: the heredoc command assumes a POSIX shell, so a Discuss lane on a Windows PowerShell terminal would need another form.

_Captured: 2026-09-21 · 3 file change(s)_

---

## T03 — The record-discussion command

Wrote `src/templates/bin/record-discussion.js` (pure `parseArgs`/`requestFor`, then `run()`: atomic request in `bus/` beside `__dirname`, a 30 s poll for `bus/replies/<same>.json`, the printed reply, exit 0/1) with 10 cases in `test/recordDiscussion.test.js`, including the timeout and a spawned copy reading stdin. Added beyond the plan: on timeout the command withdraws its request. It reports "Frame did not answer" only when that withdrawal succeeds, and otherwise says the record may still land. That relies on T04's watcher claiming each request by renaming it.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T04 — The discussions service, channels and wiring

Wrote `src/main/cloud/cloudDiscussionsService.js` (userData folder, pruned `discussions.json`, the staged command, a `safeWatch` bus with rename-to-claim, the `CLOUD_BRIEF_DISCUSS` handler, the recorded push), added both channels to `src/shared/ipcChannels.js` and wired `init`/`setupIPC` in `src/main/index.js`. Diverged from plan: at start, requests older than the command's 30 s wait (+5 s) are dropped unrecorded rather than drained, because the command already told the agent they failed. Only requests still inside that window are handled. The service reads `WAIT_MS` from the command template. A stubbed-electron smoke run covered discuss → record → refusal → unknown id → push end to end.

_Captured: 2026-09-21 · 3 file change(s)_

---

## T05 — Brief lanes in agentDispatch

Added `getBriefLaneInfo` (current project's lanes only, since brief numbers are per project), `briefStatusDotHtml`, `onBriefLaneActivity` and `enterBriefLane` to `src/renderer/agentDispatch.js`, fed by the existing `laneStatus.onChange` and `TERMINAL_DESTROYED` hooks. `enterBriefLane` goes beyond the plan's list and gives the panel its route to `multiTerminalUI.enterLane`. The brief change gate is cleared when a terminal is destroyed, unlike the task gate. No unit test (DOM/lane code has no harness); T08 walks it.

_Captured: 2026-09-21 · 1 file change(s)_

---

## T06 — Discussion copy

Added the `discussion-recorded` sentence, `discussionRecords` (newest first, http(s)-only url, blank summaries dropped), the Discuss / Go to discussion / Discussions / Read the write-up labels and `discussErrorMessage` to `src/renderer/cloudBriefsCopy.js`, with five cases in `test/cloudBriefsCopy.test.js`. Diverged from plan: `discussionRecords(events, meId)` also takes `meId` so each record says who recorded it, as the spec and the web's section do.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T07 — Discuss in the Briefs panel

Wired Discuss / Go to discussion into the detail header, lane dots onto cards, the Discussions list under the description, and a reload on `CLOUD_BRIEF_DISCUSSION_RECORDED` in `src/renderer/cloudBriefsPanel.js`, with styles in `cloud-briefs.css`. Lane activity patches the dot and button slots in place instead of re-rendering the drawer. Go to discussion also shows on a brief that is no longer an open proposal while its lane is open, a small widening of the spec's rule.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T09 — Discuss prompt: fate-deciding questions, write-up at wrap-up

Reworked `buildDiscussPrompt` in `src/main/cloud/cloudDiscussions.js` after the T08 walk. Only questions that decide the proposal's fate stay open, and details are left as "can wait". The Claude Code prompt now asks at wrap-up whether to publish a claude.ai artifact write-up, where before it said "you may offer", which the agent never acted on. Codex still gets no document offer (the user chose this). Two cases were added in `test/cloudDiscussions.test.js`.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T10 — Brief lane chip opens the brief

A `brief` lane chip now shows a discussion icon (`laneStatus.js`) and opens the Briefs panel on that brief (`terminalsView.js` → new `cloudBriefsPanel.openBrief`) instead of routing as a task. `openBrief` relies on `showPanel` mounting synchronously and consumes a pending number in `show()`. `terminalsView.js` and `laneStatus.js` were added to scope by the plan amendment.

_Captured: 2026-09-21 · 3 file change(s)_

---

## T11 — Brief cards: Discuss, record count, live lane

Cards now show a direct Discuss, "N discussions recorded" and a clickable "Discussing in <lane>" with the dot. The count comes from `addDiscussionCounts` in `cloudBriefs.js`, one `brief.events` per open proposal, attached in `cloudBriefsService.list`; the labels are in `cloudBriefsCopy.js`. The card was split into a container with sibling controls (`cloudBriefsPanel.js`, `cloud-briefs.css`), overturning the plan's "dot only" card decision while keeping its no-nesting reason. A recorded push now reloads the board as well as the open brief. Followup: a board with many open proposals makes one events request each; a `discussionCount` on FrameCloud's `brief.list` would make it one.

_Captured: 2026-09-21 · 7 file change(s)_

---

## T08 — Walk it in Frame

The user walked the feature in Frame on a connected folder. The first walk found four gaps, which became T09–T11. The second walk passed. Afterwards the user asked why a published artifact is missing from Links. It is stored as the record's `url` and shown under Discussions as "Read the write-up", because the spec allows no `brief.addAttachment` write. Transforming the brief to Work does not copy it either. Followup: decide whether a write-up link should also become a brief attachment. That would take a second write, which this spec ruled out.

_Captured: 2026-09-21 · 0 file change(s)_

---

## T12 — Move to Work through brief.decide

Added `decideBrief` and `decideThrough` (refusals returned as reasons, unknown priority refused before sending) to `src/main/cloud/cloudBriefs.js`, `decide(folderPath, number, priority)` to `cloudBriefsService.js`, and `CLOUD_BRIEF_DECIDE` to `ipcChannels.js`, with three test cases. This is the spec's second write, allowed by the proposal-states amendment. The brief id is still resolved in main by number.

_Captured: 2026-09-21 · 4 file change(s)_

---

## T13 — Discussion facts and the proposal stage

Added `discussionFacts` (records, plus others' comments after the latest one) to `cloudBriefs.js`. `addDiscussionCounts` now also sets `newCommentCount`, with the service passing `meId`. `cloudBriefsCopy.js` gained `proposalStage`, `newCommentsLabel`, `newCommentIds`, the Move to Work / Re-discuss words and `decideErrorMessage`, with tests. The viewer's own comments never count as new. New comments are a fact layered on the `decide` stage, not a stage of their own.

_Captured: 2026-09-21 · 5 file change(s)_

---

## T14 — Prompt carries comments; re-discuss opens on the new ones

`buildDiscussPrompt` now carries the brief's comments inside the data fence, oldest first, marking others' comments after the latest record as NEW. When any exist it opens on them instead of the restate opener, and `cloudDiscussionsService` passes `meId`; two test cases were added. "New" follows the same rule as the card's chip, so Re-discuss is simply a Discuss that finds new comments.

_Captured: 2026-09-21 · 3 file change(s)_

---

## T15 — Card and detail follow the proposal states

The card and the detail header now follow `proposalStage`: Discuss → Discussing → Move to Work + Discuss, with an accent "N new comments" chip that opens Comments. There, new comments are marked under a count strip with Re-discuss. Move to Work opens a priority dialog (Medium default) that calls `CLOUD_BRIEF_DECIDE` and reloads board and detail. Everything is in `cloudBriefsPanel.js` and `cloud-briefs.css`. Re-discuss is a plain Discuss with its own label, since T14's prompt already opens on the new comments. The dialog reuses the New brief form's styles rather than the task delete modal.

_Captured: 2026-09-21 · 2 file change(s)_

---

## T17 — Write-up links land in Links

A recorded write-up url is now also added to the brief's Links (`addAttachment`, titled "Discussion write-up (<date>)") after `recordDiscussion`. A failed attachment keeps the record, and the command says the link did not reach Links. Discussions shows "Write-up added to Links" when the brief's attachments hold the record's url, and older records keep their link. This is the third write the amendment allows, reusing the create spec's `addAttachment`.

_Captured: 2026-09-21 · 5 file change(s)_

---

## T18 — The discuss prompt reaches the lane through a file

Discuss now stages its prompt at `<userData>/cloud-discussions/prompts/<id>.md` and sends the lane a single "Read '<path>' and follow it exactly" line. It had been typing the whole prompt, which Claude Code's paste handling cut off, record command included. Prompt files of pruned discussions are removed on load. Pure helpers in `cloudDiscussions.js` have tests, and a smoke run confirmed an 8.6 KB prompt arrives intact. Rule for future work: never type a long prompt into a lane; stage it and send one line, as `specManager` and `orchestrationManager` do.

_Captured: 2026-09-21 · 3 file change(s)_

---

## T16 — Walk the proposal states in Frame

The user walked all four proposal states, Move to Work with a priority, write-up links landing in Links (T17) and the file-staged prompt (T18) in Frame, and reported they pass. An earlier attempt in this walk found the cut-off prompt that T18 fixed.

_Captured: 2026-09-21 · 0 file change(s)_

---

