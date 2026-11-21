---
keywords: frame cloud, manual done, move to done, move back to active, done reason, ready for done, undo, briefs panel
related: frame-cloud-brief-done, frame-cloud-brief-discussions, frame-cloud-brief-start
---
Frame's half of FrameCloud's brief-manual-done: Done is a person's move. Briefs shows "Move to Done" on Active started work and "Move back to Active" on Done work, on the card (beside an open lane link) and in the detail; Backlog, proposals and closed briefs get neither.
Calls: `moveToDone` / `moveBackToActive` through `moveThrough` in `cloudBriefs.js` (refusals in `MOVE_REFUSALS`; a blank reason is never sent; a blank move back is refused before sending). `normalizeBrief` carries `doneAt`, `doneBy`, `doneReason` and `readyForDone`.
A reason is asked when tracking is `ready` and a live part is not merged on the target (`copy.needsReason` / `missingParts`), and on every move back; the dialog sends at once. Otherwise the card shows in Done with a "Moved #N to Done" toast and Undo for `HOLD_MS` (5 s) while main holds the send.
The hold lives in main (`src/shared/cloudMoveHold.js`, D1) because Frame owns its process: the send fires on timeout, on another move, or at quit (`before-quit`, capped at 3 s). Rejected: the web's renderer-side hold, which drops a move when the window closes inside the 5 seconds.
Built differently from the plan: the brief id is read inside the held send (an Undo during that read still cancels, and an undone move sends nothing); `flush` waits on sends already under way; the `moving` overlay is keyed by folder and number; a landed move stays Done in the cache until the re-read; the Ready for Done badge also hides under `needs_github`.
Rules: a Done brief's parts keep their words but offer no Begin or Run (`partStatus({ done })`); a held move answered `REASON_REQUIRED` re-reads and opens the dialog; final refusals show the web's sentence, reload and are never retried; an old automatic `done` event reads "This brief is done: every part is merged…" with no actor; `part-merged` still reads "changed this brief". The words are the web's, verbatim.
Overturned: brief-done's "Done means merged / fills on its own", "no Frame call marks a brief Done" and "normalizeBrief does not carry doneAt"; the page's drag, replaced by a button (FrameCloud D3/D4).
Walked by the developer against local FrameCloud on 2026-11-08, every criterion working. Unit tests cover the pure logic only; the panel passed a 49-check Electron harness in T07.

Chain: spec.md → plan.md → tasks.md → outcome.md
