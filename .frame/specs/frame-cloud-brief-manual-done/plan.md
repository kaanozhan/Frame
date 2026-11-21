# Plan — Frame Cloud brief manual Done

## Architecture

### Resolved plan-time decisions

Business (asked):

- **D1 · A held move when Frame quits or the view goes away → main holds it.**
  The move is sent when 5 seconds pass, when another move starts, or at once
  when Frame quits. Closing the Briefs view or switching projects neither
  cancels nor hastens it: main sends it at 5 seconds anyway. Rejected: a hold
  in the renderer with the web's trade-off (a quit inside 5 seconds drops
  the move). Frame owns its process, so it does not have the browser limit
  the web accepted in FrameCloud D1. (Spec Open Question.)
- **D2 · A button, not a drag** (asked before the spec). This follows
  FrameCloud D3/D4 and overturns the page's "kartı Done'a taşıyarak".
- **D3 · A 5-second Undo, as on the web** (asked before the spec).

Business (silent):

- **D4 · The reason shows in the detail only.** The header reads
  "Done: reason · date" or "Done · date". The card shows no reason
  (FrameCloud D5).
- **D5 · A reason is asked only in the dialog.** A move without a dialog
  sends none (FrameCloud D6).
- **D6 · The words are the web's, verbatim.** Sources:
  `apps/web/src/lib/brief.ts` and `brief-move.tsx` on
  `feat/brief-manual-done`. The full list is under Copy below.
- **D7 · A Done brief's parts offer no Begin or Run.** frame-cloud-brief-done
  stated this, but the code never enforced it (drift). Until now a Done brief
  only had merged parts, which have no Run anyway. With manual Done, a Done
  brief can hold unmerged parts. The lane link and opening the record stay.
- **D8 · `part-merged` keeps "changed this brief".** It is out of scope by
  the spec. `isObserved` here covers only the old automatic `done`.
- **D9 · The move button sits beside an open brief lane's link** on the
  card. It never replaces the link or is hidden by it.

Technical (asked):

- **D10 · Test posture → pure logic only.** This is the project's convention
  (testing record). Tests cover the calls and refusal mapping, the new
  fields, the missing-part and needs-reason rules, the hold's timing, and the
  History, Done-line and refusal sentences. The panel, the IPC shell and
  `notify.js` are not unit-tested. The walk covers them.

Technical (silent):

- **D11 · Two IPC channels (follows from D1).**
  - `CLOUD_BRIEF_MOVE`: `(path, number, { to, reason, hold })` →
    `{ ok: true }` or `{ ok: false, reason }`.
  - `CLOUD_BRIEF_MOVE_UNDO`: `(path, number)` → `undone?`.

  The spec's "one IPC path" becomes a move channel plus its undo, because
  the held move lives in main.
- **D12 · `src/shared/cloudMoveHold.js` is New, pure, with injectable
  timers.** It exports `HOLD_MS = 5000` and `createMoveHold({ holdMs,
  setTimer, clearTimer })`. It is shared because the renderer's toast reads
  the same `HOLD_MS`. Precedent: `src/shared/doneWindow.js`.
- **D13 · The brief id is resolved in main by number** (`getBrief`), as
  `decide` does. The renderer sends only a folder and a number.
- **D14 · Refusals map to reasons in `MOVE_REFUSALS`:**

  | Server code | Reason |
  | --- | --- |
  | `REASON_REQUIRED` | `reasonRequired` |
  | `NOT_STARTED` | `notStarted` |
  | `ALREADY_DONE` | `alreadyDone` |
  | `NOT_DONE` | `notDone` |
  | `ALREADY_CLOSED` | `alreadyClosed` |
  | `NOT_WORK` | `notWork` |
  | `BRIEF_NOT_FOUND` | `notFound` |

  A reason is trimmed, and a blank one is left out of the input. This keeps
  the server's "blank counts as absent".
- **D15 · `normalizeBrief` carries `doneAt`, `doneBy` and `doneReason`**
  (string or null) **and `readyForDone`** (true only when the server sends
  `true`). The detail inherits them through its spread. This overturns
  frame-cloud-brief-done's "normalizeBrief does not carry doneAt, since
  status places the card" (`test/cloudBriefs.test.js:248`). Status still
  places the card; `doneAt` now dates the Done line.
- **D16 · The move rules live in `cloudBriefsCopy.js`.**
  - `missingParts(brief)`: live parts (no `droppedAt`) that do not
    `countsAsMerged` on `brief.targetBranch`, in part order.
  - `needsReason(brief)`: `mergeTracking === 'ready'` and at least one
    missing part.

  These mirror the web's `lib/brief.ts`. The server enforces the same rule.
- **D17 · Overlay.** The panel keeps `moving`, a Set of brief numbers.
  - While a move is held, the board groups that brief as `done`.
  - Its control reads "Moving to Done…" and is disabled.
  - The entry is cleared when the move's invoke resolves (sent, undone or
    refused).
- **D18 · `notify` gains a `visibleMs` option** (additive). The Undo toast
  then lives exactly `HOLD_MS`. Today an action toast stays 6000 ms, which
  would leave Undo on screen after the send. A later toast that replaces it
  leaves the hold running.
- **D19 · Quit flush.** `before-quit`'s flush block in `src/main/index.js`
  awaits `cloudBriefsService.flushMoves()` beside `analytics.shutdown()`,
  through `Promise.allSettled`. `flushMoves` is capped at 3000 ms, so a dead
  network cannot hold the app open.
- **D20 · One dialog function for both directions.** `openMoveDialog({ brief,
  to })` in the panel is built like `openMoveToWork`: backdrop,
  `role="dialog"`, Esc, and a pending state. A `textarea.cloud-briefs-input`
  holds the reason. The missing list shows each part's
  `partFacts(part, brief).status.label`, the same words as its row.
- **D21 · After an answer.**
  - **Lands:** `load()`, plus `loadDetail()` when that brief is open
    (`confirmMoveToWork`'s pattern).
  - **Final refusal:** its sentence and a `load()`, never a retry. A dialog
    shows the sentence in its error line. A held move shows it through
    `notify.error`.
  - **`undone`:** says nothing.
- **D22 · Footprint collisions are accepted.**
  - `src/main/index.js` sits in the footprints of
    `audit-q3-performance-resources` (implementing since 2026-08) and
    `str-02-structure-lifecycle`. The latter reads `tasks_generated` only
    through the installed app's flip; it is committed as `done`.
  - `src/shared/ipcChannels.js` sits in `audit-q3-cross-platform` (planned
    since 2026-07).
  - Both edits here are one-line additions.
- **D23 · Recording.**
  - The overturned decisions (spec Constraints) go into
    `.frame/PROJECT_NOTES.md` once, at the end of the branch. This follows
    the developer's batching rule.
  - The code comments are corrected where each file is touched:
    - the `cloudBriefs.js`, `cloudBriefsService.js`, `cloudBriefsCopy.js`
      and `cloudBriefsPanel.js` headers;
    - `cloudDoneService.js`'s `FINAL_REFUSALS` comment.

### Main: the calls

`cloudBriefs.js` adds the following:

- `moveToDone({ api, token, fetchJson, signal, id, reason })` → POST
  `brief.moveToDone` with `{ id, reason? }`, returning
  `normalizeBriefDetail`.
- `moveBackToActive({ …, id, reason })` → POST `brief.moveBackToActive`
  with `{ id, reason }`.
- `MOVE_REFUSALS` (D14).
- `moveThrough(call, { id, to, reason })` → `{ ok: true }` or
  `{ ok: false, reason }`.
  - `to` must be `'done'` or `'active'`; anything else is `badRequest`.
  - A move back with a blank reason is refused as `reasonRequired` before
    anything is sent.
  - Its shape follows `decideThrough`.

### Main: the hold

`createMoveHold` returns four functions.

- **`hold(key, run)` → Promise of the result.**
  - Any other pending move is started at once ("another move starts").
  - A pending move under the same key returns its existing promise.
  - The timer calls `run()` after `holdMs` and resolves with its answer.
- **`undo(key)` → boolean.**
  - A pending move is cancelled: its timer is cleared, `run` is never
    called, and its promise resolves `{ ok: false, reason: 'undone' }`.
  - It returns false when nothing is pending, for example after the send
    started.
- **`flush({ timeoutMs })`.** It starts every pending move now and resolves
  when all settle or the timeout passes.
- **`size()`.**

A `run` that throws resolves as `{ ok: false, reason: 'other' }`. The hold
never rejects.

`cloudBriefsService.js` adds three functions.

- **`move(folderPath, number, { to, reason, hold })`**
  1. It checks the connected project and the number, as `decide` does.
  2. It resolves the id with `getBrief`.
  3. It builds `send = () => core.moveThrough(call, { id, to, reason })`.
  4. With `hold`, `to === 'done'` and no reason, it returns
     `moveHold.hold(key, send)`. The key is the folder path and the number,
     joined by a NUL.
  5. Otherwise it awaits `moveHold.flush()` and returns `send()`.
- **`undoMove(folderPath, number)`** → `moveHold.undo(key)`.
- **`flushMoves()`** → `moveHold.flush({ timeoutMs: 3000 })`.

### Renderer: the flow

**Move to Done** on the card or in the detail:

1. The panel takes the brief: the board's entry, or the detail's.
2. **`copy.needsReason(brief)` is false** (D5, D17, D18):
   1. Add the brief to `moving` and redraw the board.
   2. Show `notify.success(copy.movedNotice(n), { action: { label:
      copy.UNDO_LABEL, onClick: undo }, visibleMs: HOLD_MS })`.
   3. Invoke `CLOUD_BRIEF_MOVE` with `{ to: 'done', hold: true }`.
   4. When it resolves, remove the brief from `moving`, then act on the
      answer:
      - `ok` → reload (D21).
      - `undone` → redraw.
      - `reasonRequired` → `CLOUD_BRIEF_GET` that brief and open the dialog
        on the fresh detail (G7).
      - Anything else → `notify.error(copy.moveErrorMessage(reason))` and
        `load()`.
3. **`copy.needsReason(brief)` is true:** `openMoveDialog({ brief, to:
   'done' })`.
   - Confirm is disabled until the trimmed reason is non-empty.
   - Confirming invokes `{ to: 'done', reason }` with no hold. Main first
     flushes any held move.

**Move back to Active:** `openMoveDialog({ brief, to: 'active' })`. The
reason is required, and the move is sent at once.

**Undo** invokes `CLOUD_BRIEF_MOVE_UNDO`. The pending move's invoke then
resolves `undone`.

### Renderer: what is drawn

- **Card controls** (`renderCardActions`), for open, started work:
  - `active` → "Move to Done", or "Moving to Done…" while in `moving`;
  - `done` → "Move back to Active".

  Backlog, proposal and closed cards get neither (G2, S1). The button is
  placed beside a lane link when one is open (D9).
- **Detail action** (`renderDiscussAction`): the same button for the same
  briefs.
- **Ready for Done:** a badge on an Active card when `brief.readyForDone`
  is true.
- **Done line:** the detail header shows `copy.doneLine(brief)` where
  `endingLine` sits for a closed brief.
- **Part rows:** `partFacts` passes `done: brief.status === 'done'` to
  `partStatus`, which then returns `run: null` (D7).
- **Board grouping:** `copy.groupByColumn` takes the briefs with held
  numbers overlaid as `status: 'done'`.

### Copy (D6)

Labels and hints:

- `COLUMNS` Done hint → "Move a brief here when its work is finished."
- Buttons and badges: `MOVE_TO_DONE_LABEL` "Move to Done",
  `MOVE_BACK_LABEL` "Move back to Active", `MOVING_TO_DONE_LABEL` "Moving to
  Done…", `READY_FOR_DONE_LABEL` "Ready for Done", `UNDO_LABEL` "Undo",
  `REASON_LABEL` "Reason".
- `movedNotice(n)` → "Moved #N to Done".

The two dialogs:

| | Move to Done | Move back to Active |
| --- | --- | --- |
| Title | `moveToDoneTitle(n)` → "Move #N to Done?" | `moveBackTitle(n)` → "Move #N back to Active?" |
| Description | `moveToDoneDescription(target)` → "Some parts are not merged into `<target>` yet, so the move records why the brief is done anyway." | `MOVE_BACK_DESCRIPTION` → "The brief returns to Active with its parts as they are, and Close and the target branch open again. The move records why." |
| Confirm button | `MOVE_TO_DONE_ANYWAY_LABEL` → "Move to Done anyway" | the move-back label |
| Extra line | `missingPartsLine(count, target)` → "N part(s) not merged into `<target>`." | none |

`doneLine(brief)` → "Done: reason · date", "Done · date", or '' for a
brief that is not Done.

`moveErrorMessage(reason)`:

| Reason | Sentence |
| --- | --- |
| `alreadyDone` | "This brief is done, so it cannot be closed and its target is fixed. Move it back to Active first." |
| `notDone` | "This brief is not done." |
| `notStarted` | "Work on this brief has not started yet." |
| `alreadyClosed` | "This brief is already closed." |
| `notWork` | "Only work can take a priority, a milestone, parts, a start or a close." |
| `reasonRequired` | "Give a reason." |
| `notFound`, `network`, `notConnected`, `unauthorized`, `noWorkspace` | the shared sentences |
| anything else | "Something went wrong. Try again." |

History (`eventAction`):

- `done` whose data has a `missing` array:
  - "moved this brief to Done";
  - "moved this brief to Done: “reason”";
  - "moved this brief to Done with N part(s) not merged into `<target>`:
    “reason”".
- `done` without a `missing` array is the old automatic event. It reads
  "This brief is done: every part is merged into `<target>`" (or "…every
  part is merged"). `eventSentence` writes no actor in front, through
  `isObserved(event)`.
- `done-reverted` → "moved this brief back to Active: “reason”".

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified**.
  - The new brief fields (D15), `moveToDone`, `moveBackToActive`,
    `MOVE_REFUSALS` and `moveThrough`.
  - The header now names the moves as writes.
- `src/shared/cloudMoveHold.js` — **New**. `HOLD_MS` and `createMoveHold`,
  pure with injectable timers (D12).
- `src/main/cloud/cloudBriefsService.js` — **Modified**.
  - `move`, `undoMove` and `flushMoves`, with one hold instance.
  - `setupIPC` registers the two channels, and the header is updated.
- `src/shared/ipcChannels.js` — **Modified**. `CLOUD_BRIEF_MOVE` and
  `CLOUD_BRIEF_MOVE_UNDO` (D11).
- `src/main/index.js` — **Modified**. `before-quit` flushes held moves
  beside analytics (D19).
- `src/main/cloud/cloudDoneService.js` — **Modified**. The `FINAL_REFUSALS`
  comment no longer says `ALREADY_DONE` never changes. The behaviour is
  unchanged.
- `src/renderer/cloudBriefsCopy.js` — **Modified**.
  - The Done hint, the move labels, dialog words and toast words.
  - `missingParts`, `needsReason`, `doneLine` and `moveErrorMessage`.
  - The `done` and `done-reverted` sentences and `isObserved`.
  - `partStatus`'s `done` option, and the header comment.
- `src/renderer/cloudBriefsPanel.js` — **Modified**.
  - The move buttons on the card and in the detail, the badge, the Done
    line, and the Done-brief part rows.
  - `openMoveDialog`, the `moving` overlay, the Undo toast and the stale
    re-read.
  - The header comment.
- `src/renderer/notify.js` — **Modified**. An optional `visibleMs` (D18).
- `src/renderer/styles/components/cloud-briefs.css` — **Modified**. The
  "Ready for Done" badge, the reason field's height, and the dialog's
  missing-parts list.
- `test/cloudBriefs.test.js` — **Modified**.
  - The new fields replace the `doneAt` exclusion test.
  - The two calls' requests, and `moveThrough`'s mapping and pre-send
    refusals.
- `test/cloudMoveHold.test.js` — **New**. Hold, undo, another-move flush,
  `flush` with a timeout, and a throwing `run`, all on fake timers.
- `test/cloudBriefsCopy.test.js` — **Modified**.
  - The Done hint, `missingParts`, `needsReason` and `doneLine`.
  - The move sentences, the old observed `done` without an actor, and
    `moveErrorMessage`.
  - `partStatus` with `done`.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudBriefsService.js
- src/main/cloud/cloudDoneService.js
- src/main/index.js
- src/shared/cloudMoveHold.js
- src/shared/ipcChannels.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/notify.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudBriefsCopy.test.js
- test/cloudMoveHold.test.js

## Dependencies

None.

## Sequencing

1. **Read and call the moves in the core.**
   - In `cloudBriefs.js`, add `doneAt`, `doneBy`, `doneReason` and
     `readyForDone` to `normalizeBrief`.
   - Add `moveToDone`, `moveBackToActive`, `MOVE_REFUSALS` and
     `moveThrough`, and rewrite the header's write list.
   - In `test/cloudBriefs.test.js`, replace the `doneAt` exclusion test with
     the new fields. Add the two requests, the refusal mapping, the
     blank-reason trim, and the pre-send refusals (`badRequest`,
     `reasonRequired` on a blank move back).
2. **The hold.**
   - Write `src/shared/cloudMoveHold.js` (`HOLD_MS`, `createMoveHold`).
   - Write `test/cloudMoveHold.test.js` on fake timers:
     - sent after `holdMs`;
     - undo before → `undone` and no `run`;
     - undo after the send started → false;
     - a second hold starts the first at once;
     - the same key returns the same promise;
     - `flush` starts all and honours `timeoutMs`;
     - a throwing `run` resolves `other`.
3. **Wire the moves through main.**
   - Add `CLOUD_BRIEF_MOVE` and `CLOUD_BRIEF_MOVE_UNDO` to `ipcChannels.js`.
   - Add `move`, `undoMove` and `flushMoves` to `cloudBriefsService.js`,
     with their handlers, and update its header.
   - Flush held moves in `src/main/index.js`'s `before-quit` beside
     `analytics.shutdown()`.
   - Correct the `FINAL_REFUSALS` comment in `cloudDoneService.js`.
4. **The words and rules.**
   - In `cloudBriefsCopy.js`, change the Done hint and add every label and
     sentence under Copy.
   - Add `missingParts`, `needsReason`, `doneLine`, `moveErrorMessage`,
     `isObserved`, the `done` and `done-reverted` cases, and `partStatus`'s
     `done` option. Update the header.
   - In `test/cloudBriefsCopy.test.js`, update the column-hint test and cover
     each new function and sentence. That includes the old observed `done`
     reading with no actor, and `partStatus({ done: true })` returning
     `run: null` while keeping its label.
5. **Show Done facts in the panel.**
   - Add the "Ready for Done" badge on Active cards, with its CSS.
   - Show `doneLine` in the detail header.
   - Pass `done` to `partStatus` through `partFacts`, so a Done brief's rows
     lose Begin and Run.
6. **Move with a dialog.**
   - Add "Move to Done" and "Move back to Active" on the card
     (`renderCardActions`) and in the detail (`renderDiscussAction`), with
     their click actions.
   - Add `openMoveDialog` for a move to Done that needs a reason and for
     every move back. The missing-parts list carries row labels, and confirm
     is held until a reason is typed. Add the reason field's and the list's
     CSS.
   - Send a move without a reason directly for now (`hold: false`).
   - On an answer, reload on success, or show the refusal sentence and
     reload.
7. **Hold and Undo in the panel.**
   - Add `visibleMs` to `notify.js`.
   - A move to Done without a dialog goes through the `moving` overlay
     ("Moving to Done…"), the "Moved #N to Done" toast with Undo
     (`CLOUD_BRIEF_MOVE_UNDO`), and `hold: true`.
   - A `reasonRequired` answer re-reads the brief and opens the dialog.
8. **Walk it against a local FrameCloud server.** Run the server on
   `feat/brief-manual-done`, or on its `main` after PR #26 merges. The
   developer does this, because sign-in and the GitHub App are theirs. Check
   each Success Criterion, including:
   - a quit inside the 5 seconds sends the move (D1);
   - a brief moved back reports its missing branch or completion on the next
     read.
9. **Record the overturned decisions.** Append one dated entry to
   `.frame/PROJECT_NOTES.md` with the decisions the spec lists under
   Constraints, D1, D7 and D15, and the walk's findings.
