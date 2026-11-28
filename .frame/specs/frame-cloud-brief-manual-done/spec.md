---
keywords: frame cloud, manual done, move to done, move back to active, done reason, ready for done, undo, briefs panel
related: frame-cloud-brief-done, frame-cloud-brief-discussions, frame-cloud-brief-start
---

# Frame Cloud brief manual Done

## Problem

FrameCloud's `brief-manual-done` (branch `feat/brief-manual-done`, PR #26)
removes automatic Done. A merge, a link, a drop or a retarget no longer moves
a brief to Done. Done is now a person's move, made with
`brief.moveToDone` and undone with `brief.moveBackToActive`.

Frame's Briefs view cannot make that move. Once the server ships it:

- A finished brief stays in Active forever unless someone opens the web.
- The Done column hint still says a brief "moves here on its own once its
  work lands on the target branch". That is no longer true.
- A Done brief shows no reason, and History reads both moves as "changed
  this brief".

This is the Frame half of phase 1 of "Active ve Done Akışı" (2026-11-07,
https://claude.ai/artifact/Upc2JqXyPWMLyeqgvKUKUQ). It follows
frame-cloud-brief-done T11, whose walk found the late, automatic Done.

## Goal

From Frame's Briefs view, a member moves a started work brief to Done and
back. The rules, dialog and words match the web Board.

- **Two calls.** `cloudBriefs.js` gains `moveToDone` and `moveBackToActive`.
  It reads three new fields: `readyForDone`, `doneBy` and `doneReason`. It also
  reads `doneAt`, which Frame does not normalize today. One IPC path carries
  the moves from the panel to main.
- **A button, not a drag.**
  - An Active work card has "Move to Done" at its foot.
  - A Done card has "Move back to Active".
  - The brief detail offers the same action where Move to Work sits.
  - A Backlog card, a proposal and a closed card have neither button.
- **When to ask for a reason.** The panel decides from its last read. A
  reason is needed when `mergeTracking` is `ready` and at least one *missing*
  part exists. A missing part is a live part (not dropped) that does not
  count as merged on the current target.
  - **No reason needed.** The card shows in Done at once. A toast reads
    "Moved #N to Done" and offers Undo for 5 seconds. The request goes out
    when the 5 seconds pass or when another move starts. Undo cancels it, so
    nothing is written and History gets no line.
  - **Reason needed.** A dialog titled "Move #N to Done?" lists the missing
    parts with their row status, under "N part(s) not merged into
    `<target>`." Its "Move to Done anyway" button stays disabled until a
    reason is typed. The move is sent at once, with no Undo.
  - **Moving back.** It always asks for a reason, in "Move #N back to
    Active?", and is sent at once.
  - **Stale view.** If a move sent without a reason comes back
    `REASON_REQUIRED`, the panel reads the brief again and opens the dialog.
- **Ready for Done.** An Active card shows a "Ready for Done" badge when
  `readyForDone` is true.
- **A Done brief's reason.** The detail shows "Done: reason · date", or
  "Done · date" when there is no reason, the way it shows a closed brief.
- **Words** (`cloudBriefsCopy.js`, matching the web's D7 and D18):
  - The Done hint becomes "Move a brief here when its work is finished."
  - History sentences:
    - "moved this brief to Done."
    - "moved this brief to Done: “reason”."
    - "moved this brief to Done with N part(s) not merged into
      `<target>`: “reason”."
    - "moved this brief back to Active: “reason”."
  - An old automatic `done` event (its data has no `missing` array) reads
    "This brief is done: every part is merged into `<target>`."
  - Refusals get their own sentences: `ALREADY_DONE`, `NOT_DONE`,
    `NOT_STARTED`, `ALREADY_CLOSED` and `NOT_WORK`.

## Constraints

- **The contract is FrameCloud's `brief-manual-done`.** Sources: that repo's
  `.frame/specs/brief-manual-done/plan.md` (D3–D18) and the Frame handoff in
  its outcome T09.
  - `brief.moveToDone({ id, reason? })` and
    `brief.moveBackToActive({ id, reason })`. Both are on
    `workspaceProcedure`, so the device token works. Both return the brief
    detail.
  - A blank reason counts as no reason.
  - `REASON_REQUIRED` means "ask the person". `NOT_STARTED`,
    `ALREADY_DONE`, `NOT_DONE`, `ALREADY_CLOSED` and `NOT_WORK` are final.
    Frame never retries a final refusal.
  - A move asks GitHub nothing. Facts freeze while a brief is Done.
  - PR #26 was still open when this spec was written. The walk needs a local
    FrameCloud server running that branch, or its `main` after the merge.
- **Overturned in Frame, recorded explicitly** in `.frame/PROJECT_NOTES.md`
  and in the touched code comments, never silently:
  - frame-cloud-brief-done Goal: "Done means merged" and "The Done column
    fills on its own". Done is now a person's move.
  - frame-cloud-brief-done Constraints: "No Frame call marks … a brief Done
    (FrameCloud C3)". Frame now moves a brief to Done. It still never marks
    a part merged.
  - The `cloudBriefs.js` header: "a brief Done — stays on the server or the
    web".
  - The page's "kartı Done'a taşıyarak" (drag the card). Frame follows
    FrameCloud D3/D4: a button, no drag.
- **Kept from frame-cloud-brief-done.**
  - `recordBranch`, `recordCompletion` and the completion reporter are
    unchanged.
  - The reporter reports Active briefs only and holds no refusal, so after a
    move back the next read sends what is missing. Only its comment that
    `ALREADY_DONE` "never changes" is corrected.
  - `partStatus`'s order, "Implemented", the merged rule and the summary stay.
  - A Done brief's parts offer no Begin or Run. After a move back, they do
    again.
- **Writes.** Earlier specs allow `create`, `addAttachment`,
  `recordDiscussion`, `decide`, `shape`, `start`, `recordBranch` and
  `recordCompletion`. This spec adds `moveToDone` and `moveBackToActive`.
- **The token stays in main** (frame-cloud-brief-discussions). The renderer
  never calls the cloud.
- **One toast layer.** The Undo toast uses `notify.js` and its `action`
  option. No per-panel toast.
- **The dialog follows Move to Work's dialog** in the panel: the same markup,
  focus handling and pending state.
- **Tests.** Unit tests cover the pure parts:
  - the two calls and their refusal mapping;
  - the new fields' normalization;
  - the missing-part and needs-reason rules;
  - the Undo hold's timing;
  - the History and refusal sentences.

  The Electron shell is not unit-tested, as in the earlier cloud specs. The
  walk runs against a local FrameCloud server.

## Success Criteria

- When an Active work brief is shown, then its card has "Move to Done". When
  a Done brief is shown, its card has "Move back to Active". Backlog,
  proposal and closed cards have neither.
- When `readyForDone` is true, then the Active card shows "Ready for Done".
  When it is false, or tracking is `needs_github`, the badge is absent.
- When "Move to Done" is pressed with tracking off, or with no missing part,
  then the card shows in Done at once with no dialog, and a "Moved #N to Done"
  toast offers Undo.
- When Undo is pressed within 5 seconds, then the card returns to Active and
  no request is sent. When the 5 seconds pass, or another move starts, then
  `moveToDone` is sent without a reason.
- When "Move to Done" is pressed with tracking `ready` and missing parts, then
  the dialog lists each missing part with its row status. Its confirm button
  is disabled until a non-blank reason is typed. Confirming sends the move
  with that reason at once.
- When a move sent without a reason comes back `REASON_REQUIRED`, then the
  brief is read again and the dialog opens on the fresh parts.
- When "Move back to Active" is pressed, then a reason is required, and
  confirming sends `moveBackToActive` at once with no Undo.
- When the server answers a final refusal, then the panel shows its sentence,
  reloads the board and does not retry.
- When a move lands, then the board and any open detail show the brief in its
  new column.
- When a Done brief's detail opens, then it reads "Done: reason · date", or
  "Done · date" with no reason.
- When History shows the four move kinds, then each reads as its sentence
  above. When it shows an old automatic `done` event, then it reads "This
  brief is done: every part is merged into `<target>`."
- When a brief is moved back to Active, then its parts offer Begin or Run
  again by their state, and the next read reports any branch or completion
  the cloud lacks.
- When the Done column is shown, then its hint reads "Move a brief here when
  its work is finished."

## Out of Scope

- FrameCloud's own `brief-manual-done`, which is built on its side.
- Dragging cards between columns.
- Phase 2, GitHub tracking: PR and review states, the tracking setting,
  `mergeTracking: off` and webhooks.
- Roles narrowing who can move a brief.
- Drop part and Link commit in Frame.
- A History sentence for `part-merged`, a brief-done leftover that still
  reads "changed this brief".

## Open Questions

- **A held move when Frame quits or the view goes away.** The web accepted
  that a tab closed inside the 5 seconds may lose the move (FrameCloud D1).
  Options:
  - (a) Send the held move at once when Frame quits, the project changes or
    the Briefs view closes. This needs the hold, or a flush hook, in main.
  - (b) Keep the hold in the renderer and accept the web's trade-off: a quit
    inside 5 seconds drops the move, and the card is back in Active on the
    next read.
