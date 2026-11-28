# Plan — Frame Cloud GitHub tracking

## Architecture

### Resolved plan-time decisions

Business (asked):

- **D1 · Where PR states sit in a part row → a live lane wins, then the PR.**
  - If the folder holds an unfinished record and a live agent lane, the row
    shows the lane's state ("Working", "Needs approval", "Awaiting input")
    with its lane link.
  - Otherwise, while tracking is `ready`, a PR beats the record's own state.
  - Why: after "Changes requested" a person can add a new task to the part.
    An agent then works on it, and the lane link has to stay the way in.
  - Rejected: the PR always wins. It hides a running agent's lane in exactly
    that case.
- **D2 · Refresh from GitHub → not in Frame.** This overturns the spec's Goal
  "Refresh from GitHub" and S10.
  - Why: it is one more button and one more thing to learn, for a rare case
    (a lost webhook). The user accepts the risk.
  - The server's 10-minute fallback and the web's own Refresh button still
    cover that case.
  - Consequences: Frame never calls `brief.refresh`, adds no IPC channel and
    no refresh state, and does not port the `TRACKING_OFF` refusal sentence.
    C8 (the `work` procedure and roles) becomes moot.
  - Rejected: Refresh in the detail's Parts tab, as on the web.
- **D3 · The permission-pending state → Frame shows nothing.** While the
  GitHub App waits for Pull requests · read, the PR fields are simply absent
  and rows fall back.
  - Why: the user said Frame Cloud is not live, the team is the only user,
    and the old records were deleted.
  - Frame does not read `project.githubTracking`.
  - Rejected: repeating the web's "GitHub permission pending" badge.
- **D4 · The board notice → the web's current box, for both states, word for
  word.**
  - `off`: "GitHub tracking is off" · "Pull requests and merges are not
    tracked. Turn it on in Settings."
  - `needs_github`: "Not connected to GitHub" · "Pull requests and merges are
    not tracked. Connect GitHub in Settings."
  - In both, "Open on web" opens the project's Settings at its GitHub
    section.
  - Why: the user said "Frame must speak the same language as the web".
  - This overturns two things:
    - the spec's quoted notice, which is really the web's `TRACKING_OFF`
      refusal sentence (`lib/brief.ts:639`);
    - frame-cloud-brief-done D2's "Merges are tracked once GitHub is
      connected.", which linked to the project page.
  - Rejected: the spec's sentence for `off` only, leaving `needs_github`
    unchanged.
- **D5 · `needs_github` reads like `off`, as on the web** (follows from D4).
  - Whenever tracking is not `ready`:
    - a part whose completion the cloud recorded reads "Implemented";
    - the summary reads "N of M implemented", where a merged part counts as
      implemented.
  - This is the web's `partRow` / `partsSummarySegments` rule for
    `tracking !== 'ready'`.
  - It relaxes C7/S11 ("an older server … rows read as today") for
    `needs_github`.
  - Rejected: `off` only, as the spec was written.

Technical (asked):

- **D6 · Test posture → pure logic only.**
  - Covered: `cloudBriefs.js` (normalizers, `mergeTrackingOf`, the Settings
    URL) and `cloudBriefsCopy.js` (row order, summary, attention line,
    history sentence, notice words).
  - The panel stays untested. This matches the `## Testing` record and the
    spec's C9.

Technical (silent, single defensible answer):

- **D7 · A PR row keeps the record's Run** (follows from D1).
  - With no live lane, the PR takes the label and the tone. The folder's
    unfinished record still offers its next step, so a task added after
    "Changes requested" can run from the row.
  - When the folder does not hold the record, Run is null.
  - A Done brief still drops Run (C6, `partStatus({ done })`).
- **D8 · The cloud's completion reads "Implemented", after the folder's own
  record, in every tracking mode** (follows from D5 and the web's order).
  - The folder's record wins because it is more current once work restarts.
    The cloud keeps the earlier `completionSha` after a task is added.
  - So `completionSha` speaks only for a part the folder does not hold. Such
    a part used to read "On `<branch>`".
- **D9 · PR facts show only while tracking is `ready`** (the web's
  `partRow`). Under `off` or `needs_github` the cloud is not watching them.
- **D10 · Which PR fields are read.**
  - `normalizePart` reads five fields:
    - `prNumber`: a positive integer, or null;
    - `prState`: `open | closed | merged`, or null;
    - `prBase`: a string, or null;
    - `prReview`: `requested | approved | changes_requested`, or null;
    - `prUrl`: kept only when `isHttpUrl`, else null.
  - `partRow` carries all five onto the board's cards.
  - `mergeSha` and `mergeEvidence` are still not read (brief-done D17), so a
    merged row stays "Merged into `<target>`" (S8).
- **D11 · The status shape grows only on PR rows.**
  - A PR row adds `pr: { number, url, kind: 'review' | 'changes' |
    'offTarget', base }`. Every other row keeps today's
    `{ label, tone, laneName, run }`, so today's rows and their tests are
    unchanged.
  - One new tone, `review`. `attention` is reused with the web's meaning;
    the summary tells PR attention from lane attention by `pr`.
- **D12 · "PR #N" is a link, as the web draws it** (`brief-parts.tsx`
  `PartStatus`).
  - A row labelled "PR #N · …" shows the number as a link, then "· state".
  - The off-target row shows its label, then "PR #N".
  - A click is a new `open-pr` part action, handled in `onPartAction` for
    cards and the detail. It opens `pr.url` with `shell.openExternal`, and
    only when `isWebUrl` passes.
  - With no URL, "PR #N" is plain text. A Done brief keeps the link: it is a
    pointer, not an action.
- **D13 · Summary pieces.**
  - `ready`: "N of M merged · N in review · N changes requested · N
    implemented · N in progress · N on another branch · N dropped".
  - Not `ready`: "N of M implemented · N in progress · N on another branch ·
    N dropped".
  - Zero pieces are left out. The summary still shows only with two parts or
    more.
  - The spec names "implemented" as an existing piece, but Frame's summary
    had none (drift). The web's piece is added. Frame's own "in progress"
    and "on another branch" pieces stay (brief-done D16).
- **D14 · The card's attention line.**
  - `partAttention` reads the row statuses, so it never contradicts its
    rows: a part whose lane wins (D1) is not flagged.
  - Words are the web's K2 row: "Changes requested on `<title>`" or
    "`<title>` merged into `<base>`, not `<target>`", plus " · N more".
  - It shows under the card's parts, only on an Active card (web:
    `brief-board.tsx:279`). Without PR rows (not `ready`) it is empty.
- **D15 · "Ready for Done" shows only while tracking is `ready`.** Today the
  rule is `!== 'needs_github'`, which would show the badge under `off`.
- **D16 · The notice's place is kept from brief-done Flow 4.**
  - One line above the columns, only while an Active brief is listed, not
    dismissible.
  - Which state it shows comes from the board's `mergeTracking`
    (`needs_github` wins, S4).
- **D17 · The Settings link is built in main, over the existing channel.**
  - `buildSettingsWebUrl` returns `{project url}/settings#github`, the web's
    route and hash (`project-header.tsx:121-127`).
  - `openOnWeb(folderPath, target)` takes a brief number, `'settings'`, or
    nothing. `CLOUD_BRIEFS_OPEN_ON_WEB` carries it.
  - `canOpenWeb` still gates the button, since the Settings URL builds
    exactly when the project URL does.
- **D18 · `mergeTrackingOf` moves into the core and learns `off`.**
  - Rule: `needs_github` wins, then `off`, else `ready`, which also covers
    no briefs.
  - The service's header puts logic in `cloudBriefs.js`, and the move puts
    S4 under D6's tests.
- **D19 · `part-merged` gets the web's sentence and reads as observed.**
  - `“title” merged into <target> at <sha7> through PR #N`:
    - "A part" without a title;
    - no " into" without a target;
    - no " at" without a sha;
    - " through PR #N" only when `data.pr` is a number.
  - `isObserved` now covers `part-merged`, so it has no actor. This
    overturns frame-cloud-brief-manual-done D8.
- **D20 · Move to Done under `off` needs nothing new beyond keeping `off`.**
  `copy.needsReason` already keys on `ready`, so the existing hold-and-Undo
  path sends the move at once (S1).
- **D21 · `src/shared/ipcChannels.js` is in two in-flight footprints**
  (audit-q3-cross-platform, frame-cloud-early-access). This plan changes
  one comment there (D17's argument), so a collision is a one-line merge.

### Data shapes

A part as Frame normalizes it, with the five new fields last:

```
{ id, position, title, shape, type, definition, key, recordRef,
  branch, completionSha, mergedAt, mergedBase, droppedAt, dropReason,
  prNumber,   // int > 0 | null
  prState,    // 'open' | 'closed' | 'merged' | null
  prBase,     // string | null
  prReview,   // 'requested' | 'approved' | 'changes_requested' | null
  prUrl }     // http(s) string | null
```

A brief's `mergeTracking`, and the board result's, is
`'ready' | 'needs_github' | 'off'`, with `ready` for anything unknown.

A row status:

```
partStatus({ part, spec, task, lane, target, tracking = 'ready', done })
  → { label, tone, laneName, run }                                  // every row, as today
  + pr: { number, url, kind: 'review' | 'changes' | 'offTarget', base }   // PR rows only
tone: idle | active | attention | implemented | review | done | dropped | elsewhere
```

### Flows

1. **Rows.** `partStatusOf` reads in this order. `done` sets Run to null on
   every row.

   | # | When | Label | Tone | Run |
   |---|---|---|---|---|
   | 1 | no `recordRef` | (empty) | `idle` | none |
   | 2 | dropped | "Dropped · `<reason>`" | `dropped` | none |
   | 3 | `countsAsMerged(part, target)` | "Merged into `<target>`" | `done` | none |
   | 4 | the folder holds an unfinished record and a live agent lane | the lane's state, as today | `active` / `attention` | none (lane link) |
   | 5 | `ready`, a `prNumber`, `prState: 'merged'`, `prBase` set and ≠ target | "Merged into `<prBase>`, not `<target>`" | `attention`, `pr.kind: 'offTarget'` | the record's (D7) |
   | 6 | `ready`, a `prNumber`, `prState: 'open'` | "PR #N · Open" / "· In review" / "· Approved" | `review`, `pr.kind: 'review'` | the record's (D7) |
   | 6b | the same, with `prReview: 'changes_requested'` | "PR #N · Changes requested" | `attention`, `pr.kind: 'changes'` | the record's (D7) |
   | 7 | the folder holds the record | its own state (`done` / `completed` → "Implemented") | as today | as today |
   | 8 | `completionSha` | "Implemented" | `implemented` | none |
   | 9 | the cloud's `branch`, unless `branchGone` | "On `<branch>`" | `elsewhere` | none |
   | 10 | `begunBranch` | "On `<branch>`" | `elsewhere` | none |
   | 11 | otherwise | "Not started" | `idle` | Begin |

   A PR that is `closed`, or merged into the target before the part counts,
   falls through to row 7. `partFacts` passes `tracking: brief.mergeTracking`.

2. **Summary and attention.**
   - `partsSummary(statuses, tracking = 'ready')` counts as D13:
     - "in review": tone `review`;
     - "changes requested": `pr.kind === 'changes'`;
     - "implemented": tone `implemented`;
     - "in progress": tone `active`, or `attention` without `pr`.
   - Under not `ready`, the head counts tones `implemented` + `done`.
   - `partAttention(entries, target)` takes `[{ title, status }]` in part
     order and returns the first flagged sentence plus " · N more", or `''`.
   - The card calls both with its brief's `mergeTracking`, and calls
     `partAttention` only for an Active brief. The Parts tab's line calls
     `partsSummary` the same way.

3. **Board notice.**
   - `copy.trackingWarning(mergeTracking)` returns `{ title, description }`,
     or null for `ready`.
   - `renderTrackingNotice` draws the title, the description and, when
     `canOpenWeb`, "Open on web" (`data-action="open-settings-web"`).
   - That action invokes `CLOUD_BRIEFS_OPEN_ON_WEB(path, 'settings')`. Main
     opens `buildSettingsWebUrl` through `cloudSession.openUrl`.

4. **A PR link.**
   - The row's "PR #N" is a button carrying `data-action="open-pr"`, the
     row's `data-ref`, and `data-url` (escaped).
   - `onPartAction` handles `open-pr` with `isWebUrl`, then
     `shell.openExternal`.
   - Frame never composes a GitHub URL (C3).

5. **History.** `eventSentence` reads `part-merged` as an observed, whole
   sentence with no actor (D19). The History tab needs no change.

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified**.
  - `MERGE_TRACKING` gains `off`.
  - `normalizePart` and `partRow` carry the five PR fields (D10).
  - `mergeTrackingOf` moves in from the service (D18).
  - `buildSettingsWebUrl` (D17).
  - The header names what tracking adds.
- `src/main/cloud/cloudBriefsService.js` — **Modified**.
  - `list` uses `core.mergeTrackingOf`, and the local copy goes.
  - `openOnWeb` and its handler accept `'settings'`.
  - The header is updated.
- `src/shared/ipcChannels.js` — **Modified**. The `CLOUD_BRIEFS_OPEN_ON_WEB`
  comment documents `(path, number? | 'settings')` (D21).
- `src/renderer/cloudBriefsCopy.js` — **Modified**.
  - `partStatus` takes `tracking` and gains the PR rows, the `review` tone
    and the `completionSha` row (D1, D7–D9, D11).
  - `partsSummary` takes `tracking` (D5, D13). `partAttention` is new (D14).
  - The `part-merged` sentence and `isObserved` (D19).
  - `trackingWarning` replaces `MERGE_TRACKING_NOTICE` (D4).
  - The header comment is updated.
- `src/renderer/cloudBriefsPanel.js` — **Modified**.
  - `partFacts` passes `tracking`. `renderPartRow` draws the PR link, and
    `onPartAction` gains `open-pr` (D12).
  - The card and Parts-tab summaries pass `tracking`. The card's attention
    line (D14).
  - The notice takes the web's words and the Settings link (D4, D16, D17).
  - The Ready for Done rule (D15).
  - The header comment is updated.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified**.
  - The `tone-review` dot and label, and the PR link.
  - The card's attention line, and the notice's title.
- `test/cloudBriefs.test.js` — **Modified**.
  - `off` in `normalizeBrief`, and the PR fields with their guards
    (`prUrl` http(s) only).
  - `partRow` through `addPartCounts`, `mergeTrackingOf`, and
    `buildSettingsWebUrl`.
- `test/cloudBriefsCopy.test.js` — **Modified**.
  - The row order with PR, lane and completion cases, and the summary in
    both modes.
  - `partAttention`, the `part-merged` sentence and its observed reading,
    and the notice words.
  - The two assertions this overturns are replaced: lines 613 and 721–723.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudBriefsService.js
- src/shared/ipcChannels.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None.

## Sequencing

1. **Read `off` and the PR facts in the core.**
   - In `cloudBriefs.js`:
     - add `off` to `MERGE_TRACKING`;
     - add the five PR fields to `normalizePart` with D10's guards, and to
       `partRow`;
     - add `mergeTrackingOf(briefs)` (`needs_github` → `off` → `ready`) and
       `buildSettingsWebUrl`, and export both;
     - update the header.
   - In `test/cloudBriefs.test.js`:
     - extend the `mergeTracking` test with `off`;
     - cover each PR field: valid, unknown and missing values, a
       non-positive number, and a `javascript:` or `ftp:` `prUrl` folded to
       null;
     - check that the PR fields reach the board's `parts` through
       `addPartCounts`;
     - cover `mergeTrackingOf`: empty, all ready, `off`, and `needs_github`
       beside `off`;
     - cover `buildSettingsWebUrl`: a good URL, and null under
       `buildWebUrl`'s guards.
2. **Use them in main.**
   - In `cloudBriefsService.js`, call `core.mergeTrackingOf` and delete the
     local copy.
   - Let `openOnWeb(folderPath, target)` open `buildSettingsWebUrl` for
     `'settings'`, the brief URL for a number, and the project URL for
     nothing. Any other value opens nothing.
   - Update the handler, the header, and the `CLOUD_BRIEFS_OPEN_ON_WEB`
     comment in `ipcChannels.js`.
3. **The row order in the copy.**
   - In `cloudBriefsCopy.js`, give `partStatus` / `partStatusOf` a
     `tracking` (default `'ready'`). Add the PR rows (rows 5–6b), with
     `REVIEW_LABELS` and the `pr` object, and the `completionSha` row
     (row 8), following Flow 1.
   - In `test/cloudBriefsCopy.test.js`, cover:
     - "PR #N · Open", "· In review", "· Approved" (tone `review`) and
       "· Changes requested" (tone `attention`);
     - the off-target label, and a target merge still reading "Merged into
       `<target>`";
     - a live lane beating an open PR on an unfinished record;
     - the record's Run kept on a PR row, and none when the folder does not
       hold the record;
     - `done` dropping Run;
     - PR rows hidden under `off` and `needs_github`;
     - `completionSha` reading "Implemented" for a part the folder does not
       hold, while the folder's record still wins;
     - a closed PR falling through;
     - every existing row's `deepEqual` shape unchanged with no PR fields.
4. **Draw the PR rows in the panel.**
   - In `cloudBriefsPanel.js`, have `partFacts` pass
     `tracking: brief.mergeTracking`.
   - Have `renderPartRow` draw "PR #N" as an `open-pr` button (number
     first, or after the off-target label), or as plain text without a URL.
   - Handle `open-pr` in `onPartAction` (`isWebUrl` →
     `shell.openExternal`).
   - In `cloud-briefs.css`, add the `tone-review` dot and label and the PR
     link's style.
5. **Summary and attention in the copy.**
   - Give `partsSummary` a `tracking` (default `'ready'`) with D13's pieces.
   - Add `partAttention(entries, target)`.
   - In `test/cloudBriefsCopy.test.js`, cover:
     - every `ready` piece in order, with zeros left out;
     - "in progress" counting lane attention but not PR attention;
     - the not-ready head counting merged as implemented;
     - the existing one-part and empty cases;
     - `partAttention`'s two sentences, " · N more", and `''`.
6. **Summary and attention on the card.**
   - Pass `brief.mergeTracking` to both `partsSummary` calls (the card and
     the Parts tab).
   - Draw `partAttention`'s line under an Active card's parts, with its CSS.
7. **The `part-merged` sentence.**
   - Add the `part-merged` case to `eventAction` and have `isObserved` cover
     it.
   - Update the header lines that cite manual-done D8.
   - In `test/cloudBriefsCopy.test.js`, replace lines 721–723. Cover the
     full sentence, " through PR #N", and no title, target or sha, all read
     without an actor.
8. **The board under `off`.**
   - In `cloudBriefsCopy.js`, replace `MERGE_TRACKING_NOTICE` with
     `TRACKING_WARNINGS` and `trackingWarning` (D4, verbatim).
   - In `cloudBriefsPanel.js`:
     - have `renderTrackingNotice` draw the title and description with
       "Open on web" as `open-settings-web`;
     - have `openOnWeb` pass `'settings'` through;
     - change the Ready for Done badge rule to `mergeTracking === 'ready'`;
     - update the header.
   - Add the notice title's CSS.
   - In `test/cloudBriefsCopy.test.js`, replace line 613's assertion with
     both warnings and `trackingWarning('ready') === null`.
