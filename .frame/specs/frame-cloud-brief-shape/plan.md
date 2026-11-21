# Plan — Frame Cloud brief shape

## Architecture

### Resolved plan-time decisions

- **Shape is its own click.** The Move to Work dialog stays as it is. The
  new work brief's card and detail show Shape, and nothing chains the two.
  Asked; the user chose this over a "Move to Work and Shape" button, which
  keeps the dialog single-purpose. A chain can be added later.
- **A separate command, directory and store.** Shape gets
  `src/templates/bin/shape-brief.js`, staged at
  `<userData>/cloud-shapes/shape-brief.js`, with its own `shapes.json`,
  `bus/` and `prompts/`. Asked; the user chose this over one brief-session
  command with verbs. Discuss prompts issued in the last 90 days name
  `record-discussion.js` by absolute path, so that file, its arguments and
  its bus stay byte-for-byte as shipped. The bus protocol is the same
  (tmp + rename, claimed by rename, answered in `replies/`, a 30 s wait,
  withdrawal), so C5 holds at the level of the idiom.
- **The lane carries its purpose.** Shape dispatches with
  `assignment: { kind: 'brief', purpose: 'shape', … }`, and Discuss now
  passes `purpose: 'discuss'`. `getBriefLaneInfo` returns
  `purpose` (a lane without one reads as `'discuss'`, so lanes opened before
  this change keep their meaning). Asked; the user chose this over inferring
  the purpose from the brief's kind, which would label a Discuss lane left
  open after Move to Work as "Shaping". `agentDispatch.js` sits in
  `audit-q3-cross-platform`'s footprint (phase `planned` since 2026-07-20);
  the change is one added field in one function, far from anything
  cross-platform.
- **Test posture: pure logic only.** This is the project's convention
  (testing record, 2026-08-29): the pure core, the command, `cloudBriefs`
  and `cloudBriefsCopy` get tests. The Electron shell and the DOM-coupled
  panel do not, since no DOM harness exists. Asked.
- **One lane per brief, whatever its purpose.** When any brief lane is open,
  the card and detail show that lane's link ("Discussing in <lane>" or
  "Shaping in <lane>"), and Shape appears only after it closes. This
  follows the spec's "One lane per brief" and the existing
  `enterBriefLane(number)` lookup. Silent.
- **Parts travel as JSON on stdin.** The command reads
  `<<'FRAME_PARTS' … FRAME_PARTS` and parses a JSON array of
  `{ title, shape, type, definition }`. JSON strings cannot hold a raw
  newline, so no line of a definition can end the heredoc. No field travels
  as an argument, and nothing is written to a file in the repo. Silent.
- **Validation mirrors FrameCloud's `shapeBriefInputSchema`:**
  - at least one part;
  - `title` trimmed, 1–200 characters (`LIMITS.title`);
  - `shape` in `spec | task`;
  - `type` in `feature | fix | refactor | docs | test`;
  - `definition` trimmed, 1–10,000 characters (`LIMITS.body`).

  There is no upper bound on the part count, because the server sets none.
  The command checks the same rules first so the agent hears a reason at
  once; main checks again and trusts nothing. Silent.
- **Refusals come back as values.** `NOT_WORK` becomes `notWork`,
  `ALREADY_CLOSED` becomes `alreadyClosed`, `ALREADY_SHAPED` becomes
  `alreadyShaped` and `BRIEF_NOT_FOUND` becomes `notFound`. They are caught
  inside the function passed to `call()`, as `recordThrough` and
  `decideThrough` do, because `call()` folds them into `badRequest`.
  Silent.
- **The prompt reuses the Discuss brief block.** `briefData`,
  `commentLines`, `fence` and `shellQuote` are exported from
  `cloudDiscussions.js` unchanged, so the Shape prompt shows the same
  number, title, description, links, discussion records and comments. Only
  the flow around that block is Shape's own. Silent.
- **The spec catalog is read by the agent, not by Frame.** The prompt says:
  if the repository has `.frame/specs/`, read each spec's title and
  `digest.md` (or `spec.md`) before proposing parts, so a part neither
  repeats nor collides with an existing spec. Frame does not scan the
  folder. Silent.
- **Shape ids live 90 days, like discussion ids.** A resumed session can
  still write. A second write is harmless, because the server answers
  `ALREADY_SHAPED`. Silent.
- **The definition is a collapsed `<details>`, pre-wrapped and escaped.**
  This matches the web's Collapsible (FrameCloud brief-shape plan). It is
  plain text, never passed through `marked` (C7). Silent.
- **History reads "shaped this brief into N parts"** ("1 part" when N is
  1), with the same wording as the web. Silent.
- **The lane chip icon for a Shape lane is lucide `Shapes`.** Discuss keeps
  `MessagesSquare`. Silent.
- **A shaped brief gets no new card line.** Only the Shape button goes away.
  The spec asks for nothing more on the card. Silent.

### Data shapes

`normalizeBrief` gains `shapedAt` (string or null). `normalizePart` swaps
`why` for `definition` (a string, `''` when absent, per C8).

Shape store (`<userData>/cloud-shapes/shapes.json`):

```
{ version: 1, shapes: { <24-hex id>: { folderPath, number, toolId, createdAt } } }
```

Bus request (`bus/<ts>-<rand>.json`), written by `shape-brief.js`:

```
{ shapeId, parts: [{ title, shape, type, definition }], ts }
```

The reply is `{ ok, reason?, message }`, the same as Discuss.

`brief.shape` wire call: `POST brief.shape { id, parts }`, which returns
the brief detail (FrameCloud plan).

### Components

- **`cloudBriefs.js`** (pure): the normalizers above, plus
  `shapeBrief({ api, token, fetchJson, signal, id, parts })`.
- **`cloudShape.js`** (New, pure): mirrors `cloudDiscussions.js`.
  - Store: `newShapeId`, `addShape`, `getShape`, `pruneShapes`.
  - Prompt file: `promptFileName`, `promptInstruction`, `stalePromptFiles`.
  - `validateShapeInput(parts)`, which returns `{ ok, input }` or
    `{ ok: false, reason: 'badRequest', field, index? }`.
  - `buildShapePrompt({ brief, events, commandPath, shapeId, meId })`.
  - `handleShapeRequest(request, deps)`: unknown id → validate → connected
    → `getBrief` → `shapeThrough`, returning
    `{ ok, folderPath, number, count }`.
  - `replyMessage`.
- **`shape-brief.js`** (New, self-contained command): `parseArgs`
  (`--shape <id>`), `requestFor({ shapeId, partsText, ts })` (parses the
  JSON and applies the same checks), and `run()`, which carries the same
  bus protocol and messages as `record-discussion.js`.
- **`cloudShapeService.js`** (New, Electron shell): owns `cloud-shapes/`.
  - `shape(folderPath, number, toolId)` checks that the folder is
    connected, the tool is known, and the brief is open work with
    `shapedAt === null`; otherwise it returns `notShapeable`. It then issues
    an id, writes the prompt file and returns the one-line instruction.
  - A watcher drains the bus. Each shape that lands is pushed as
    `CLOUD_BRIEF_SHAPED { folderPath, number }`.
- **Renderer.**
  - `cloudBriefsCopy.workStage({ brief, laneOpen })` returns `'lane'`,
    `'shape'` or `'none'`.
  - `laneLabel(purpose, name)` returns "Discussing in …" or
    "Shaping in …".
  - The panel draws Shape and Go to shaping and runs `shape(brief)`, which
    shares a start path with `discuss` through the renamed `starting` guard.
    It reloads on `CLOUD_BRIEF_SHAPED` and renders the Parts tab.

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified.** `shapedAt` on briefs, `definition` instead of `why` on parts, `shapeBrief` call, header comment names the new write.
- `src/main/cloud/cloudDiscussions.js` — **Modified.** Also exports `briefData`, `commentLines`, `fence`, `shellQuote` (no behavior change).
- `src/main/cloud/cloudShape.js` — **New.** Pure core of Shape: ids and store, prompt file, validation, prompt, request handling, reply sentences.
- `src/main/cloud/cloudShapeService.js` — **New.** Electron shell: `cloud-shapes/` store, staged command, prompt files, bus watcher, `CLOUD_BRIEF_SHAPE` handler, `CLOUD_BRIEF_SHAPED` push.
- `src/templates/bin/shape-brief.js` — **New.** The command the agent runs; parts JSON on stdin, one bus request, prints Frame's reply.
- `src/shared/ipcChannels.js` — **Modified.** `CLOUD_BRIEF_SHAPE`, `CLOUD_BRIEF_SHAPED`.
- `src/main/index.js` — **Modified.** Require, `setupIPC` and `init(window)` for `cloudShapeService`.
- `src/renderer/agentDispatch.js` — **Modified.** `getBriefLaneInfo` returns `purpose` (default `'discuss'`).
- `src/renderer/laneStatus.js` — **Modified.** `Shapes` icon for a brief lane whose purpose is `shape`.
- `src/renderer/cloudBriefsCopy.js` — **Modified.** `workStage`, `laneLabel`, Shape labels and hint, `shapeErrorMessage`, the `shaped` history sentence, `shapedLine`.
- `src/renderer/cloudBriefsPanel.js` — **Modified.** Shape / Go to shaping on card and detail, `shape()` dispatch with `purpose`, Discuss passes `purpose: 'discuss'`, Parts tab with Shaped date and collapsed definitions, reload on `CLOUD_BRIEF_SHAPED`.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** Shaped line and definition `<details>` styles.
- `test/cloudBriefs.test.js` — **Modified.** `shapedAt` and `definition` normalizing, `shapeBrief` wire shape.
- `test/cloudShape.test.js` — **New.** Store, validation, prompt, request handling and reply sentences.
- `test/shapeBrief.test.js` — **New.** `parseArgs`, `requestFor`, and `run()` against a temp bus.
- `test/cloudBriefsCopy.test.js` — **Modified.** `workStage`, `laneLabel`, the `shaped` sentence, Shape error sentences.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudDiscussions.js
- src/main/cloud/cloudShape.js
- src/main/cloud/cloudShapeService.js
- src/templates/bin/shape-brief.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/renderer/agentDispatch.js
- src/renderer/laneStatus.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudShape.test.js
- test/shapeBrief.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None. FrameCloud's `brief-shape` (branch `feat/brief-shape` there) must be
running on the dev server for the walk in step 7. Nothing in Frame's build
depends on it.

## Sequencing

1. **Read shaped briefs.** In `cloudBriefs.js`, `normalizeBrief` carries
   `shapedAt` and `normalizePart` carries `definition` instead of `why`.
   Add `shapeBrief` (POST `brief.shape`, returning `normalizeBriefDetail`).
   In `cloudBriefsCopy.js`, add the `shaped` history sentence and
   `shapedLine(date)`. In the panel, the Parts tab shows "Shaped <date>"
   above the list when `shapedAt` is set, each part drops `why`, and each
   definition sits in a collapsed, escaped, pre-wrapped `<details>`. Add
   the styles to `cloud-briefs.css`. Tests go in `test/cloudBriefs.test.js`
   (normalizing, including a part without a definition, and the
   `shapeBrief` input and URL) and `test/cloudBriefsCopy.test.js` (the
   sentence for 1 and N parts).
2. **The pure core.** Export `briefData`, `commentLines`, `fence` and
   `shellQuote` from `cloudDiscussions.js`. Write `cloudShape.js`:
   - ids and the store (90-day prune);
   - prompt file helpers;
   - `validateShapeInput`;
   - `buildShapePrompt`: the brief block; the flow (read the brief and the
     code, read `.frame/specs/` when present, ask what the split depends
     on, propose parts with the definition headings, write only after the
     user approves the whole set); the exact command in a fence; and "tell
     the user exactly what it printed";
   - `shapeThrough`, `handleShapeRequest` and `replyMessage`.

   `test/cloudShape.test.js` covers the store round trip and prune, each
   validation refusal, and what the prompt contains (brief fields fenced,
   headings, command path and id, no local-file offer). It also covers
   `handleShapeRequest` with fakes: unknown id, bad part, not connected,
   each server refusal, success with a count, and that exactly one
   `brief.shape` is sent with the parts in order.
3. **The command.** Write `src/templates/bin/shape-brief.js`:
   `parseArgs` (`--shape <id>` only), `requestFor` (JSON parse and the
   same checks), and `run()` (atomic request, 30 s poll, withdrawal and the
   two timeout messages). Export `WAIT_MS`. `test/shapeBrief.test.js`
   covers the argument errors, malformed JSON, an empty array, a bad field,
   and `run()` against a temp directory: a reply read and printed with exit
   code 0 or 1, and a timeout withdrawn with "did not answer".
4. **The service and its wiring.** Write `cloudShapeService.js`:
   - `init`, which loads and prunes the store, removes stale prompts,
     stages the command and starts the watcher;
   - `shape(folderPath, number, toolId)`, which returns
     `{ ok, prompt }` or `{ ok: false, reason }`, with `notShapeable` for
     a proposal, an ended brief or a shaped one;
   - `handleFile`, `drain`, `sweep`, and the `CLOUD_BRIEF_SHAPED` push.

   Add `CLOUD_BRIEF_SHAPE` and `CLOUD_BRIEF_SHAPED` to `ipcChannels.js`,
   then wire `setupIPC` and `init(window)` in `src/main/index.js` beside
   `cloudDiscussionsService`.
5. **The lane knows its purpose.** `getBriefLaneInfo` returns
   `purpose: assignment.purpose || 'discuss'`. `laneStatus.assignmentIcon`
   returns `Shapes` for a brief lane whose purpose is `shape`. The panel's
   `discuss()` dispatch passes `purpose: 'discuss'`.
6. **Shape in the Briefs view.** In `cloudBriefsCopy.js`, add:
   - `workStage({ brief, laneOpen })`;
   - `laneLabel(purpose, name)`;
   - `SHAPE_LABEL`, `SHAPE_HINT` and `GO_TO_SHAPING_LABEL`;
   - `shapeErrorMessage`, covering `notShapeable`, `unknownTool`,
     `notFound`, network, not connected and signed out.

   In the panel:
   - An open lane of either purpose renders its labelled link, using
     `laneLabel` in place of `discussingIn` at both call sites.
   - Otherwise a proposal follows `proposalStage` as today, and a work
     brief in `workStage` `'shape'` gets a primary Shape button on the card
     and in the detail's action slot.
   - `shape(brief)` invokes `CLOUD_BRIEF_SHAPE` and dispatches a new lane
     with `assignment: { kind: 'brief', purpose: 'shape', … }`. It shares
     the renamed `starting` guard with `discuss()`.
   - `CLOUD_BRIEF_SHAPED` reloads the board and the open detail.

   `test/cloudBriefsCopy.test.js` covers `workStage`:
   - an open unshaped work brief gives `'shape'`;
   - a shaped, ended or proposal brief gives `'none'`;
   - an open lane gives `'lane'`.

   It also covers `laneLabel` and the Shape error sentences.
7. **Walk it in Frame.** With FrameCloud's `feat/brief-shape` on the dev
   server, walk these cases:
   - Shape on a work brief. The lane opens with the one-line instruction,
     and the prompt file holds the brief, the headings and the command.
   - The card and detail read Shaping and enter the lane.
   - Approve a split. The command prints "shaped into N parts", and the
     drawer reloads with the Shaped date, the definitions and the History
     line.
   - The Shape button is gone.
   - A second command run prints the already-shaped sentence.
   - A definition holding `<script>` shows as text.
   - A Discuss lane left open after Move to Work still reads Discussing.

   Record the walk in the outcome.
