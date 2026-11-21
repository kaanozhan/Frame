# Tasks — Frame Cloud brief shape

- T01 · In `src/main/cloud/cloudBriefs.js`, add `shapedAt` (string or null) to `normalizeBrief`, replace `why` with `definition` (`''` when absent) in `normalizePart`, add `shapeBrief({ api, token, fetchJson, signal, id, parts })` (POST `brief.shape`, returning `normalizeBriefDetail`), and name the new write in the header comment. Cover the normalizing (including a part with no definition) and the `shapeBrief` procedure and input in `test/cloudBriefs.test.js`.
- T02 · Show shaped briefs in the Parts tab. In `src/renderer/cloudBriefsCopy.js`, add the `shaped` case to `eventAction` ("shaped this brief into N parts", "1 part" for one) and `shapedLine(date)`. In `src/renderer/cloudBriefsPanel.js`, show "Shaped <date>" above the list when `shapedAt` is set, drop `why`, and put each definition in a collapsed, escaped, pre-wrapped `<details>`. Style both in `src/renderer/styles/components/cloud-briefs.css`, and cover the sentence in `test/cloudBriefsCopy.test.js`.
- T03 · Export `briefData`, `commentLines`, `fence` and `shellQuote` from `src/main/cloud/cloudDiscussions.js` with no behavior change. Write the pure `src/main/cloud/cloudShape.js`:
  - `newShapeId`, `addShape`, `getShape` and `pruneShapes` (90 days);
  - `promptFileName`, `promptInstruction` and `stalePromptFiles`;
  - `validateShapeInput`: at least one part; title trimmed, 1–200 characters; shape `spec | task`; type in the five values; definition trimmed, 1–10,000 characters;
  - `buildShapePrompt`: the brief block fenced as data, then read the code and `.frame/specs/` when present, ask what the split depends on, propose parts with the why / what / decisions made / done when / out of scope / open questions headings, write only after the whole set is approved, the `FRAME_PARTS` heredoc command, and "tell the user exactly what it printed";
  - `shapeThrough`, which catches `NOT_WORK`, `ALREADY_CLOSED`, `ALREADY_SHAPED` and `BRIEF_NOT_FOUND` as values;
  - `handleShapeRequest`, which returns `{ ok, folderPath, number, count }`;
  - `replyMessage`.

  Cover each branch in `test/cloudShape.test.js`, including exactly one `brief.shape` sent with the parts in order.
- T04 · Write the self-contained `src/templates/bin/shape-brief.js`:
  - `parseArgs` (`--shape <id>` only);
  - `requestFor({ shapeId, partsText, ts })`, which parses the JSON array and applies the same part checks;
  - `run()`, which publishes `bus/<ts>-<rand>.json` beside its own `__dirname` by tmp + rename, waits up to 30 s for `bus/replies/<same>.json`, prints the reply and exits 0 or 1, or withdraws and prints "Frame did not answer";
  - an exported `WAIT_MS`.

  Cover the argument errors, malformed JSON, an empty array, a bad field, a reply read, and the timeout against a temp bus in `test/shapeBrief.test.js`.
- T05 · Write `src/main/cloud/cloudShapeService.js`, which owns `<userData>/cloud-shapes/`:
  - `shapes.json`, pruned on load, with stale prompt files removed;
  - the staged `shape-brief.js`;
  - `shape(folderPath, number, toolId)`, which checks a connected folder, a known tool and an open work brief with `shapedAt === null` (`notShapeable` otherwise), then issues an id, writes `prompts/<id>.md` and returns the one-line instruction;
  - the bus watcher, with claim by rename, stale-request drop, sweep, replies, and the `CLOUD_BRIEF_SHAPED { folderPath, number }` push.

  Add `CLOUD_BRIEF_SHAPE` and `CLOUD_BRIEF_SHAPED` to `src/shared/ipcChannels.js`, and wire `setupIPC` and `init(window)` in `src/main/index.js` beside `cloudDiscussionsService`.
- T06 · Give brief lanes a purpose:
  - `getBriefLaneInfo` in `src/renderer/agentDispatch.js` returns `purpose: assignment.purpose || 'discuss'`;
  - `assignmentIcon` in `src/renderer/laneStatus.js` returns lucide `Shapes` for a brief lane whose purpose is `shape`;
  - `discuss()` in `src/renderer/cloudBriefsPanel.js` dispatches with `purpose: 'discuss'`.
- T07 · Add the following to `src/renderer/cloudBriefsCopy.js`:
  - `workStage({ brief, laneOpen })`, which returns `'lane'`, `'shape'` (open unshaped work) or `'none'`;
  - `laneLabel(purpose, name)` ("Discussing in …" or "Shaping in …");
  - `SHAPE_LABEL`, `SHAPE_HINT` and `GO_TO_SHAPING_LABEL`;
  - `shapeErrorMessage(reason)` for `notShapeable`, `unknownTool`, `notFound`, network, not connected and signed out.

  Cover them in `test/cloudBriefsCopy.test.js`.
- T08 · Add Shape to `src/renderer/cloudBriefsPanel.js`:
  - an open lane of either purpose renders its `laneLabel` link, which enters it, on the card and in the detail;
  - a work brief whose `workStage` is `'shape'` gets a primary Shape button in both places;
  - `shape(brief)` invokes `CLOUD_BRIEF_SHAPE` with the current tool and dispatches a new lane with `assignment: { kind: 'brief', purpose: 'shape', … }`, sharing a renamed `starting` guard with `discuss()`;
  - `CLOUD_BRIEF_SHAPED` reloads the board and the open detail.
- T09 · Walk it in Frame against FrameCloud's `feat/brief-shape` on the dev server:
  - Shape a work brief, and check the prompt file's content.
  - Check that Shaping and the dot appear on the card and the detail.
  - Approve a split. The command prints "shaped into N parts", and the drawer shows the Shaped date, the definitions and the History line.
  - Check that Shape is gone, and that a second command run prints the already-shaped sentence.
  - Check that a `<script>` definition shows as text.
  - Check that a Discuss lane left open after Move to Work still reads Discussing.
- T10 · Tell the user a Shape landed, from wherever they are, one click from the brief. `CLOUD_BRIEF_SHAPED` carries `count` as well (`cloudShapeService.js`). When it is for the open folder, the panel shows a `notify.success` toast, "Brief #N was shaped into K parts and is ready to run.", with an Open brief action that opens that brief. `notify.js` gains an optional action button (and a longer stay for a toast that has one); `cloudBriefsCopy.js` gets `shapedNotice(number, count)`. Cover the sentence in `test/cloudBriefsCopy.test.js`.
- T11 · Show what a shaped brief was shaped into on its card: "1 spec", "2 specs · 1 task". `brief.list` carries no parts, so `cloudBriefs.js` gains `partSummary(parts)` and `addPartCounts(call, briefs)`, which reads each open shaped work brief's detail the way `addDiscussionCounts` reads events (a failed read gives `null`, never a failed board); `cloudBriefsService.js` applies it to the list. `cloudBriefsCopy.js` gets `partCountLabel`, and the card draws it. This overturns the plan's "a shaped brief gets no new card line". Cover the summary, the counts and the label in `test/cloudBriefs.test.js` and `test/cloudBriefsCopy.test.js`.
