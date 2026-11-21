# Outcome — Frame Cloud brief shape

## T01 — Read shaped briefs in cloudBriefs.js

Added `shapedAt` to `normalizeBrief`, swapped `why` for `definition` (`''` when absent) in `normalizePart`, and added `shapeBrief` (POST `brief.shape`, returns `normalizeBriefDetail`) in `src/main/cloud/cloudBriefs.js`. Tests in `test/cloudBriefs.test.js` cover normalizing, the wire call and an `ALREADY_SHAPED` refusal. The panel still reads `part.why` until T02 and draws nothing in the meantime.

_Captured: 2026-09-24 · 2 file change(s)_

---

## T02 — Show shaped briefs in the Parts tab

Added the `shaped` event sentence (reads `data.count`, as FrameCloud writes it), `shapedLine` and `PART_DEFINITION_LABEL` to `src/renderer/cloudBriefsCopy.js`. The Parts tab in `src/renderer/cloudBriefsPanel.js` now shows "Shaped <date>" and each non-empty definition in a collapsed, escaped, pre-wrapped `<details>`, and `why` is dropped. Styles are in `cloud-briefs.css` and tests in `test/cloudBriefsCopy.test.js`.

_Captured: 2026-09-24 · 4 file change(s)_

---

## T03 — The pure core of Shape (cloudShape.js)

Exported `briefData`, `commentLines`, `fence` and `shellQuote` from `cloudDiscussions.js` and wrote the pure `src/main/cloud/cloudShape.js`: the store, the prompt-file helpers, `validateShapeInput` (which names the field and the part's index), `buildShapePrompt`, `shapeThrough`, `handleShapeRequest` and `replyMessage`. The request handler leaves the kind and `shapedAt` checks to the server, whose refusals come back as `notWork` / `alreadyClosed` / `alreadyShaped` / `notFound`. `test/cloudShape.test.js` covers each branch, including exactly one `brief.shape` with the parts in order.

_Captured: 2026-09-24 · 3 file change(s)_

---

## T04 — The shape-brief command

Wrote the self-contained `src/templates/bin/shape-brief.js` (`parseArgs`, `requestFor`, `run`, `WAIT_MS`). It reads the parts as a JSON array on stdin and uses `record-discussion.js`'s bus protocol and both timeout messages, reworded for shaping. `test/shapeBrief.test.js` covers the argument errors, malformed JSON, an empty array, each bad field, a reply, a refusal, both timeouts and a spawned run over stdin.

_Captured: 2026-09-24 · 2 file change(s)_

---

## T05 — The Shape service and its wiring

Wrote `src/main/cloud/cloudShapeService.js` as a sibling of `cloudDiscussionsService.js`: the `cloud-shapes/` store, the staged command, the prompt files, `shape()` with `notShapeable` for anything but open unshaped work, and the bus watcher that pushes `CLOUD_BRIEF_SHAPED`. Added `CLOUD_BRIEF_SHAPE` and `CLOUD_BRIEF_SHAPED` to `src/shared/ipcChannels.js` in their own commented block, and wired `setupIPC` and `init` in `src/main/index.js`. As the plan's test posture says, the Electron shell has no unit tests.

_Captured: 2026-09-24 · 3 file change(s)_

---

## T06 — Give brief lanes a purpose

`getBriefLaneInfo` (`src/renderer/agentDispatch.js`) now returns `purpose`, defaulting to `'discuss'`. `assignmentIcon` (`src/renderer/laneStatus.js`) shows lucide `Shapes` for a shape lane, and `discuss()` in `src/renderer/cloudBriefsPanel.js` dispatches with `purpose: 'discuss'`. `setAssignment` stores the assignment object whole, so no other code path needed a change.

_Captured: 2026-09-24 · 3 file change(s)_

---

## T07 — The Shape words in cloudBriefsCopy

Added `workStage`, `laneLabel`, `SHAPE_LABEL`, `SHAPE_HINT`, `GO_TO_SHAPING_LABEL` and `shapeErrorMessage` to `src/renderer/cloudBriefsCopy.js`, and named shaping as a write in its header. `laneLabel` builds on `discussingIn`, which stays exported. `test/cloudBriefsCopy.test.js` covers each stage, a lane with no purpose, and every error sentence.

_Captured: 2026-09-24 · 2 file change(s)_

---

## T08 — Shape in the Briefs view

Added Shape to `src/renderer/cloudBriefsPanel.js`. An open lane of either purpose renders first (a `laneLabel` link on the card, Go to discussion or Go to shaping in the detail). Open unshaped work gets a primary Shape button, and `discuss()` and `shape()` share one `startLane()` behind the renamed `starting` guard. `CLOUD_BRIEF_SHAPED` reloads the board and the open detail through the shared `onBriefWritten`. The detail's lane action was renamed from `go-to-discussion` to `go-to-brief-lane`.

_Captured: 2026-09-24 · 1 file change(s)_

---

## T10 — Notice with one-click open when a Shape lands

`CLOUD_BRIEF_SHAPED` now carries `count` (`cloudShapeService.js`, `ipcChannels.js`). For the open folder, the new `onBriefShaped` in `cloudBriefsPanel.js` shows a `notify.success` toast ("Brief #N was shaped into K parts and is ready to run.", from `cloudBriefsCopy.shapedNotice`) wherever the user is, and its Open brief button runs `openBrief(number)`. `notify.js` gained an optional `{ action: { label, onClick } }`: one button after the message, which dismisses the toast and runs `onClick`, and it keeps the toast on screen for 6 s (styles in `panels.css`). This diverges from the task as first written, which put the notice on the Briefs board: the user wanted to see it from the terminal, so the board-banner version (76318dc) was replaced and the board notice is a plain string again.

_Captured: 2026-09-24 · 7 file change(s)_

---

## T11 — Card shows what a shaped brief was shaped into

Added `partSummary` and `addPartCounts` to `cloudBriefs.js`. `addPartCounts` reads `brief.getByNumber` only for open, shaped work and gives `null` for a failed read or any other brief, the way `addDiscussionCounts` reads events. `cloudBriefsService.list` now applies it after the discussion counts. `cloudBriefsCopy.partCountLabel` reads "1 spec" / "2 specs · 1 task", and the card draws it in the existing records line style. This overturns the plan's silent decision "a shaped brief gets no new card line": once the Shape button goes, the card otherwise gives no sign that the brief was shaped.

_Captured: 2026-09-24 · 6 file change(s)_

---

## T09 — Walk it in Frame

The user walked the plan's cases in the dev build against FrameCloud's `feat/brief-shape` (`FRAME_CLOUD_URL=http://localhost:3777 npm start`), and they pass. The walk changed the prompt twice, in `f5e7dc0` and `ab1fa6d`. First, Shape now defaults to one part (a small job is one task, anything bigger is one spec, and it splits only when the work is too broad for one spec) and proposes without questioning the user first. Each definition is written in Frame's own format: `spec.md` sections for a spec part, `tasks.json` fields for a task part. Detail gaps go under Open Questions or Notes instead of being asked about. This overturns spec.md's "ask what the split depends on" step and its why/what/… headings. Second, a shaped session ends on "ready to run" instead of offering to open a spec. The walk also added T10 (the shaped toast) and T11 (part counts on the card).

_Captured: 2026-09-24 · 0 file change(s)_

---

