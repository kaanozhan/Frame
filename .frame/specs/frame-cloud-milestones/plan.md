# Plan — Frame Cloud milestones

## Architecture

### Resolved plan-time decisions

Business:

- **D1 · Can Frame set a brief's milestone? → No (asked).** Spec open
  questions 1 and 2.
  - The detail's Milestone row and the New brief form stay read-only.
  - "Open on web" is where a brief's milestone changes.
  - Frame never calls `brief.setMilestone`.
  - Why: the spec's Goal ("Milestones stay read-only in Frame") and
    frame-cloud-brief-manual-done's "every other brief or milestone mutation
    stays on the web".
  - Rejected: a Milestone select in the detail and in New brief. It adds two
    writes and their role checks.
- **D2 · Which milestones narrow the board? → The started one only
  (asked).** Spec open question 5.
  - The strip is the board's one filter, as on the web (FrameCloud
    board-active-milestone D3).
  - Rejected: a select over every open milestone plus "No milestone". Frame
    would then differ from the web.
- **D3 · A target branch that moved under a begun part → nothing extra
  (asked).** Spec open question 4.
  - The part row keeps reading "On `<branch>`", and the merge check uses the
    brief's current `targetBranch`.
  - The strip says "Targets `<branch>`" when the milestone has a branch of its
    own, in the web's words (`targetBranchLine`).
  - Rejected: storing the base branch name at Begin and flagging the row when
    it differs. Today the begun record holds only `baseSha`
    (`cloudStart.js:275`), so this would reach into the Start flow.
- **D4 · Home's tracker → a one-line strip on the "Welcome to Frame!" row
  (asked; the user added this at plan time).**
  - It shows the strip's facts: name, Overdue, end date, progress bar and
    "N of M done".
  - The whole pill is one button. It opens Briefs narrowed to the milestone.
  - It is shown only while Briefs is available for the open folder
    (`cloudBriefsPanel.isAvailable()`) and the project has a started
    milestone. Otherwise Home is unchanged.
  - The spec's Goal and Success Criteria were amended to carry it (G6,
    S11–S13).
  - Rejected: name and bar only, with the date and count in a tooltip.
- **D5 · Does the narrowing survive? → It lives in the panel (silent).** Spec
  open question 3.
  - `hide()` and a change of folder clear it.
  - The board opens on all briefs, unless Home's tracker opened it narrowed.
  - Why: the spec's Goal says "The board opens on all briefs", and S9 clears
    the narrowing on a folder change. Both settle the question as (a).
- **D6 · Viewers see no strip and no tracker (silent; the spec has
  drifted).**
  - frame-cloud-roles D2 / T09 gave viewers no Briefs at all:
    `isAvailable()` requires `permissions.work` (`cloudBriefsPanel.js:232`).
  - So the spec's "A viewer sees the same strip and narrowing" is moot.
  - The Home tracker uses the same gate.
- **D7 · What the narrowing covers (silent; the web's D7 and D9).**
  - It applies to the three columns and to the Closed section under Show
    closed.
  - A narrowed board with nothing open says "No open briefs in this
    milestone." instead of "No briefs yet".
  - New brief is unchanged. A brief created while the board is narrowed has
    no milestone.
- **D8 · The narrowing counts only while it names the started milestone
  (silent; the web's D8).**
  - `narrowedTo` holds a milestone id.
  - If the board's started milestone is another one, or there is none, the
    board shows all briefs. This happens when Home's tracker was clicked on a
    milestone that has closed since.
- **D9 · The started milestone's badge shows on the full board and on the
  narrowed one alike (silent; the web keeps it).**
  - Cards of a planned or closed milestone keep today's plain
    `.cloud-briefs-milestone` text.
- **D10 · The strip's words come from the web (silent).** Ported from
  `board-milestone.tsx` and `lib/milestone.ts`:
  - "Milestone"
  - "Ends {date}" / "No end date"
  - "Targets {branch}"
  - "N of M done" / "No briefs yet"
  - "Overdue"
  - "Show only this milestone" / "All briefs"
  - The name opens the milestone's web page, and is plain text when
    `canOpenWeb` is false.
- **D11 · An older server's milestone shows its name only (silent; C6).**
  - Such a server sends no `briefs` counts, so `briefs` is null.
  - With `briefs` null, the strip and the tracker show the name only: no end
    date, branch, progress or Overdue.
  - The detail row reads the name and the status.
  - Checking `briefs === null` tells this apart from a new server's milestone
    that has no end date, which reads "No end date".

Technical:

- **D12 · Where Home's tracker gets its data → a light `milestone.list`
  read plus a handoff from the board (asked twice).**
  - A new IPC channel, `CLOUD_MILESTONES_LIST`, reads `milestone.list` only.
    That is one request, three small queries on the server
    (`services/milestone.ts:230`).
  - `homeData` gets a new `milestone` source.
  - It pulls when:
    - the project changes;
    - the cloud state changes for the open folder;
    - Home is visited or the window gains focus, but only when its value is
      older than 30 s.
  - Each time the Briefs board draws, it hands Home its started milestone
    with counts taken from the board. So Home matches the strip after a Move
    to Done, with no request.
  - Rejected:
    - reusing `CLOUD_BRIEFS_LIST`, which sends the whole board's N+1 requests
      on every Home visit;
    - a dedicated FrameCloud `milestone.started` endpoint, which adds a
      cross-repo dependency and still needs the `milestone.list` fallback for
      older servers.
- **D13 · The spec's "No new request" holds for the Briefs board; Home's
  tracker adds one `milestone.list` read (follows from D4 and D12).**
  - The spec's constraint line was amended to say so.
  - There are still no timers.
- **D14 · Tests: pure logic only (asked).**
  - New test cases go in `test/cloudBriefs.test.js` (the normalizer and the
    web link) and `test/cloudBriefsCopy.test.js` (the milestone rules and
    words).
  - The panel, `homeData` and the Home widget stay untested. The project has
    no DOM harness, which was checked again this run.
- **D15 · The milestone rules live in `cloudBriefsCopy.js` (silent).**
  - It is already Frame's pure port of the web's `lib/*.ts`: no DOM, no
    Electron, and `node --test` covers it.
  - The panel, `homeData` and the Home widget all read the rules from there.
  - The rules run in the renderer because the held moves (`moving`) are
    renderer state.
  - Rejected: a new `src/shared/` module. Nothing in main needs the rules.
- **D16 · "The earliest started" (silent; C5).** `startedMilestone` works
  like this:
  - It filters to `status === 'started'`.
  - It orders by `startedAt` ascending; a missing `startedAt` goes last, and
    ties keep the list's order.
  - It returns the first one, or null.
  - The server's list order is `createdAt`, and since FrameCloud migration
    0019 there is at most one started milestone.
- **D17 · The milestone's web link is built in main (silent; C8).**
  - `buildMilestoneWebUrl` returns
    `{project url}/milestones/{encodeURIComponent(id)}`. That is the web
    route `/$slug/$project/milestones/$milestoneId`.
  - `openOnWeb(folderPath, target)` gains a `{ milestoneId }` target. Any
    other object opens nothing.
- **D18 · Normalizing guards (silent).**
  - `targetDate` is kept only when it matches `YYYY-MM-DD`.
  - `briefs` is kept only when all four counts are non-negative integers;
    otherwise the whole field is null.
  - `goal`, `targetBranch`, `startedAt` and `closedAt` go through `strOrNull`.
- **D19 · `src/shared/ipcChannels.js` is in the footprints of two in-flight
  specs, audit-q3-cross-platform and frame-cloud-early-access (silent).**
  - This plan only appends one constant and edits one comment, so a merge
    resolves trivially.
- **D20 · A held move that settles while Briefs is hidden makes Home read
  again (silent; follows from D12).**
  - `holdMoveToDone` calls `homeData.refresh('milestone')` once its move is
    sent or undone, if the panel is no longer visible.
  - Otherwise Home would keep the handed-off count of a move that was undone
    after the user left the panel.
- **D21 · The tracker patches itself in place (silent; home-widget-board
  C1).**
  - The Agents widget rebuilds the tracker's markup only when the summary it
    draws changes, like `_renderTool`'s option guard.
- **D22 · The GitHub tracking box keeps reading the full board (silent).**
  - Narrowing must not hide the project-wide "no GitHub" or "tracking off"
    box, so its Active count comes from all shown briefs.
- **D23 · No new dependency (silent).**

### Data shapes

```js
// cloudBriefs.normalizeMilestone (main → renderer)
{
  id, name,
  status: 'planned' | 'started' | 'closed',
  goal: string | null,
  targetDate: 'YYYY-MM-DD' | null,
  targetBranch: string | null,
  startedAt: string | null,
  closedAt: string | null,
  briefs: { backlog, active, done, closed } | null, // null: an older server sent none
}

// IPC (new) CLOUD_MILESTONES_LIST: (path) → { ok: true, milestones } | { ok: false, reason }
// IPC CLOUD_BRIEFS_OPEN_ON_WEB target: number | 'settings' | { milestoneId } | undefined

// homeData source 'milestone'
null | { path, milestone }  // the started milestone; `briefs` as the board counted it after a handoff

// cloudBriefsCopy.milestoneSummary(milestone, today) → what the strip and the tracker draw
{
  id, name,
  overdue: boolean,
  ends: 'Ends Nov 20, 2026' | 'No end date' | null, // null: older server (D11)
  target: 'Targets release/1.0' | null,
  progress: { done, total, percent, label } | null,  // null: older server
}
```

### Components

- **Core (`cloudBriefs.js`).** `normalizeMilestone` keeps the full shape.
  `buildMilestoneWebUrl` builds the milestone's page.
- **Service (`cloudBriefsService.js`).**
  - `milestones(folderPath)` reads `milestone.list` alone, for Home.
  - `openOnWeb` opens a milestone's page.
  - `list()` is unchanged. It already returns `milestones`, now in the full
    shape.
- **Copy (`cloudBriefsCopy.js`).** A port of `lib/milestone.ts`:
  - `MILESTONE_STATUS_LABEL`, `OVERDUE_LABEL`
  - `startedMilestone`, `briefsInMilestone`, `countsWithBriefs`
  - `milestoneProgress`, `localToday`, `isOverdue`
  - `formatTargetDate`, `targetBranchLine`
  - The strip's labels, plus `milestoneSummary` and `milestoneRowFacts`.
- **Panel (`cloudBriefsPanel.js`).**
  - `renderBoard` picks the started milestone, then narrows `shownBriefs()`
    when `narrowedTo` names it.
  - It draws the strip between the tracking box and the columns.
  - It hands the started milestone to `homeData`, with `briefs` from
    `countsWithBriefs` over every shown brief, held moves included.
  - New state: `narrowedTo` and `pendingNarrow`.
  - New export: `openMilestone(id)`, mirroring `openBrief`.
  - Cards draw a badge for the started milestone's name.
  - The detail's Milestone row reads the name (a web link), its facts and
    Overdue.
- **Home (`homeData.js`, `widgets/agents.js`).**
  - `homeData` owns the `milestone` source: pulls, the handoff, and the cloud
    and project triggers.
  - The Agents widget declares `milestone` among its sources.
  - It wraps the title in `.home-composer-head` beside a hidden
    `.home-milestone` button, which it fills from `milestoneSummary`.
  - Clicking the button calls `cloudBriefsPanel.openMilestone(id)`.

### Flows

1. **The strip.**
   - `load()` returns the briefs and the milestones.
   - `renderBoard` runs: started = `startedMilestone(milestones)`. If there is
     one, it draws the strip with `milestoneSummary({ ...started, briefs:
     countsWithBriefs(started, shownBriefs()) }, localToday())`.
   - A held Move to Done shows as Done in `shownBriefs()`, so the numbers move
     at once (C4, S7), and back on Undo through `redrawMove`.
2. **Narrowing.**
   - "Show only this milestone" sets `narrowedTo = started.id`, then calls
     `renderBoard()`.
   - "All briefs" sets `narrowedTo = null`.
   - Opening and closing a brief leave it alone, because the drawer never
     touches it (S6).
   - `hide()` and a change of folder clear it (S9).
3. **Home.**
   - A project change, a cloud change, a Home visit or window focus makes
     `homeData` check `cloudBriefsPanel.isAvailable()`.
   - If Briefs is not available, the value is null. Otherwise it calls
     `CLOUD_MILESTONES_LIST` and stores `startedMilestone(milestones)`.
   - The Agents widget draws or hides the tracker.
   - A click calls `openMilestone(id)`, which sets `pendingNarrow`. Then
     `showPanel('cloudBriefs')` runs, and `show()` sets `narrowedTo =
     pendingNarrow`.
   - A board draw hands the board's own counts to Home (D12).

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified.** `normalizeMilestone` keeps
  goal, `targetDate`, `targetBranch`, `startedAt`, `closedAt` and `briefs`.
  New `buildMilestoneWebUrl`. Header and `listMilestones` doc updated.
- `src/main/cloud/cloudBriefsService.js` — **Modified.** New `milestones()`
  and its `CLOUD_MILESTONES_LIST` handler. `openOnWeb` accepts
  `{ milestoneId }`. Header updated.
- `src/shared/ipcChannels.js` — **Modified.** New `CLOUD_MILESTONES_LIST`.
  `CLOUD_BRIEFS_OPEN_ON_WEB` comment names the milestone target.
- `src/renderer/cloudBriefsCopy.js` — **Modified.** The milestone rules and
  words ported from `lib/milestone.ts` and `board-milestone.tsx`.
- `src/renderer/cloudBriefsPanel.js` — **Modified.** The strip, narrowing,
  the card badge, the detail's Milestone row, `openMilestone`, and the
  handoff to `homeData`.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** The
  strip, its progress bar, the Overdue badge, the started-milestone badge and
  the detail row's facts.
- `src/renderer/home/homeData.js` — **Modified.** The `milestone` source:
  pull, freshness, handoff, and the cloud and project triggers.
- `src/renderer/home/widgets/agents.js` — **Modified.** The title row gains
  the milestone tracker.
- `src/renderer/styles/components/home-board.css` — **Modified.**
  `.home-composer-head` and the `.home-milestone` pill.
- `test/cloudBriefs.test.js` — **Modified.** The normalizer's new fields and
  guards, and `buildMilestoneWebUrl`.
- `test/cloudBriefsCopy.test.js` — **Modified.** The started pick, counts,
  progress, Overdue, date, branch line, summary and row facts.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudBriefsService.js
- src/shared/ipcChannels.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- src/renderer/home/homeData.js
- src/renderer/home/widgets/agents.js
- src/renderer/styles/components/home-board.css
- test/cloudBriefs.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None.

## Sequencing

1. **Read the whole milestone in the core.**
   - In `cloudBriefs.js`:
     - extend `normalizeMilestone` with D18's guards (`briefs` null unless
       all four counts are non-negative integers; `targetDate` only as
       `YYYY-MM-DD`);
     - add and export `buildMilestoneWebUrl({ apiUrl, webOrigin,
       workspaceSlug, projectSlug, milestoneId })`, which returns null under
       `buildWebUrl`'s guards or for an empty id;
     - update the header and `listMilestones`' doc.
   - In `test/cloudBriefs.test.js`:
     - rewrite "listMilestones … keeps id, name and status" for the full
       shape;
     - cover an older server's `{ id, name, status }` (every new field null);
     - cover a malformed count, a negative count, and a `targetDate` that is
       not a calendar date;
     - cover `buildMilestoneWebUrl`: a good URL, an id with `/` or `?`
       encoded, and null under the guards.
2. **Serve it from main.**
   - In `cloudBriefsService.js`:
     - add `milestones(folderPath)`, which returns `NOT_CONNECTED` for an
       unconnected folder and otherwise
       `call(core.listMilestones)` → `{ ok: true, milestones }` or
       `{ ok: false, reason }`;
     - register `IPC.CLOUD_MILESTONES_LIST`;
     - let `openOnWeb` open `buildMilestoneWebUrl` for a
       `{ milestoneId: string }` target;
     - update the header.
   - In `ipcChannels.js`, append `CLOUD_MILESTONES_LIST:
     'cloud-milestones-list'` after `CLOUD_BRIEFS_OPEN_ON_WEB`, and extend
     that line's comment.
3. **Port the milestone rules and words.**
   - In `cloudBriefsCopy.js` add:
     - `MILESTONE_STATUS_LABEL`, `OVERDUE_LABEL`, `MILESTONE_LABEL`,
       `SHOW_ONLY_MILESTONE_LABEL`, `ALL_BRIEFS_LABEL`,
       `NARROWED_EMPTY_LABEL`;
     - `startedMilestone` (D16), `briefsInMilestone`, `countsWithBriefs`
       (null when `briefs` is null; `closed` stays the server's);
     - `milestoneProgress`, `localToday`, `isOverdue`, `formatTargetDate`
       (UTC, so no time zone moves the day), `targetBranchLine`;
     - `milestoneSummary` (the D11 name-only case), and `milestoneRowFacts`
       ("Started · Ends Nov 20, 2026", "Planned", "Closed").
   - Update the header to name `lib/milestone.ts` and
     `board-milestone.tsx`.
   - In `test/cloudBriefsCopy.test.js`, cover:
     - `startedMilestone` with none, one, and two (the earliest wins, and a
       missing `startedAt` goes last);
     - `countsWithBriefs` from board briefs, including a brief the caller
       already shows as Done;
     - progress at 0 total ("No briefs yet") and rounding;
     - `isOverdue` on the end date (no), the day after with briefs left
       (yes), nothing left (no), planned (no), and no date (no);
     - `localToday`, `formatTargetDate` and `targetBranchLine`;
     - `milestoneSummary` with full data and with an older server's
       milestone;
     - `milestoneRowFacts`.
4. **Draw the strip above the columns.**
   - In `cloudBriefsPanel.js`, `renderBoard` picks `startedMilestone` and
     draws `renderMilestoneStrip`. It sits after the tracking box (D22) and
     before the columns, with counts from `shownBriefs()`.
   - The strip shows, in order:
     - "Milestone";
     - the name, as a `data-action="open-milestone-web"` button when
       `canOpenWeb`, else as text;
     - Overdue;
     - "Ends …";
     - "Targets …";
     - the progress bar (`role="progressbar"`) and its label.
   - `onContentClick` routes `open-milestone-web` to
     `openOnWeb({ milestoneId })`.
   - Add the strip, bar and Overdue styles to `cloud-briefs.css`.
5. **Narrow the board.**
   - In `cloudBriefsPanel.js`, add `narrowedTo` and `pendingNarrow`.
   - The strip gets a `data-action="toggle-milestone"` button with
     `aria-pressed`, reading "Show only this milestone" or "All briefs".
   - `renderBoard` filters the columns, Closed and the header count with
     `briefsInMilestone` while `narrowedTo === started.id` (D7, D8). A
     narrowed board with nothing open reads `NARROWED_EMPTY_LABEL`.
   - `hide()` clears `narrowedTo`, and so does a change of folder in
     `onCloudChange`.
   - Add and export `openMilestone(id)`. It guards like `openBrief`,
     narrows at once when the panel is visible, and otherwise goes through
     `pendingNarrow` and `showPanel('cloudBriefs')`. `show()` sets
     `narrowedTo = pendingNarrow` and then clears `pendingNarrow`.
6. **The card badge and the detail's Milestone row.**
   - `renderCards` and `renderCard` take the milestones by id. A started
     milestone's name becomes `.cloud-briefs-milestone-badge`; any other
     stays `.cloud-briefs-milestone` (D9).
   - `renderMeta`'s Milestone row shows:
     - the name, as an `open-milestone-web` button when the detail's
       `canOpenWeb`;
     - `milestoneRowFacts`;
     - an Overdue badge for the started milestone, counted like the strip.
   - `onDetailClick` routes `open-milestone-web`.
   - Add the badge and facts styles to `cloud-briefs.css`.
7. **Home reads the started milestone.**
   - In `homeData.js`:
     - add `'milestone'` to `SOURCES` (value `null`);
     - `refresh('milestone')` pulls `CLOUD_MILESTONES_LIST` for the open
       project when `cloudBriefsPanel.isAvailable()`, otherwise sets null. A
       late answer for another project is dropped;
     - `refreshMilestoneIfStale()` pulls only when the value is older than
       30 s;
     - `setBoardMilestone(path, milestone)` takes the board's handoff for the
       current project;
     - `setHostState`'s project change clears the value and pulls;
     - `init()` subscribes to `cloudHub.onProjects` and `onSession`, and
       acts only when the folder's path, cloud project or availability
       changes.
   - In `cloudBriefsPanel.js`:
     - `renderBoard` calls `homeData.setBoardMilestone` with the started
       milestone, its `briefs` counted from `shownBriefs()`, or null;
     - `holdMoveToDone` calls `homeData.refresh('milestone')` after the
       move settles, if the panel is hidden (D20).
   - Require the modules lazily on both sides, because `homeData` and
     `cloudBriefsPanel` require each other.
8. **Draw Home's tracker.**
   - In `widgets/agents.js`:
     - `sources: ['aiTool', 'milestone']`;
     - the title moves into `.home-composer-head` beside a hidden
       `<button class="home-milestone">`;
     - `update` fills it from `milestoneSummary(value.milestone,
       localToday())`, escaped, only when the summary changed (D21), and
       hides it on null;
     - a click calls `require('./../../cloudBriefsPanel').openMilestone(id)`;
     - `mount` calls `homeData.refreshMilestoneIfStale()` and adds a window
       `focus` listener that does the same while the widget is connected;
     - a new `dispose()` removes that listener.
   - In `home-board.css`, add `.home-composer-head` (a flex row: title left,
     tracker right, wrapping under the title at narrow widths) and the
     `.home-milestone` pill. The pill holds the name, Overdue, end date, a
     small bar, the "N of M done" label and a chevron, with hover and
     `:focus-visible` states.
