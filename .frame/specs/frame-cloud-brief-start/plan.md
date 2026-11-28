# Plan — Frame Cloud brief start

## Architecture

### Resolved plan-time decisions

- **A dirty folder offers only Stash and continue or Cancel.** Asked (spec
  Open Question). The user chose this over a "Let the agent handle it"
  lane. It is the smallest slice, and a user who would rather commit can
  commit and press Start Work again.
- **A write that fails halfway gets an error naming what is missing.**
  Asked (spec Open Question). The user chose this over a "Create missing
  files" action on a started brief. When `brief.start` succeeds and a later
  step fails, the dialog shows which step failed, what was written, what was
  not, and each missing part's `recordRef`, so the user can finish by hand.
  There is no recovery UI and no second entry point.
- **`RECORD_REF_TAKEN` is a sentence, and nothing is written.** Asked. This
  code is drift: FrameCloud's `brief-start` plan added it after this spec
  was written. It is answered when another brief in the project already
  holds a spec slug or task id for the same shape, and the server does not
  say which one. The sentence reads: "Another brief already uses one of
  these spec or task names. Pull the latest changes and start again." After
  a pull, local allocation sees the name and adds a suffix. There is no
  automatic retry, so a ref never drifts to `-3` for a part that did not
  collide.
- **Start Work wins over an open Shape lane.** Asked. Once `shapedAt` is
  set on open, unstarted work, the card and the detail show Start Work even
  while the Shape lane is still open. Shaping is finished at that point, and
  the shaped toast's Open brief action (C10) lands on Start Work. This
  narrows frame-cloud-brief-shape's "one lane per brief" rule: the lane link
  still wins for an unshaped brief.
- **The base is the local `targetBranch`, else `origin/<targetBranch>`,
  else a refusal.** Asked. A remote base is cut with `--no-track`, so the
  work branch does not track `main`. Frame does not fetch: the base is what
  this machine has. A missing base shows in the dialog before any write.
- **A task id is `task-<title slug>`.** Asked. The slug uses spec.new's rule
  (below), with `-2`, `-3` on a collision. It reads well as a `recordRef` on
  the web's part row, as spec slugs do.
- **Dirty means `git status --porcelain` is not empty, and the stash takes
  untracked files.** Asked. The stash is `git stash push -u -m "Start Work
  #N"`. The count the dialog shows is what gets stashed, and the new branch
  starts clean. Ignored files are left alone.
- **Test posture: the pure core only.** Silent: the spec's own Constraint
  sets it, and it matches the testing record's convention. The parsers,
  branch suggestion, allocation, file builders, the request handler, the
  wire call and the copy are tested. The Electron shell, `gitBranchesManager`
  and the DOM dialog are not.
- **One pure core and one shell, as Shape has.** Silent. The pure core is
  `cloudStart.js` and the shell is `cloudStartService.js`. The wire call
  `startBrief` sits in `cloudBriefs.js` beside `shapeBrief`.
- **Two IPC calls: prepare, then start.** Silent. `CLOUD_BRIEF_START_PREPARE`
  fills the dialog (parts, suggestions, current branch, change count, base,
  and any part that does not parse). `CLOUD_BRIEF_START` re-checks
  everything in main, because the renderer is not trusted (C8), and then
  runs the order.
- **Every local check runs before the call.** Silent (C2, C3, C6). This
  covers a startable brief, definitions that parse, allocated refs, a valid
  and free branch name, an existing base, and a dirty folder with consent.
  Only then is `brief.start` called. A check that fails writes nothing,
  locally or in the cloud.
- **The folder is re-read at start.** Silent. When the change count was 0 at
  prepare but the folder is dirty at start and there is no consent, the
  answer is `dirty` and the dialog shows the warning. Nothing is stashed
  silently (C7).
- **The slug rule is spec.new's, plus transliteration.** Silent. Lowercase,
  `[a-z0-9-]` only, runs of `-` collapsed and trimmed, at most 48
  characters. Before that, the same transliteration and NFKD folding that
  `cloudProjects.suggestSlug` applies, so a Turkish title keeps its letters
  (`TRANSLITERATE` is exported for this). A title that slugifies to nothing
  falls back to `brief-<N>-part-<position>`.
- **Allocation shares one namespace per shape and runs in part order.**
  Silent. Spec slugs are checked against the folder names in
  `.frame/specs/`, and task ids against every id in `tasks.json`. Refs
  allocated earlier in the same start count as taken.
- **The branch suggestion.** Silent. The prefix comes from the type:
  `feature` → `feat/`, `fix` → `fix/`, `refactor` → `refactor/`, `docs` →
  `docs/`, `test` → `test/`. Then comes the slug of the title. For Begin,
  the title and type are the chosen part's. For Create only, the title is
  the brief's and the type is the first part's, since a brief has no type
  of its own. An empty or whitespace field falls back to the suggestion
  (C5). A name that fails `isValidBranchName` is refused as `badBranch`.
- **How a spec definition parses.** Silent. It needs `## Problem` and
  `## Goal`, each with content, the two sections the Shape prompt says
  always have content. `spec.md` is `# <part title>`, a blank line, then
  the definition as written, with no front-matter: `/spec.plan` does not
  need it, and the spec index reads a spec without it. `status.json` is
  spec.new's required shape in phase `specified`, with `created_at`,
  `updated_at` and `last_phase_at` set to now and no `ai_tool`.
- **How a task definition parses.** Silent. It is split on `## ` lines.
  `## Description` is required and must have content. `## Acceptance
  Criteria` and `## Notes` are optional. A section under any other heading
  is appended to `notes` with its heading, so nothing is lost. Text before
  the first heading is refused, because it has nowhere to go.
- **The task row.** Silent. It carries `id`, `title`, `description`,
  `acceptanceCriteria`, `notes` (the last two only when present), and
  `status: 'pending'`. `priority` is the brief's (`medium` when absent),
  `category` is the part's type, and `context` is "Frame Cloud brief #N".
  `createdAt` and `updatedAt` are now, and `completedAt` is null. A title
  over 60 characters is cut at the last space within 60, or hard at 60.
  Rows are appended in one `tasksManager.loadTasks` / `saveTasks` round, so
  `tasksManager.js` needs no change.
- **The Begin lane uses today's dispatch paths.** Silent (C9). A spec part
  goes through `agentDispatch.dispatchSpecCommand({ slug, title, command:
  'spec.plan' })`, which assigns `kind: 'spec'`. A task part goes through
  `tasksPanel.runTaskWithOptions(task, { branchMode: 'current' })`, which
  is now exported. It assigns `kind: 'task'`, and on success the renderer
  sends `UPDATE_TASK` with `in_progress`, as the Run flow does. Branch
  mode is `current` because Frame already cut the branch. The lane uses the
  default AI tool.
- **Part rows link through `agentDispatch`.** Silent. It already holds the
  `multiTerminalUI` reference, so it gains `showSpec(slug)` (through
  `showSpecsGrid` and `specsDashboard.openSpec`) and `showTask(id)` (through
  `showTasksBoard` and `tasksDashboard.openTask`), mirroring
  `enterSpecDrawer` and `enterTaskDrawer`. `agentDispatch.js` sits in
  `audit-q3-cross-platform`'s footprint (planned since 2026-07-20). The
  change is two added functions, as it was for Shape.
- **The dialog is its own renderer module,** `cloudStartDialog.js`, as the
  New brief form is `cloudBriefsForm.js`. Its words live in
  `cloudBriefsCopy.js`. Silent.
- **The history reads `started`** as "started work on this brief's N parts"
  ("1 part" when N is 1), FrameCloud's web wording. The Parts tab shows
  "Started <date>" beside "Shaped <date>". Silent.
- **No board change for Active.** `groupByColumn` already groups by
  `status`, and FrameCloud now returns `active` for a started open brief.
  After a start, the board and the open detail reload, and the card moves
  to Active. Silent.

### Data shapes

`normalizeBrief` gains `startedAt` (a string, or null). `normalizePart`
gains `recordRef` (a string, or null).

`brief.start` wire call: `POST brief.start { id, parts: [{ partId,
recordRef }] }`. It returns the brief detail. The refusals are mapped
by `START_REFUSALS`:

```
NOT_WORK → notWork          ALREADY_CLOSED → alreadyClosed
NOT_SHAPED → notShaped      ALREADY_STARTED → alreadyStarted
PARTS_MISMATCH → partsMismatch   RECORD_REF_TAKEN → recordRefTaken
BRIEF_NOT_FOUND → notFound
```

Prepare (`CLOUD_BRIEF_START_PREPARE (path, number)`) returns:

```
{ ok, number, title, targetBranch,
  parts: [{ partId, title, shape, type }],
  suggestions: { createOnly: 'feat/…', parts: { <partId>: 'fix/…' } },
  currentBranch, changeCount, base: 'main' | 'origin/main' | null,
  problems: [{ partId, title, reason: 'noDescription' | 'noProblem' | 'noGoal' | 'textBeforeHeading' | 'empty' }] }
| { ok: false, reason }
```

Start (`CLOUD_BRIEF_START (path, { number, beginPartId | null, branch, stash })`)
returns:

```
{ ok: true, number, branch, specs: n, tasks: n, stashMessage | null,
  begin: { shape: 'spec', slug, title } | { shape: 'task', task: { id, title, description, priority } } | null }
| { ok: false, reason, part?, detail? }                    — nothing was written
| { ok: false, reason: 'partial', step: 'stash' | 'branch' | 'files',
    written: [ref], missing: [{ title, shape, ref }], error }   — started in the cloud
```

`reason` for a refusal before the call is one of `notStartable`,
`badDefinition` (with `part`), `badBranch`, `branchTaken`, `baseMissing`,
`dirty`, or a server refusal above, or `call()`'s reasons (`notConnected`,
`unauthorized`, `network`, …).

### Components

- **`cloudBriefs.js`** (pure): the two new fields, `startBrief`,
  `START_REFUSALS` and `startThrough(call, { id, parts })`. The refusals
  come back as values, since `call()` folds them into one reason, as in
  `decideThrough`.
- **`cloudStart.js`** (New, pure):
  - `slugify(title)`, `suggestBranchName(type, title)`;
  - `parseSpecDefinition(text)`, `parseTaskDefinition(text)`;
  - `allocateRefs(parts, { specSlugs, taskIds }, number)`;
  - `specFiles({ title, definition, now })`, which returns `{ 'spec.md', 'status.json' }` content;
  - `taskRow({ part, fields, id, brief, now })`;
  - `startable(brief)`, true for open, shaped, unstarted work;
  - `prepareView({ brief, specSlugs, taskIds, currentBranch, changeCount, base })`;
  - `handleStartRequest(request, deps)`, the order, with every git, file
    and cloud effect injected.
- **`cloudStartService.js`** (New, Electron shell): resolves the connected
  project, reads the brief through `cloudProjectsService.call`, lists
  `.frame/specs/` and the `tasks.json` ids, and supplies the git deps from
  `gitBranchesManager`. It writes spec files with `fsSafe.writeFileAtomic`
  under `frameStore.resolveSpecDir`, and task rows through
  `tasksManager.loadTasks` / `saveTasks`.
- **`gitBranchesManager.js`**: `currentBranch`, `remoteBranchExists`,
  `stashAll(projectPath, message)` (`git stash push -u -m`), an exported
  `localBranchExists`, and `createBranch(…, baseBranch, { track })`, which
  adds `--no-track` when `track === false`.
- **Renderer.**
  - `cloudBriefsCopy.workStage` returns `'start'`, with the Start Work
    words, the dialog's words, the refusal and partial sentences,
    `startedNotice`, the `started` history sentence and `startedLine`.
  - `cloudStartDialog.js` draws the dialog.
  - The panel shows Start Work, opens the dialog, opens the Begin lane,
    toasts, reloads, and links part rows.

## Files

- `src/main/cloud/cloudBriefs.js` — **Modified.** `startedAt` and `recordRef`, `startBrief`, `START_REFUSALS`, `startThrough`, and a header comment that names the new write.
- `src/main/cloud/cloudProjects.js` — **Modified.** Exports `TRANSLITERATE` (no behavior change).
- `src/main/cloud/cloudStart.js` — **New.** The pure core of Start Work: slug and branch suggestion, definition parsers, ref allocation, file and row builders, the prepare view, and the request handler.
- `src/main/cloud/cloudStartService.js` — **New.** The Electron shell: the `CLOUD_BRIEF_START_PREPARE` and `CLOUD_BRIEF_START` handlers, with git, file and cloud deps wired to the core.
- `src/main/gitBranchesManager.js` — **Modified.** `currentBranch`, `remoteBranchExists`, `stashAll`, the exported `localBranchExists`, and the `createBranch` `track` option.
- `src/shared/ipcChannels.js` — **Modified.** `CLOUD_BRIEF_START_PREPARE`, `CLOUD_BRIEF_START`.
- `src/main/index.js` — **Modified.** Require and `setupIPC` for `cloudStartService`.
- `src/renderer/cloudBriefsCopy.js` — **Modified.** `workStage` `'start'`, the Start Work and dialog words, error, dirty and partial sentences, `startedNotice`, the `started` sentence, `startedLine`, and the part link labels.
- `src/renderer/cloudStartDialog.js` — **New.** The Start Work dialog: the parts list, Begin / Create only / Orchestrate (disabled, "Coming soon"), the branch field and base line, the dirty warning, the error slot and confirm.
- `src/renderer/cloudBriefsPanel.js` — **Modified.** Start Work on the card and in the detail, the dialog, the Begin lane, the toast, the reload, the Started line, and each part row's link to its spec or task.
- `src/renderer/agentDispatch.js` — **Modified.** `showSpec(slug)` and `showTask(id)`.
- `src/renderer/tasksPanel.js` — **Modified.** Exports `runTaskWithOptions`.
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** Dialog parts list, choice rows, dirty warning and part link styles.
- `test/cloudBriefs.test.js` — **Modified.** `startedAt` and `recordRef` normalizing, `startBrief`'s wire shape, and `startThrough` refusals.
- `test/cloudStart.test.js` — **New.** Slugify, branch suggestion, both parsers, allocation, the file and row builders, `prepareView`, and `handleStartRequest`.
- `test/cloudBriefsCopy.test.js` — **Modified.** `workStage` `'start'`, the start sentences, `startedNotice`, and the `started` history sentence.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudStart.js
- src/main/cloud/cloudStartService.js
- src/main/gitBranchesManager.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudStartDialog.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/agentDispatch.js
- src/renderer/tasksPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudBriefs.test.js
- test/cloudStart.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None. FrameCloud's `brief-start` (branch `feat/brief-start` there) must be
running on the dev server for the walk in step 8. Nothing in Frame's build
depends on it.

## Sequencing

1. **Read started briefs.** In `cloudBriefs.js`, `normalizeBrief` carries
   `startedAt` and `normalizePart` carries `recordRef`. Add `startBrief`
   (POST `brief.start`, returning `normalizeBriefDetail`), `START_REFUSALS`
   and `startThrough`. In `cloudBriefsCopy.js`, add the `started` history
   sentence and `startedLine(date)`. In the panel's Parts tab, show
   "Started <date>" beside the Shaped line, and each part's `recordRef` as
   plain text on its row. Tests go in `test/cloudBriefs.test.js`
   (normalizing, a part without a ref, `startBrief`'s input and URL, and
   each refusal through `startThrough`) and `test/cloudBriefsCopy.test.js`
   (the sentence for 1 and N parts).
2. **The pure builders.** Export `TRANSLITERATE` from `cloudProjects.js`.
   In the new `cloudStart.js`, write `slugify`, `suggestBranchName`,
   `parseSpecDefinition`, `parseTaskDefinition`, `allocateRefs`,
   `specFiles`, `taskRow` and `startable`. `test/cloudStart.test.js` covers:
   - the slug rule, with transliteration, the 48-character cut and the
     empty fallback;
   - every type prefix;
   - a spec without Problem or Goal;
   - a task without Description, with text before the first heading, with
     an unknown heading kept in `notes`, and with all three fields;
   - `-2` and `-3` against the folder and within one start;
   - the `status.json` shape;
   - the 60-character title cut;
   - `startable` for each kind of brief.
3. **The prepare view and the request handler.** In `cloudStart.js`, write
   `prepareView` and `handleStartRequest(request, deps)`. It checks in this
   order: startable, definitions, allocation, branch name (an empty one
   takes the suggestion), branch not taken, base, and dirty with consent.
   Then it calls `startThrough`, stashes if asked, creates the branch, and
   writes the specs, then the tasks. It returns the success, refusal or
   `partial` shapes above. The tests use fakes:
   - each refusal writes nothing and makes no call;
   - exactly one `brief.start` with every part's ref, in order, and the
     same refs written;
   - `recordRefTaken` and each other server refusal;
   - dirty without consent, and dirty with consent, which stashes with
     "Start Work #N";
   - a remote base passes `track: false`;
   - a failure at stash, at branch, and at a file write gives `partial`,
     with `written` and `missing`;
   - `begin` for a spec part, for a task part, and for Create only.
4. **Git helpers.** In `gitBranchesManager.js`, add `currentBranch`,
   `remoteBranchExists` and `stashAll`, export `localBranchExists`, and add
   the `track` option to `createBranch`. The IPC handler for
   `CREATE_GIT_BRANCH` is unchanged.
5. **The service and its wiring.** Write `cloudStartService.js`: `prepare`
   and `start`, which resolve the connected project, read the brief, list
   the local slugs and ids, and wire the deps to the core. Add
   `CLOUD_BRIEF_START_PREPARE` and `CLOUD_BRIEF_START` to `ipcChannels.js`
   in their own commented block, and wire `setupIPC` in
   `src/main/index.js` beside `cloudShapeService`.
6. **The Start Work words and button.** In `cloudBriefsCopy.js`:
   - `workStage` returns `'start'` for open, shaped, unstarted work, ahead
     of an open lane, and `'none'` for a started brief;
   - add `START_WORK_LABEL` and `START_WORK_HINT`, and the dialog words
     (Begin with, Create only, Orchestrate, Coming soon, "Cut from
     <base>", the dirty warning with branch and count, Stash and continue);
   - add `startErrorMessage` for every refusal, including
     `recordRefTaken`'s pull sentence, `branchTaken`, `baseMissing` and
     `badDefinition` naming the part;
   - add `partialMessage` (the step, what is written, what is missing with
     refs) and `startedNotice` ("Brief #N started: X specs, Y tasks on
     `<branch>`", plus the stash message when there is one).

   In the panel, a brief in `workStage` `'start'` gets a primary Start Work
   button on the card and in the detail's action slot, where Shape was.
   `test/cloudBriefsCopy.test.js` covers `workStage`:
   - shaped and unstarted gives `'start'`, even with a lane open;
   - started, closed, unshaped or a proposal does not;

   It also covers each error sentence, `partialMessage` and
   `startedNotice` with and without a stash.
7. **The dialog, the lane and the links.** Write `cloudStartDialog.js`. It
   invokes prepare, then lists the parts (title, `spec | task`, type) with
   Begin with each part, Create only, and Orchestrate disabled with "Coming
   soon". The branch field refills with the matching suggestion when the
   choice changes, until the user edits it. A line under the field says what
   the branch is cut from. Part problems and a missing base show in place,
   with confirm disabled. When the change count is above 0, confirm first
   shows the warning with Stash and continue or Cancel. Cancel closes the
   dialog and sends nothing. On confirm it invokes start:
   - a refusal shows its sentence in the dialog;
   - `partial` shows its message, and the board and detail reload;
   - success closes the dialog, shows `startedNotice`, and reloads the
     board and the open detail.

   Then the Begin lane opens: `dispatchSpecCommand` with `spec.plan` for a
   spec, or `runTaskWithOptions` followed by `UPDATE_TASK` `in_progress` for
   a task. Export `runTaskWithOptions` from `tasksPanel.js`. Add
   `showSpec` and `showTask` to `agentDispatch.js`. In the Parts tab, a
   part with a `recordRef` gets a link that opens it. Add the styles to
   `cloud-briefs.css`.
8. **Walk it in Frame.** With FrameCloud's `feat/brief-start` on the dev
   server, walk these cases:
   - Start Work shows on a shaped brief, also while the Shape lane is open,
     and not on an unshaped, started, closed or proposal brief.
   - Begin with a spec part: one `brief.start`, the branch cut from
     `targetBranch` and checked out, every part written, and a lane
     running `/spec.plan` on the chosen spec.
   - Begin with a task part: the lane opens and the task is `in_progress`.
   - Create only: the same files and branch, and no lane.
   - A dirty folder: Cancel changes nothing, and Stash and continue
     stashes with "Start Work #N".
   - A taken branch name, and a second start (`alreadyStarted`): each
     writes nothing.
   - A taken local slug gets `-2`, and the web shows that ref.
   - The toast, the part links, and the card in Active.
   - Orchestrate is disabled and reads "Coming soon".

   Record the walk in the outcome.

## Addendum — T11: a started brief's progress (2026-09-25)

Added after the first walk: an Active card read only "1 spec · 1 task" and
said nothing about which part runs where. Decided with the user:

- **The card grows.** Few briefs are active at once, so a started brief's
  card lists every part as a row: shape chip, title, a status badge, and
  either its lane (name and activity dot, entering it on click) or **Run**.
- **Status comes from the folder.** A spec part reads its phase from
  `SPEC_DATA` (Not started · Planned · Tasks ready · Implementing c/n ·
  Done); a task part its `tasks.json` status (Not started · In progress ·
  Done). A live lane's state wins (Working · Needs approval · Awaiting
  input). A ref this folder does not hold reads **Not on this branch**, with
  no action — no branch switching from the card.
- **Run** is the part's next step through today's paths: the spec's next
  command by phase (`spec.plan`, `spec.tasks`, `spec.implement`) through
  `dispatchSpecCommand`, or the task's Run flow (`tasksPanel.openRunFlow`).
- **No branch name** on the card (it is not stored anywhere yet).
- **A summary line** ("1 of 2 done · 1 in progress") only with more than one
  part.
- The board's part read (`addPartCounts`) keeps each part's id, title,
  shape, type and `recordRef` beside the counts, so the card needs no extra
  request. The detail's Parts tab uses the same row above each definition.

Files: `src/main/cloud/cloudBriefs.js`, `test/cloudBriefs.test.js`,
`src/renderer/cloudBriefsCopy.js` (`partStatus`, `partsSummary`),
`test/cloudBriefsCopy.test.js`, `src/renderer/cloudBriefsPanel.js`,
`src/renderer/agentDispatch.js` (`enterLane`),
`src/renderer/styles/components/cloud-briefs.css`.

## Revision — one part at a time (2026-09-25)

Overturns the plan's "every part is written on one branch" and the spec's
**Create only**, decided with the user after the first walk. Writing every
part onto the branch cut for the chosen one made the brief a single branch
while the flow treated each part as its own unit: the branch was named for
one part but held all of them, the other parts were stuck (uncommitted) on
it, starting the next part meant working on the wrong branch or carrying
untracked folders across a switch, and "Not on this branch" became the
normal state. Create only was that problem in its purest form.

- **Start Work begins one part.** The dialog picks the part to begin (no
  choice when there is one), cuts its branch from `targetBranch`, writes
  **only that part**, and opens its lane. Create only is gone. Orchestrate
  stays disabled, "Coming soon", and shows only when there is more than one
  part — running parts side by side (a worktree each) is its job.
- **The other parts stay in the cloud.** `brief.start` still carries every
  part's `recordRef` (the server requires all of them): the refs are
  reserved at start, and the files are written when each part is begun.
  Their definitions are read from the cloud at that moment.
- **Begin, on a started brief.** A part not begun yet reads **Not started ·
  Begin** on the card and in the Parts tab. Begin opens the same dialog for
  that part alone: branch field (its suggestion), base line, dirty warning.
  It cuts a new branch from `targetBranch`, writes that part under its
  reserved ref, and opens its lane. No cloud write: the brief is already
  started. Each part gets its own branch, and so its own PR.
- **Only the part being begun must parse.** Its definition is checked
  before anything is written; another part's is checked when it is begun.
  Prepare reports every part's problem so the dialog can disable that
  choice.
- **Begun parts are recorded on this machine** (asked: machine-local over a
  FrameCloud field, which would read oddly once teams share briefs). main
  keeps `<userData>/cloud-starts.json`: per cloud project, brief number and
  part id, the `ref`, the `branch` and `begunAt`. Known limit: another
  machine does not know, and may begin the same part again.
- **A part row reads, in order:** the folder holds its record → its local
  status and lane (as T11); else this machine began it → **On `<branch>`**,
  no action (no branch switching from the card); else **Not started ·
  Begin**. "Not on this branch" goes away.
- **No automatic commit.** Asked: the part's lane commits its own work, and a
  folder left dirty is caught by the next Begin's dirty warning.
- **`partial` keeps its meaning** for the first start (the brief is started in
  the cloud, the local steps failed). A failed Begin never touched the
  cloud: its failure after the branch was cut is reported with the step and
  the missing ref, and nothing is recorded as begun.

Files added to the plan: `src/main/cloud/cloudStart.js` (the begun store and
Begin mode), `src/main/cloud/cloudStartService.js` (the store file),
`src/main/cloud/cloudBriefsService.js` (each listed part's `begunBranch`),
`test/cloudStart.test.js`, and the renderer files T07–T11 touched.

## Revision — names and base (2026-09-25)

Decided with the user after the one-part revision. The branch (and the spec
slug or task id) was named from the part's title: a sentence for people,
long, in the brief's language, and cut mid-word (`…-successful-outc`). In
Frame's own spec and task flows an agent names the branch, and those names
read well.

- **Shape names each part.** The Shape agent already understands the work,
  so it writes a short English kebab-case `key` per part (at most 32
  characters). FrameCloud stores it (`brief_part.key`, FrameCloud
  `brief-start` T09); a server without the column strips it rather than
  refusing the shape.
- **The key is a suggestion.** It prefills the spec slug or task id
  (`-2`, `-3` on a collision) and the branch (`<type prefix>/<key>`); the
  user can change the branch name in the dialog. A part without a key (shaped
  before, or by a server that dropped it) falls back to the title's slug, now
  cut at a word boundary: 32 characters for the branch, 48 for the slug.
- **The branch row, like a code host's new-branch control:** a branch icon,
  the name as an editable chip, and **from `<base>` ⌄**. The base defaults to
  the brief's `targetBranch` (local, else `origin/…`) and its menu lists this
  folder's local and origin branches, so the user can cut from another one.
  The chosen base is sent with the request and checked in main (it must
  exist); a remote base is still cut with `--no-track`.
- The base menu and the branch row belong to the dialog (T14); the key and
  the word-boundary rule are T16.

Files added: `src/main/cloud/cloudShape.js` (the prompt and `key`
validation) and `test/cloudShape.test.js`.
