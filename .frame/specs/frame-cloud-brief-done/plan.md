# Plan — Frame Cloud brief done

## Architecture

### Resolved plan-time decisions

Business (asked):

- **D1 · The local finish's name → "Implemented".** A spec at `done` or a
  task at `completed` that is not merged reads "Implemented".
  - Rejected: "Ready for PR", which would stay on after a PR opens, because
    Frame has no PR data until brief-pr.
  - Rejected: "Done locally", which keeps "Done" for something other than a
    merge.
- **D2 · GitHub not connected → a one-line notice on the board.** When the
  project's `mergeTracking` is `needs_github`, the board shows "Merges are
  tracked once GitHub is connected." with an "Open on the web" link. The link
  opens the project page, where the web's own notice offers Connect GitHub.
  - Rejected: leaving it to the web, because then Frame's parts would sit at
    "On <branch>" with no reason given.
- **D3 · Parts begun before this feature → completion only.** They get no
  backfilled `recordBranch`.
  - The completion flow reads them through this machine's begun branch in
    `cloud-starts.json`, and the cloud accepts `recordCompletion` without a
    branch.
  - Cost: no branch in the cloud for these parts, and no false-merge guard.
  - Rejected: guessing the base with `git merge-base`, which can be wrong
    once the target has moved.
- **D4 · Warning when the base differs from the target → not in this spec.**
  Begin's branch rules stay out of scope. The warning is a separate, small
  change.

Technical (asked):

- **D5 · Noticing a finish → read the part's branch tip through git, on
  every Briefs read.**
  - When the Briefs list or a brief's detail is read (panel shown, window
    focus, Retry, reload), main reads each candidate part's record at its
    branch tip with `git show <tip>:./<tasks path>`, without a checkout.
  - It works from any checked-out branch. It re-reads only when the tip
    moved.
  - No webhook and no background watcher. The local finish lives only on
    this machine, often unpushed, so GitHub could not report it. The merge
    side is already checked by the cloud inside the same reads (FrameCloud
    C18).
  - Rejected: reading only the open checkout, which misses a part finished
    before a branch switch.
- **D6 · A call that fails → resend the difference on the next read.**
  - There is no queue. Each read compares what the cloud shows (`branch`,
    `completionSha`) with what this machine knows, and sends only what is
    missing or older. The cloud ignores repeats.
  - This follows the earlier cloud specs: failures are not held offline
    (frame-cloud-brief-discussions keeps "holding records locally while
    offline" out of scope), and a read's Retry is the way back.
  - A background call shows no message of its own. When Frame is offline,
    the panel's read fails first and shows its existing error and Retry.
    Other failures are logged.
  - Rejected: a queue in `cloud-starts.json`, which replays stale calls
    after a drop or a re-Begin elsewhere.
- **D7 · Test posture → pure logic only.** This matches the project
  convention (the `## Testing` record: pure modules tested, Electron shells
  and DOM code not). Covered: the normalizers, the request functions, the
  row and summary words, the begun entry, and the reporter's decisions.

Technical (silent, single defensible answer):

- **D8 · Reporting runs after the read answers.**
  - `list` and `get` return first. Then main runs the reporter for that
    folder, so the board never waits on git, or on the GitHub `compare`
    that `recordCompletion` runs (about 2 s per call in FrameCloud's walk).
  - When a send succeeds, main pushes `CLOUD_BRIEFS_CHANGED`, and the panel
    reloads.
  - The loop ends because the next read finds nothing to send. A failed send
    pushes nothing.
  - The reporter is single-flight per folder: a read that arrives while a
    report runs starts none.
- **D9 · Begin sends `recordBranch` itself.**
  - Right after create-and-checkout, `baseSha` is `HEAD` (the commit the
    branch was cut from, `gitBranchesManager.getHeadSha`).
  - The begun entry in `cloud-starts.json` stores it beside `branch`.
  - After the part is recorded as begun, the core calls
    `deps.recordBranch({ id, partId, branch, baseSha })` without awaiting
    it. A failure never reaches Begin's answer (spec: Begin is unchanged),
    and D6 resends it.
- **D10 · `recordBranch` is resent only while the cloud has no branch.**
  Resending whenever the cloud differs would let a stale entry on this
  machine overwrite another machine's re-Begin. Begin itself always sends,
  because the cloud lets a live part's branch be replaced.
- **D11 · Which branch to read for a completion.**
  - The cloud's `branch`, when this folder has it.
  - Else this machine's begun branch (D3).
  - Else nothing: the machine that holds the branch reports it.
- **D12 · When a completion is sent.** Let *tip* be the branch's commit and
  *stored* the cloud's `completionSha`. Send when:
  - the part's record is finished at *tip* (D13), and
  - *stored* is null, or
  - *stored* ≠ *tip*, *stored* is a commit this repository knows, and
    *stored* is not at or after *tip* (`git merge-base --is-ancestor tip
    stored` fails).

  An unknown *stored* means another machine's newer work, so nothing is
  sent. A rebased branch, whose old *stored* is not after the new *tip*, is
  sent.
- **D13 · "Finished" at a tip mirrors `specManager.derivePhase`.**
  - A spec part is finished when the tip's `tasks.json` holds at least one
    task whose `source` starts with `spec:<slug>:`, and every such task is
    `completed`.
  - A task part is finished when its row is `completed`.
  - `status.json` is not read, because the phase is derived from tasks. The
    answer is memoized by (tip, ref), and the tasks path is the folder's
    resolved `tasks.json`, relative to the folder.
- **D14 · Candidates for reporting.**
  - Only Active briefs: started, not Done, not closed.
  - Only parts with a `recordRef` that are not dropped and do not count as
    merged.
  - The cloud's final refusals stop on their own: after `PART_DROPPED` or
    `PART_MERGED` the next read filters the part out, and `NOT_STARTED`,
    `ALREADY_DONE` and `ALREADY_CLOSED` cannot arise for an Active brief.
    So there is no local memory of refusals.
- **D15 · Begin again is kept (frame-cloud-brief-start T17).**
  - `withBegunBranches` also sets `branchGone` when this machine's own entry
    names the cloud's `branch` and that branch is gone locally. The row then
    offers Begin again.
  - A cloud branch begun elsewhere reads "On <branch>", without Begin.
- **D16 · Tones.**
  - Merged takes the existing `done` tone. `partsSummary` already counts
    that tone, so it now counts merges.
  - New tones: `implemented` and `dropped`.
  - The summary keeps its "in progress" and "on another branch" pieces.
- **D17 · Only the fields Frame shows are read.**
  - Parts gain `branch`, `completionSha`, `mergedAt`, `mergedBase`,
    `droppedAt` and `dropReason`. Briefs gain `mergeTracking`.
  - `mergeSha`, `mergeEvidence` and `doneAt` are not read: `status: 'done'`
    already places the card.
  - Board parts still come from one `brief.getByNumber` per shaped brief
    (`addPartCounts`). The parts that `brief.list` now carries are left
    unused.

### Data shapes

The begun entry in `<userData>/cloud-starts.json` gains a `baseSha` field,
optional for older entries:

```
"<projectId>:<number>:<partId>": { "ref", "branch", "begunAt", "baseSha"?: "<40 hex>" }
```

A part as Frame normalizes it:

```
{ id, position, title, shape, type, definition, key, recordRef,
  branch, completionSha, mergedAt, mergedBase, droppedAt, dropReason }   // new six: string | null
+ begunBranch, branchGone                                                 // added by withBegunBranches
```

The reporter core (`cloudDone.js`, pure) is given its inputs:

```
plan({ briefs, begun(number, partId), localBranches }) →
  { branches:    [{ id, number, partId, branch, baseSha }],     // D10
    completions: [{ id, number, partId, ref, shape, branch, stored }] }   // D11, D14
isFinished({ shape, ref, tasks }) → boolean                                  // D13
completionDue({ stored, tip, storedKnown, tipAtOrBeforeStored }) → boolean   // D12
```

### Flows

1. **Begin.** The order of `handleStartRequest` is unchanged: cloud, stash,
   branch, files, then `recordBegun`. After that, two new steps:
   - `recordBegun` now carries `baseSha` from `deps.headSha()`, read after
     `createBranch`.
   - `deps.recordBranch(...)` fires and is not awaited.

   `cloudStartService` wires `headSha` to `git.getHeadSha` and
   `recordBranch` to `call(cloudBriefs.recordBranch)`.
2. **Read, then report.** `cloudBriefsService.list` and `get` answer as
   today, plus `mergeTracking` from `list`. Then they call
   `cloudDoneService.report(folderPath, project, briefs)`, which:
   1. returns at once when a report is running for that folder;
   2. lists the local branches;
   3. runs `plan`;
   4. sends each due `recordBranch`;
   5. for each completion candidate: resolves the tip, checks D12 with git,
      reads the record at the tip only when the tip moved, and sends the due
      `recordCompletion`;
   6. pushes `CLOUD_BRIEFS_CHANGED { folderPath }` when any send succeeded.

   The panel reloads the board, and the open detail, on that push.
3. **Rows.** `partFacts(part, brief)` passes `target: brief.targetBranch` to
   `copy.partStatus`, which reads in this order:

   | # | When | Label | Tone | Run |
   |---|---|---|---|---|
   | 1 | no `recordRef` | (empty) | | |
   | 2 | dropped | "Dropped · <reason>" | `dropped` | none |
   | 3 | `countsAsMerged(part, target)` | "Merged into <target>" | `done` | none |
   | 4 | local record, with a live lane | the lane's state, as today | | |
   | 5 | local record, no lane | the record's own state, with `done` / `completed` → "Implemented" | `implemented` | none |
   | 6 | a cloud `branch`, unless `branchGone` | "On <branch>" | `elsewhere` | |
   | 7 | `begunBranch` | "On <branch>" | | |
   | 8 | otherwise | Not started | | Begin |

   - `countsAsMerged(part, target)` means `mergedAt` is set and
     `mergedBase === target` (the web's rule).
   - `partsSummary` reads `<done> of <live> merged`, then the existing
     pieces, then `· <n> dropped`. A brief with fewer than two parts shows
     none of it, as today.
4. **Notice.** When the list's `mergeTracking` is `needs_github` and any
   brief is Active, the board shows `copy.MERGE_TRACKING_NOTICE` above the
   columns, with an Open on the web button (`CLOUD_BRIEFS_OPEN_ON_WEB`
   without a number). It is not dismissible: it states the project's state.

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified.**
  - `normalizePart` gains the six part fields, and `normalizeBrief` gains
    `mergeTracking`.
  - `partRow` carries the part fields to the board.
  - New `recordBranch` and `recordCompletion` (POST
    `brief.recordBranch` / `brief.recordCompletion`), returning the
    normalized detail.
- `src/main/cloud/cloudDone.js` — **New.** The pure reporter core: `plan`,
  `isFinished`, `completionDue`, `countsAsMerged`.
- `src/main/cloud/cloudDoneService.js` — **New.** The Electron shell:
  - `report(folderPath, project, briefs)`, single-flight per folder;
  - git reads through gitBranchesManager;
  - the sends through `cloudProjectsService.call`;
  - the `CLOUD_BRIEFS_CHANGED` push;
  - `init(window)`.
- `src/main/cloud/cloudBriefsService.js` — **Modified.** `list` returns
  `mergeTracking`, and `list` and `get` start a report after answering.
- `src/main/cloud/cloudStart.js` — **Modified.**
  - `baseSha` in `normalizeBegunEntry`, `addBegun` and `getBegun`.
  - `branchGone` in `withBegunBranches`.
  - `handleStartRequest` reads `deps.headSha()` and fires
    `deps.recordBranch`.
- `src/main/cloud/cloudStartService.js` — **Modified.** It wires
  `headSha` and `recordBranch` into the start deps, and exports
  `begunEntry(projectId, number, partId)` for the reporter.
- `src/main/gitBranchesManager.js` — **Modified.** New helpers:
  - `branchTipSha(projectPath, name)`
  - `showFileAt(projectPath, ref, relPath)`
  - `commitExists(projectPath, sha)`
  - `isAncestor(projectPath, a, b)`

  All four go through `execGitArgs`.
- `src/main/index.js` — **Modified.** `cloudDoneService.init(window)`.
- `src/shared/ipcChannels.js` — **Modified.** `CLOUD_BRIEFS_CHANGED` (main →
  renderer: `{ folderPath }`).
- `src/renderer/cloudBriefsCopy.js` — **Modified.**
  - `countsAsMerged` and the new `partStatus` order and labels.
  - `IMPLEMENTED_LABEL`, and the merged and dropped labels.
  - `partsSummary` with merged and dropped.
  - `MERGE_TRACKING_NOTICE` and `OPEN_ON_WEB_LABEL`.
- `src/renderer/cloudBriefsPanel.js` — **Modified.**
  - `partFacts(part, brief)` with the target.
  - The tracking notice above the columns.
  - Reloads on `CLOUD_BRIEFS_CHANGED`.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** The
  `tone-implemented` and `tone-dropped` rows (a struck-through title for a
  dropped part), and the tracking notice.
- `test/cloudBriefs.test.js` — **Modified.** The new part and brief fields,
  and the two request functions with their inputs.
- `test/cloudBriefsCopy.test.js` — **Modified.** The `partStatus` order, the
  labels and tones, `countsAsMerged`, and `partsSummary`.
- `test/cloudStart.test.js` — **Modified.**
  - `baseSha` in the begun entry, and `branchGone`.
  - Begin calls `recordBranch` once with the base SHA.
  - A failing `recordBranch` leaves Begin's answer unchanged.
- `test/cloudDone.test.js` — **New.** `plan`, `isFinished` and
  `completionDue`.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudDone.js
- src/main/cloud/cloudDoneService.js
- src/main/cloud/cloudBriefsService.js
- src/main/cloud/cloudStart.js
- src/main/cloud/cloudStartService.js
- src/main/gitBranchesManager.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudBriefsCopy.test.js
- test/cloudStart.test.js
- test/cloudDone.test.js

## Dependencies

None. The server side is FrameCloud's `brief-done` (merged on its `main`
as #25). Its procedures must be running on the server Frame talks to; the
walk uses a local FrameCloud server.

## Sequencing

1. **Read the Done fields.**
   - In `cloudBriefs.js`: `normalizePart` gains `branch`, `completionSha`,
     `mergedAt`, `mergedBase`, `droppedAt` and `dropReason` (string or
     null). `normalizeBrief` gains `mergeTracking` (`ready` |
     `needs_github`, default `ready`).
   - `partRow` carries the six fields.
   - Add `recordBranch({ …ctx, id, partId, branch, baseSha })` and
     `recordCompletion({ …ctx, id, partId, sha })`, each a POST that
     returns the normalized detail.
   - Tests in `test/cloudBriefs.test.js`: the new fields, null for absent
     ones, each request's name, method and input.
2. **Part rows read the cloud.**
   - In `cloudBriefsCopy.js`: `countsAsMerged`, then `partStatus` with
     `target` in the order of Flow 3. "Implemented" replaces the local
     "Done" in `specState` and `taskState`, with tone `implemented`. The
     dropped label is "Dropped · <reason>", with tone `dropped`. The merged
     label is "Merged into <target>", with tone `done`.
   - `partsSummary` counts the merged parts out of the live ones, and adds
     the dropped count.
   - In `cloudStart.js`: `withBegunBranches` sets `branchGone`.
   - In `cloudBriefsPanel.js`: `partFacts(part, brief)` is used on the card
     and in the Parts tab.
   - CSS: the two new tones.
   - Tests in `test/cloudBriefsCopy.test.js`: every row of Flow 3, a merged
     part with a live lane, merged on an old target, and the summary
     "1 of 3 merged · 1 dropped" (four parts).
   - Tests in `test/cloudStart.test.js`: `branchGone` for this machine's
     gone branch versus another machine's branch.
3. **The GitHub-not-connected notice.**
   - `cloudBriefsService.list` returns `mergeTracking`, taken from the
     listed briefs (`ready` when there are none).
   - The copy gets `MERGE_TRACKING_NOTICE` ("Merges are tracked once GitHub
     is connected.") and `OPEN_ON_WEB_LABEL`.
   - The panel shows the notice above the columns while an Active brief
     exists and tracking is `needs_github`. Its button opens the project on
     the web.
   - CSS for the notice.
4. **Begin records the branch.**
   - In `cloudStart.js`: the begun entry keeps an optional 40-hex `baseSha`
     (`normalizeBegunEntry`, `addBegun`, `getBegun`).
   - `handleStartRequest` reads `deps.headSha()` after `createBranch`,
     passes it to `recordBegun`, and fires
     `deps.recordBranch({ id: brief.id, partId, branch, baseSha })`. The
     call is not awaited and is caught. It is skipped when there is no
     `baseSha`.
   - `cloudStartService` wires `headSha` to `git.getHeadSha` and
     `recordBranch` to `cloudProjectsService.call(cloudBriefs.recordBranch)`,
     and exports `begunEntry`.
   - Tests in `test/cloudStart.test.js`, in both 'start' and 'begin' modes:
     - `recordBranch` is called once with the branch and the base SHA;
     - a rejecting `recordBranch` leaves the answer unchanged;
     - an old entry without `baseSha` normalizes.
5. **The reporter core.** `src/main/cloud/cloudDone.js`:
   - `plan` (D10, D11, D14);
   - `isFinished` (D13);
   - `completionDue` (D12);
   - `countsAsMerged`, shared with the copy's rule.

   Tests in `test/cloudDone.test.js`:
   - `plan`:
     - only Active briefs and live, unmerged parts with a ref;
     - a dropped part, a merged part and a merged-on-old-target part;
     - a branch is sent only while the cloud has none and the entry has
       `baseSha`;
     - the cloud branch is preferred, with the begun branch for older
       parts;
     - a branch this folder lacks yields nothing.
   - `isFinished`: a spec with all tasks completed, one pending, none at
     all, and a task part.
   - `completionDue`: null stored, an equal tip, stored after the tip, an
     unknown stored, and a rebased tip.
6. **The reporter shell.**
   - `gitBranchesManager` gains `branchTipSha`, `showFileAt`,
     `commitExists` and `isAncestor`.
   - New `cloudDoneService.js`:
     - `report` is single-flight per folder;
     - each tip is resolved once, and the record is read at the tip
       (memoized by tip and ref);
     - the due calls are sent through `cloudProjectsService.call`;
     - failures are logged;
     - `CLOUD_BRIEFS_CHANGED` is pushed when a send succeeds.
   - `CLOUD_BRIEFS_CHANGED` is added to `ipcChannels.js`.
   - `cloudBriefsService.list` and `get` start a report after answering.
   - `index.js` inits the service.
   - `cloudBriefsPanel.js` reloads the board, and the open detail, for the
     current folder on the push.
7. **Walk it against a local FrameCloud server**, in a project connected to
   a repository that GitHub can see:
   1. Begin a part and check that the cloud shows its branch on the web.
   2. Finish the spec, switch to another branch, focus the Briefs view, and
      check that the completion is sent from the branch tip.
   3. Merge into the target and push. On the next focus the part reads
      "Merged into <target>", and with the last live part the brief moves
      to Done.
   4. Repeat once offline: a Begin while signed out, then the branch arrives
      on the next read.
   5. Check the needs-GitHub notice in a folder-linked project with no
      installation.
