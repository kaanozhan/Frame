# Plan — Start Work in Three Places

## Architecture

### Resolved plan-time decisions

**Overturned before the plan (user, 2026-11-25, recorded in the spec)**

- **`frame-cloud-start-on-server` D2 (This Mac preselected) is overturned.**
  Step 2 opens with no place picked, and nothing is remembered between
  dialogs. The default may change again later.
- **`frame-cloud-start-workspace`'s "the main checkout is never switched" is
  overturned.** The project checkout is a place again, without any stash: a
  dirty checkout is locked, never stashed (`frame-cloud-brief-start`: never
  stash without consent).

**Business**

- **D1 · The checkout is busy while it is on a begun checkout part's branch
  and that part is not finished.** Spec Open Question 1, option (a). The
  service reads the part's record in the project folder: a spec is finished
  when its `status.json` phase is `done`, a task when its `tasks.json` row is
  `completed`. Rationale: main must re-check busy before `brief.start` (spec
  C2), and lanes live in the renderer, which main does not trust and cannot
  see; (a) also holds a part whose lane was closed but whose work is not done.
  Rejected: (b) a live lane of a begun part runs in the checkout (renderer
  state only, and a closed lane would let a second part switch the branch
  away). (auto-decided — full auto)
- **D2 · The begun entry records the place.** Spec Open Question 2, option
  (a): a part begun in the checkout is stored with `place: 'checkout'` and its
  `title`, so the lock can name it even when it belongs to another brief.
  Rationale: explicit, no migration (an entry without `place` reads as before,
  as `serverKey` did in `frame-cloud-start-on-server` D13). Rejected: (b)
  inferring it from a Mac entry with no workspace on its branch while the
  checkout is on that branch: a workspace part whose workspace was archived
  looks the same. (auto-decided — full auto)
- **D3 · Add a server… and Connect hide Start Work and bring it back.** Start
  Work hides while the Servers dialog is open and shows step 2 again when it
  closes. A server added since Add was pressed (or the server Connect was
  pressed for) that is now connected becomes the picked place. When the Servers
  dialog closes to hand the screen to a terminal (ssh access setup, a check-up
  fix), Start Work closes too, with a notice to start again once the server is
  connected. Rationale: a modal Start Work over that terminal would block the
  ssh prompt the user was just sent to. Rejected: always reappearing (covers
  the terminal) and staying hidden until some later close (an invisible open
  dialog blocks every other Start Work). (auto-decided — full auto)
- **D4 · The server line says "if missing" without asking the server.** The
  outcome line under a server's branch row says: "If this project is not on
  `<host>` yet, Frame sends its committed history there first." Rationale: the
  dialog cannot know whether a server holds the project without a server call;
  the sentence is true either way, and the start's own notice
  (`copy.sentNotice`, T12 of `frame-cloud-start-on-server`) reports what was
  actually sent. Rejected: one server lookup per connected server each time
  the dialog opens (latency on every Start Work, and an unreachable server
  would stall it). (auto-decided — full auto)
- **D5 · Start Work always has step 1, even for a one-part brief.** Silent.
  The spec's STEPS criterion lists the parts in step 1 with Orchestrate
  disabled; one flow is easier to learn than two.
- **D6 · Busy is checked before dirty.** Silent. A busy checkout is usually
  dirty as well; naming the part is the more useful reason.
- **D7 · Connect on an offline server opens the Servers dialog on that
  server,** as the sidebar's Connect does (`workspaceSection.js:587`). Silent.
  It returns as D3 describes.
- **D8 · In local mode the server card is disabled in every state,** with the
  existing local-mode sentence, and offers neither Add nor Connect. Silent:
  server parts refuse local mode (`frame-cloud-start-on-server` C6), so adding
  a server would not help this project.
- **D9 · The card facts are the prototype's.** Silent. One change: the new
  workspace's "Setup runs first, about a minute" loses the duration, which
  depends on the project.
- **D10 · A checkout part's row reads "project checkout · `<branch>`" as
  text** where a workspace chip would be. Silent. A workspace found on that
  branch still wins (`partWorkspace` first), as it would for any begun part.

**Technical**

- **D11 · The request names the place.** Silent. `{ number, beginPartId,
  branch, base, place, serverKey? }`, `place` ∈ `checkout` · `workspace` ·
  `server`. Without `place` the old meaning holds (a `serverKey` is a server,
  else a workspace). `server` without a `serverKey`, or `checkout` /
  `workspace` with one, is `badRequest`.
- **D12 · A checkout start is the `frame-cloud-brief-start` path without the
  stash.** Silent. After `brief.start`, `deps.createBranch(branch, base, {
  track, checkout: true })` runs `git checkout [--no-track] -b <branch> <base>`
  in the project folder (`gitBranchesManager.createBranch`'s `checkout` flag,
  `gitBranchesManager.js:278`). `baseSha` is the new branch's tip, read right
  after. No workspace is created. A spec part is written under the project
  folder, a task row into its `tasks.json`, and the answer's `tasksPath` is
  that file. Partial steps: `branch` and `files`.
- **D13 · The checkout's default base is the local target.** Silent (spec
  Goal). `pickBase(target, { local, remote }, { prefer: 'local' })` →
  `<target>`, else `origin/<target>`. An `origin/` base is fetched first, a
  local one is cut as it is (the same `fetchBase`).
- **D14 · Main re-checks the checkout in the core.** Silent.
  `deps.checkoutState()` → `{ branch, changes, busy }`, and the pure
  `checkoutBlock(state)` refuses with `checkoutBusy` (part: the busy title,
  detail: its branch) or `checkoutDirty` (detail: the count), before
  `brief.start` and before any fetch.
- **D15 · Busy is found by a pure helper over the begun store.** Silent.
  `checkoutBusy(store, projectId, currentBranch, isFinished)` → the first
  entry of this project with `place: 'checkout'`, its branch equal to the
  checkout's current branch, and `isFinished(entry)` false →
  `{ title, ref, branch }`, else null. The service gives `isFinished` (D1).
- **D16 · The begun entry grows without a migration.** Silent. `{ ref,
  branch, begunAt, baseSha?, serverKey?, place?: 'checkout', title? }`.
  `place` and `title` are kept only for a checkout entry. A checkout entry
  stands by the Mac's branch, as any Mac entry. `withBegunBranches` adds
  `begunPlace: 'checkout'` to a live checkout part.
- **D17 · `prepareView` carries the three places' facts.** Silent. Main adds
  `checkout: { path, branch, changes, busy }`, `placeBases: { checkout,
  workspace, server }` and `workspaceFolder` (this project's folder under
  `workspaceManager.workspacesRoot()`). Paths are shortened to `~` in the
  service. `base` stays the workspace default.
- **D18 · `serverConnect.open` takes `onClose`.** Silent. It is called once
  when the dialog closes, with `{ handoff: true }` when it closed for a
  terminal (`openServerTerminal`, `openSetupTerminal`). An `open` without
  `onClose` keeps a pending one. Nothing else in the Servers flow changes.
- **D19 · "Setting up" is the panel's own state.** Silent.
  `cloudBriefsPanel` keeps `settingUp: Map<ref, host | null>` from the moment
  `openBeginLane` starts on a workspace until its lane opens (Send files and
  the setup script included). `copy.partStatus` takes `setup` and then reads
  "Setting up the workspace" or "Setting up on `<host>`", tone active, no Run;
  dropped and merged still win.
- **D20 · A checkout lane opens in the project checkout.** Silent.
  `openBeginLane` selects the project checkout (`workspaceSection.select(null)`)
  when a workspace is selected, asks main to refresh git status
  (`IPC.REFRESH_GIT_STATUS`, as `branchPicker.js:330` does after a switch),
  then opens `/spec.plan` (routed to the spec's checkout by
  `dispatchSpecCommand`) or the task run (`branchMode: 'current'`, the
  project's `tasks.json`).
- **D21 · The Location radio row's words retire.** Silent. `LOCATION_LABEL`,
  `THIS_MAC_LABEL`, `WORKSPACE_LABEL`, `serverLocationLabel`,
  `serverLocationHint` and `workspaceNameText` go once the dialog no longer
  uses them; `LOCAL_MODE_LOCATION_HINT` stays for the server card.
  `START_DIALOG_DESCRIPTION`, `BEGIN_DIALOG_DESCRIPTION` and `beginHint` stop
  promising a workspace, since the place is chosen in step 2.
- **D22 · Test posture: everything testable.** The testing record's Covered
  line includes the pure core and the pure copy module, and
  `frame-cloud-start-on-server` D7 tested exactly those. Tests go into
  `test/cloudStart.test.js` (the begun `place`, `checkoutBusy`,
  `checkoutBlock`, the bases per place, `prepareView`, the checkout path and
  its refusals) and `test/cloudBriefsCopy.test.js` (every new sentence and
  the setting-up and checkout row rules). Left out: the dialog, the panel and
  `serverConnect.js` (DOM-coupled, no DOM harness — verified again: none in
  `node_modules`), and `cloudStartService.js` by the project's convention.
  (auto-decided — full auto)
- **D23 · Built on top of `frame-cloud-start-on-server` on the same branch.**
  Silent. Every core file of this plan is in that spec's footprint
  (IN-FLIGHT). Its code is complete (T01–T10, T12); only T11, its walk,
  remains, and the spec folds that walk into this one (C8). The work is
  sequential on one branch, so there is no collision.
- **D24 · `cloudDone` is unchanged.** Silent. A checkout part's branch is a
  Mac branch; `cloudDone.plan` already sends its missing cloud branch and reads
  its completion at the branch tip (`cloudDone.js:68`), as it did before
  workspaces.

### Flow (Start Work)

1. **Step 1 · What to work on** (Start Work only). The parts, each with its
   shape and type chips and what it does (a part whose definition does not
   parse is shown disabled with its reason), and Orchestrate, disabled, Coming
   soon. Next is enabled when the chosen part can be begun. Begin skips this
   step.
2. **Step 2 · Where to work.** The picked part ("Part · title · Change" on
   Start Work), then three cards, none picked:
   - **Project checkout** — `~/…/project · on <branch>`; locked with its
     reason when busy (D1, D6) or dirty.
   - **New workspace** — This Mac.
   - **Server workspace** — the connected hosts; with two or more, a Server
     select under the cards once the card is picked; only offline servers →
     disabled, "`<host>` is not connected." and Connect; no server → "No server
     yet", what a server gives, and Add a server…; local mode → disabled with
     its reason (D8).
3. **Branch** appears once a place is picked: "Branch · in the project
   checkout / for the new workspace / for the workspace on `<host>`", the name
   chip (shared across places) and "from `<base>` ⌄". Each place keeps its own
   base, starting from `placeBases`; a server's menu offers origin's branches
   only. The line under it is the base note plus the outcome (D4).
4. **Start** reads "Start in project checkout", "Start in new workspace" or
   "Start on `<host>`", disabled until a place is picked, unlocked, and has a
   base. Footer: "Step N of 2 · …" on Start Work, Back on step 2 (Cancel on
   Begin).
5. **Main** (`cloudStartService.start`) validates `place`, refuses a server in
   local mode, and runs the core. For `checkout`: `checkoutBlock` → branch
   free → base → fetch → `brief.start` → cut and check out → write → record
   (`place: 'checkout'`, `title`) → `recordBranch`. `workspace` and `server`
   are unchanged (C3).
6. **Renderer** after a start: a workspace or server part is marked setting up
   until its lane opens (D19); a checkout part selects the project checkout,
   refreshes git status and opens its lane there (D20).

### Data shapes

```
Start request   { number, beginPartId, branch, base, place: 'checkout'|'workspace'|'server', serverKey? }
Begun entry     { ref, branch, begunAt, baseSha?, serverKey?, place?: 'checkout', title? }
Part (listed)   { …, begunBranch, branchGone, begunServerKey?, begunPlace?: 'checkout' }
prepareView     { …existing, localMode,
                  checkout: { path, branch, changes, busy: { title, ref, branch } | null },
                  placeBases: { checkout, workspace, server }, workspaceFolder }
checkoutState() { branch, changes, busy }                       // deps, the service's fresh read
Start answer    { …existing, place: 'checkout'|'workspace'|'server', workspace: {…} | null,
                  checkout?: { from } }                         // from: the branch the checkout left
serverConnect.open({ key?, add?, onClose?({ handoff }) })
```

New refusals (copy in `startErrorMessage`): `checkoutDirty` (detail: count),
`checkoutBusy` (part: title, detail: branch).

## Files

- `src/main/cloud/cloudStart.js` — **Modified.** The begun entry keeps
  `place` and `title`; `withBegunBranches` sets `begunPlace`; new
  `checkoutBusy`, `checkoutBlock`; `pickBase`'s `prefer: 'local'`;
  `prepareView` passes `checkout`, `placeBases` and `workspaceFolder`;
  `handleStartRequest` validates `place` and gains the checkout path.
- `src/main/cloud/cloudStartService.js` — **Modified.** `prepare` reads the
  checkout (current branch, change count, busy) and the workspace folder;
  `start` passes `place`, and the checkout deps (`checkoutState`,
  `createBranch` with `checkout`, the project folder as the spec root,
  `recordBegun` with `place` and `title`).
- `src/renderer/cloudBriefsCopy.js` — **Modified.** The two steps' words, the
  three cards (titles, meta, facts, locks, server states, Add and Connect),
  the branch section (per-place label, base note, outcome line), the Start
  label per place, `checkoutDirty` / `checkoutBusy` sentences, the checkout
  `startedNotice`, the handoff notice, `partStatus`'s `setup`, the checkout
  row label; the retired Location words (D21).
- `src/renderer/cloudStartDialog.js` — **Modified.** Two steps, the three
  place cards and their states, the Server select, Add a server… and Connect
  through `serverConnect.open({ onClose })`, the live server list while open,
  the branch section per place, the Start label, `place` in the request.
- `src/renderer/serverConnect.js` — **Modified.** `open({ onClose })` and the
  `handoff` flag on the two terminal closes (D18).
- `src/renderer/cloudBriefsPanel.js` — **Modified.** The checkout lane (D20),
  the setting-up state (D19), and the checkout row label (D10).
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** The step
  footer, the place cards (picked, locked, no-server, offline), the Server
  select row and the checkout row label; the retired Location row styles.
- `test/cloudStart.test.js` — **Modified.** Begun `place` and `title`,
  `begunPlace`, `checkoutBusy`, `checkoutBlock`, `pickBase` per place,
  `prepareView`'s new fields, and the checkout path of `handleStartRequest`
  with its refusals.
- `test/cloudBriefsCopy.test.js` — **Modified.** The new sentences, the
  setting-up status, the checkout row label; the retired Location words'
  tests removed.

## Footprint

- src/main/cloud/cloudStart.js
- src/main/cloud/cloudStartService.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudStartDialog.js
- src/renderer/serverConnect.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/cloudStart.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None.

## Sequencing

1. **The begun store learns the checkout.** In `cloudStart.js`:
   `normalizeBegunEntry` and `addBegun` keep `place: 'checkout'` and `title`
   (D16); `withBegunBranches` sets `begunPlace` on a live checkout part; new
   `checkoutBusy(store, projectId, currentBranch, isFinished)` (D15) and
   `checkoutBlock({ changes, busy })` (D6, D14). Tests in
   `test/cloudStart.test.js` (entries with and without `place`, a gone
   branch, busy found and not found, busy before dirty, clean and idle).
2. **Bases per place and the view.** `pickBase(…, { prefer: 'local' })`
   (D13); `prepareView` passes `checkout`, `placeBases` and `workspaceFolder`
   (D17). Tests in `test/cloudStart.test.js`.
3. **The checkout path of `handleStartRequest`.** `place` validation (D11);
   for `checkout`: `checkoutState` → `checkoutBlock` refusals, branch free,
   the chosen base or the local-first default, fetch, `brief.start`,
   `createBranch(…, { checkout: true })` (partial `branch`), `branchSha`, the
   spec or task written into the project folder (partial `files`),
   `recordBegun` with `place` and `title`, `recordBranch`, and the answer's
   `place`, `workspace: null`, `checkout.from` and `tasksPath` (D12). The
   workspace and server paths answer `place` too and are otherwise unchanged.
   Tests in `test/cloudStart.test.js` (each refusal sends no `brief.start`
   and writes nothing; success cuts with `checkout: true` and writes into the
   project folder; Begin in the checkout; workspace and server unchanged).
4. **The service.** `prepare` reads the current branch, the change count
   (`git.isWorkingTreeClean`), busy through `core.checkoutBusy` with
   `isFinished` (D1), and the workspace folder, all paths shortened to `~`;
   `start` passes `place` and the checkout deps (`checkoutState`, the
   `checkout` flag on `createBranch`, the project folder as the spec root,
   `recordBegun` with `place` and `title`).
5. **Copy.** In `cloudBriefsCopy.js`: the step labels and buttons (Next,
   Back, Change, "Step N of 2 · …"); the three cards' titles, meta, facts
   (D9), the checkout locks, the server card states (connected hosts, offline
   line, no server yet, local mode) and Add / Connect labels; the branch
   section's per-place label, base note and outcome line (D4); the Start label
   per place; `startErrorMessage` for `checkoutDirty` and `checkoutBusy`;
   `startedNotice` for the checkout; the handoff notice (D3); `partStatus`'s
   `setup` (D19); the checkout row label (D10); the retired words (D21).
   Tests in `test/cloudBriefsCopy.test.js`.
6. **`serverConnect.open({ onClose })`.** The listener, kept by an `open`
   without one, called once on close, with `handoff: true` from
   `openServerTerminal` and `openSetupTerminal` (D18).
7. **The dialog's two steps.** In `cloudStartDialog.js`: step 1 (every part,
   Orchestrate disabled, Next) on Start Work always (D5); step 2 with the
   picked part and Change; Begin opening on step 2 with Cancel; Back keeping
   the part, the place, the branch name and each place's base; the step footer
   and its CSS.
8. **The place cards.** The three cards with none picked (C1); the checkout
   lock from `view.checkout`; the server card's states, the Server select for
   two or more connected servers, Connect and Add a server… hiding the dialog
   and returning through `onClose` (D3, D7), local mode (D8); a live
   `serverConnect.onServersChange` re-render while open (a picked server that
   drops leaves no place picked). CSS for the cards and their states.
9. **The branch section and Start.** Hidden until a place is picked; the
   per-place label, the shared name chip, each place's base from
   `view.placeBases` with the server's origin-only menu; the base note and
   outcome line (workspace name against that place's workspaces, the
   workspace folder, the checkout's current branch, the server line and the
   uncommitted count); the Start label per place; `place` and `serverKey` in
   the request; the Location row and its code removed.
10. **The card rows and the checkout lane.** In `cloudBriefsPanel.js`:
    `settingUp` set before `selectBegunWorkspace` and cleared when the lane
    opens or the project changes, passed to `partStatus` (D19); the checkout
    row label for `begunPlace` (D10) and its CSS; `openBeginLane`'s checkout
    path (D20) and the checkout `startedNotice`.
11. **Developer walk, for both specs** (C8). Against a real Frame Server and
    this Mac: S1–S9 of this spec — step 1 and Back, the three cards none
    picked, the checkout locked dirty and busy (a second part Begun while the
    first runs there), a checkout start of a spec part and of a task part, the
    branch row per place, one / two / offline / no server (Add a server… back
    in step 2 with the server picked), the Start labels, the setting-up and
    checkout rows, and the workspace and server paths with Send files — and
    `frame-cloud-start-on-server` T11 (its S1–S11). The user walks it; marking
    that T11 complete closes that spec too.
