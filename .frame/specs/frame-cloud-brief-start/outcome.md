# Outcome — Frame Cloud brief start

## T01 — Read started briefs

Added `startedAt`/`recordRef` normalizing, `startBrief`, `START_REFUSALS` (seven codes, including `RECORD_REF_TAKEN`) and `startThrough` (returns `{ ok, detail }`) to `cloudBriefs.js`. Added the `started` history sentence and `startedLine` to `cloudBriefsCopy.js`, both checked against FrameCloud `feat/brief-start` (`data.count`). The Parts tab joins Shaped and Started on one line and shows `recordRef` as muted text on each part row, reusing existing classes, so no CSS changed yet. Files: cloudBriefs.js, cloudBriefsCopy.js, cloudBriefsPanel.js, and both test files.

_Captured: 2026-09-25 · 5 file change(s)_

---

## T02 — The pure builders

Wrote `cloudStart.js` with the pure builders and exported `TRANSLITERATE` from `cloudProjects.js`, tested in the new `test/cloudStart.test.js`. Deviations from plan.md: `specFiles` takes `slug`, which the required status.json needs; `-2`/`-3` spec slugs are shortened to stay within 48 characters; the definition splitter skips `## ` lines inside code fences; the fallback part number counts from 1. Also exported `taskTitle` (the 60-character cut) so it is tested on its own.

_Captured: 2026-09-25 · 3 file change(s)_

---

## T03 — The prepare view and the request handler

Added `pickBase`, `prepareView` and `handleStartRequest` to `cloudStart.js`, tested with fakes, including that the refs sent equal the refs written. Deviations: `prepareView` takes no `specSlugs`/`taskIds` (the dialog shows no refs); the handler reads the brief itself through `call`, and an unknown `beginPartId` is a `badRequest` refusal. `stash: true` on a clean folder stashes nothing, and `stashMessage` is then null. Refusals carry `detail` (the branch name, the target branch, or the parse reason) for the copy to name.

_Captured: 2026-09-25 · 2 file change(s)_

---

## T04 — Git helpers

Added `currentBranch`, `remoteBranchExists` and `stashAll` to `gitBranchesManager.js`, exported `localBranchExists`, and gave `createBranch` a trailing `{ track }` option that adds `--no-track`. Checked by hand against a scratch repo: `stash -u` took an untracked file, and a branch cut from `origin/dev` with `track: false` has no upstream. `currentBranch` returns '' on a detached HEAD.

_Captured: 2026-09-25 · 1 file change(s)_

---

## T05 — The service and its wiring

Wrote `cloudStartService.js` (`prepare`, `start`, `init`, `setupIPC`), added the two IPC channels, and wired the service in `index.js`. Deviations: `index.js` also calls `cloudStartService.init(window)` so the service can push `TASKS_DATA` after writing rows (tasksManager hides its own writes from the watcher). The spec and task writes refuse to overwrite a folder or id that the new branch already holds, which surfaces as `partial`. Followup: allocation reads the current branch's `.frame/`, not the base's; checking the base tree too (`git ls-tree`) would avoid that partial.

_Captured: 2026-09-25 · 3 file change(s)_

---

## T06 — The Start Work words and button

Added `workStage` `'start'` and the Start Work copy (labels, dialog words, `startErrorMessage`, `partialMessage`, `startedNotice`, `partProblemMessage`, part link labels) to `cloudBriefsCopy.js`, and a primary Start Work button on the card and in the detail in `cloudBriefsPanel.js`. Deviation: `startErrorMessage` takes the refusal object (`{ reason, part, detail }`), not a bare reason. One existing assertion (shaped work → `'none'`) was updated to a started brief, because the spec overturns it. The button clicks are wired with the dialog in T07.

_Captured: 2026-09-25 · 3 file change(s)_

---

## T07 — The Start Work dialog

Wrote `cloudStartDialog.js` (prepare, choices, a branch field that follows the choice until edited, base line, problems, the dirty warning, and refusal/partial sentences), wired Start Work's clicks in `cloudBriefsPanel.js` with the `startedNotice` toast and a reload, and added the dialog's styles to `cloud-briefs.css`. Begin with the first part is the default choice. A `dirty` answer from start reopens the warning instead of stashing. After `partial` the confirm is removed and the board reloads.

_Captured: 2026-09-25 · 3 file change(s)_

---

## T08 — Open the Begin lane

Exported `runTaskWithOptions` from `tasksPanel.js` and added `openBeginLane` to `cloudBriefsPanel.js`: `/spec.plan` through `dispatchSpecCommand` for a spec part, and the task run with `branchMode: 'current'` then `UPDATE_TASK` `in_progress` for a task part. Create only opens nothing. The lane uses the current AI tool (the dispatch default), as planned.

_Captured: 2026-09-25 · 2 file change(s)_

---

## T09 — Link part rows to their records

Added `showSpec` and `showTask` to `agentDispatch.js`. The Parts tab's plain-text `recordRef` from T01 is now a link that opens the spec in the Specs grid or the task on the Tasks board. Beyond plan: a task link whose id this folder does not hold shows a toast (`partNotHereMessage` in `cloudBriefsCopy.js`, tested). A missing spec opens the grid's empty drawer as `specsDashboard` does today.

_Captured: 2026-09-25 · 5 file change(s)_

---

## T11 — A started brief's progress on the card and in the Parts tab

Added T11 after the first walk (the Active card only counted parts): the decisions are appended to plan.md as an addendum. `addPartCounts` now also returns part rows, and `partStatus`/`partsSummary` in `cloudBriefsCopy.js` hold the rules. `cloudBriefsPanel.js` draws a row per part on started cards and in the Parts tab, kept live by `SPEC_DATA`, `TASKS_DATA` and lane activity. `agentDispatch.enterLane` was added for the row's lane link. Run dispatches the spec's next command by phase or opens the task's Run modal.

_Captured: 2026-09-25 · 7 file change(s)_

---

## T12 — Record begun parts on this machine

Added the begun store to `cloudStart.js`, its `<userData>/cloud-starts.json` file to `cloudStartService.js` (`recordBegun`, `withBegunBranches`), and `begunBranch` on each listed part in `cloudBriefsService.list`. Keys are `<projectId>:<number>:<partId>`, and malformed entries are dropped on read. Nothing records a begun part yet: T13 calls `recordBegun`.

_Captured: 2026-09-25 · 4 file change(s)_

---

## T13 — Begin one part

Rewrote `handleStartRequest`/`prepareView` in `cloudStart.js` for one part at a time: 'start' mode reserves every ref in one `brief.start` and writes only the chosen part, and 'begin' mode writes a started brief's part under its reserved ref with no cloud call. Both record the part through `recordBegun`, and `alreadyBegun` refuses a part whose recorded branch still exists. The result gains `mode` and `part`, and `specs`/`tasks` are 0 or 1. The dialog still expects the old view shape until T14.

_Captured: 2026-09-25 · 3 file change(s)_

---

## T14 — The dialog for one part, with a branch row and base picker

Rewrote the Start Work dialog for one part: a Begin-with choice per part with Orchestrate (Coming soon) disabled, a single-part and Begin mode, and a branch row with an editable name chip and a "from <base> ⌄" menu (filterable, local then origin, defaulting to the target). Added `baseOptions` and chosen-`base` handling to `cloudStart.js`, `loadBranches` in prepare, and the new copy; `startedNotice` now names the part and its branch. Nothing opens Begin yet: T15 wires it to the part rows.

_Captured: 2026-09-25 · 7 file change(s)_

---

## T15 — Part rows for begun and unbegun parts

Replaced Not on this branch with On `<branch>` (from the begun store) and Not started · Begin in `partStatus`. Wired Begin to the dialog's Begin mode, and gave the detail's parts `begunBranch` through `cloudBriefsService.get`. Titles link only to records this folder holds. Brief #1 of the first walk was started with the old all-parts flow and has no begun entries, so its rows read Begin away from `feat/eval-harness-…`.

_Captured: 2026-09-25 · 5 file change(s)_

---

## T16 — A part's short key from Shape

Shape now asks for a short title, a kebab-case `key` and a type chosen by the work the part does, and FrameCloud stores the key (`brief-start` T09 there). Frame suggests the spec slug, task id and `<prefix>/<key>` branch from the key, and otherwise cuts the title's slug at a word boundary (32 for a branch, 48 for a slug). Deviation: `src/templates/bin/shape-brief.js` (outside the plan's Files) also validates and passes `key`, since it rebuilt each part from known fields and would have dropped it. Also replaced literal combining characters in `slugify`'s regex with `\u0300-\u036f` escapes.

_Captured: 2026-09-25 · 9 file change(s)_

---

## T17 — Ignore a begun part whose branch is gone

Fixed a walk finding: a begun entry whose branch was deleted kept its part in "On <branch>" on the card and alreadyBegun in the dialog. `withBegunBranches` now filters by the folder's local branches, in the board list, the brief detail and the dialog's prepare alike. The record file is left as it is. Followup: the board learns of a deleted branch only on its next load (focus or Refresh); listening for branch changes would make it immediate.

_Captured: 2026-09-25 · 5 file change(s)_

---

## T10 — Walk Start Work in Frame

Walked twice in the dev build against FrameCloud `feat/brief-start`. The first walk (all parts on one branch) worked end to end but showed that model pins every part to one branch and names from long titles, which led to the one-part revision (T12–T15) and Shape keys (T16). The second walk confirmed a key-named part (`multi-model-judge`), a single part per branch, the On `<branch>` and Begin rows, and found the deleted-branch bug fixed in T17. The user walked the remaining cases and reported them passing.

_Captured: 2026-09-25 · 2 file change(s)_

---

