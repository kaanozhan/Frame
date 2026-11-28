# Plan — Start Work on a Frame Server

## Architecture

### Resolved plan-time decisions

**Business**

- **D1 · An older Frame Server is refused at Start, not disabled up front.**
  Asked. The dialog lists every connected server as selectable. Start's first
  server call (`workspaces.preflight`, D9) runs before `brief.start`; an older
  server answers "Unknown method", and Start Work refuses with "Update Frame
  Server on <host>", writing nothing. User, 2026-11-25: "1'i öner hem test
  etmiş de oluruz güzel olur." Rejected: disabling a server older than the
  desktop (the desktop already knows this from `status.install`,
  `serverLink.js:352`). It would push a server that already has the methods
  into an update that restarts it and ends its running agents. The spec's
  Older-servers constraint and LOCATION criterion were amended to match.
- **D2 · This Mac is the default location.** Decided by the user before the
  plan (2026-11-25), already in the spec. The radio starts on This Mac every
  time; nothing is remembered.
- **D3 · A server part's chip reads `name · host`.** Silent. It matches the
  Specs board's server chip (`server-specs`). While the server is offline the
  chip reads `name · host · offline`, cannot be clicked, and its hint names the
  host as offline.
- **D4 · A begun entry whose server is no longer saved does not stand.**
  Silent. Frame can neither reach nor list that machine, so the part can be
  begun again. This is the same rule as phase 1's "a record whose branch is
  gone no longer stands" (`cloudStart.js:539`).
- **D5 · Begin of a part begun on a server is refused, naming the host.**
  Silent. `alreadyBegun` gets the detail `<branch> on <host>`, and the existing
  sentence reads "This part was already begun on `<branch>` on `<host>`."
  (`cloudBriefsCopy.js:608`).

**Technical**

- **D6 · The branch is cut by `workspaceManager.create({ from: 'new', branch })`
  on the server.** Asked (spec Open Question 1). The dialog's branch name is
  settled before the location, as on This Mac. On a server,
  `create({ from: 'new' })` takes that name and fetches `origin/<base>`. It
  cuts the branch and opens the worktree in one call, and it returns the
  commit it cut from (`startSha`, already computed at
  `workspaceManager.js:552`). User, 2026-11-25: "This Mac altındaki
  workspace'te de bir kesme modu var zaten kullanıcı remote seçmeden onu
  belirlemiş oluyor o isimle açılabilir." This overturns
  `frame-cloud-start-workspace` Open Question 1 (b) for the server path only.
  The Mac path keeps cut-then-`from: 'branch'`. Rejected: a separate server
  method that cuts the branch (more server code, one more failure point
  between two calls).
- **D7 · Test posture: everything testable.** Asked. Covered: the pure core
  (`cloudStart.js`), the copy and card rules (`cloudBriefsCopy.js`),
  `workspaceManager.create`'s branch option, and the three new server methods,
  run against real repositories as `serverTasks.test.js` does. Left out: the
  dialog and panel DOM (no DOM harness, testing record) and the Electron
  shell (`cloudStartService.js`), by the project's convention.
- **D8 · No protocol bump.** Silent. New server methods follow the
  "Unknown method" → update-sentence precedent (`tasksManager.js:550`,
  `sendFiles.js:132`, `specManager.js:2109`). A bump would cut every older
  server off entirely (`serverProtocol.js:77`).
- **D9 · One server preflight before `brief.start`.** Silent. On the desktop,
  the service first makes sure the project is on the server (the existing
  `ensureOnServer` clone or bundle, through a new `workspaceManager` export).
  It then calls the new `workspaces.preflight { projectPath, branch, base }`.
  The server fetches `origin/<base>` (a failed fetch falls back to the last
  fetched copy, as phase 1 T11 does) and answers
  `{ branchTaken, baseOnOrigin, fetch, tasksPath }`. Being the first new
  method, it is also what catches an older server (D1). Every server refusal
  happens here, before `brief.start` (spec C2, S8).
- **D10 · Spec files go through a new `specs.create`.** Silent.
  `specs.create { projectPath, root, slug, files }` in `src/server/specs.js`
  uses the existing `checkout()` and `needSlug()` guards. It accepts only
  `spec.md` and `status.json` as string contents, refuses an existing
  `.frame/specs/<slug>`, and writes through `fsSafe.writeFileAtomic`.
  Rejected: reusing `files.receive`, which needs an SSH upload, overwrites
  files and also writes into the main copy.
- **D11 · Task rows go through a new `tasks.insert`.** Silent.
  `tasks.insert { projectPath, rows }` in `src/server/tasks.js` mirrors
  `cloudStartService.writeTasks`: one load and save, an id clash refuses the
  whole call, rows are kept whole (reserved id, acceptance criteria, notes),
  and `metadata.totalCreated` is bumped. It answers `{ tasksPath }`. The
  desktop then calls the exported `tasksManager.refreshServerTasks(folderPath,
  { onlyKey })` so TASKS_DATA carries the row. Rejected: a keep-id flag on
  `tasks.add`, which goes through `addTask` (`tasksManager.js:205`, mints a
  new id and drops acceptance criteria and notes).
- **D12 · Ref allocation counts server tasks.** Silent. `taskIds` reads the
  merged list (`tasksManager.tasksPayload`) instead of the Mac's file alone.
  `specSlugs` already includes cached server specs (`specManager.js:336`). The
  server's `tasks.insert` clash refusal stays the backstop.
- **D13 · The begun entry gains `serverKey`; liveness is checked per server.**
  Silent. Entry: `{ ref, branch, begunAt, baseSha?, serverKey? }`, where no
  `serverKey` means This Mac (spec C11). `withBegunBranches` takes a fifth
  argument `servers`: `{ [serverKey]: Set<branch> | null }`, keyed by saved
  servers.
  - A server entry is live when its key is listed and its set is null
    (offline or unknown) or holds the branch.
  - `branchGone` follows the same rule as for the Mac, against that server's
    set.
  - Live server parts carry `begunServerKey`.
  - The service fills each set through the existing `git.branches` on the
    server clone (`panels.js:59`), once per server named by this project's
    entries, with a short timeout. A failure reads as null.
- **D14 · `deps.begunStands(entry)` replaces the Mac-only branch check in the
  Begin guard.** Silent. It is optional and falls back to
  `localBranchExists(entry.branch)`, so the Mac path and its tests are
  unchanged. The service answers server entries by D13's rule.
- **D15 · A server base must be `origin/<x>`.** Silent. The core refuses any
  other base for a server with the new `baseNotOnOrigin`, before anything is
  written. The dialog offers only `remote` bases for a server, and main checks
  again.
- **D16 · The Mac path is untouched.** Silent. Same checks, the same
  `createBranch` + `create({ from: 'branch' })`, and the same files (spec
  C1, S11). The phase 1 followup (Start Work calls `workspaceManager.create`
  outside the per-project `serialize` queue) stays a followup.
- **D17 · `cloudDone` is unchanged.** Silent. `plan()` (`cloudDone.js:68`)
  resends a missing cloud branch from a server entry's `baseSha`, and it never
  makes a completion candidate for a branch the Mac lacks. That matches "no
  `brief.recordCompletion`" (spec C1).
- **D18 · No explicit spec-cache refresh after `specs.create`.** Silent. The
  server broadcasts `workspaces.updated` on create (`projects.js:51`).
  `specManager` follows it after 1.5 s, and `/spec.plan` staging re-lists the
  root (`server-specs` rules). `GET_SPEC` missing the new spec for a moment
  keeps the selected workspace (`agentDispatch.js:510`), which is the right
  one.

### Flow (server location)

The steps below run in order; a refusal at any step before step 5 writes
nothing.

1. **Renderer.** The dialog sends `{ number, beginPartId, branch, base, serverKey }`.
2. **Main (`cloudStartService.start`).** Checks the connected folder and the
   `work` role. Refuses `localMode` when `gitSharing` is `local` (C6).
3. **Core (`handleStartRequest`).**
   - Reads the brief and checks begun (`begunStands`), the definition, the
     refs and the branch name.
   - Picks the base: the chosen one, which must be `origin/…` (D15), else
     `origin/<target>`.
   - Calls `deps.serverPreflight({ branch, base })` (D9). Its refusals:
     `serverUnavailable` (offline, not saved, or the project could not be
     sent), `serverOld` (D1), `branchTaken`, `baseNotOnOrigin`.
4. **Start reservation.** On Start Work, `brief.start` reserves every part's
   ref, as today.
5. **Workspace.** `deps.createWorkspace(branch, workspaceBase(base))` →
   `workspaceManager.create(folder, { from: 'new', branch, base,
   location: 'server', serverKey })` (D6) → `{ workspace, setupScript,
   baseSha: startSha }`. A failure is `partial` at step `workspace`; the server
   rolls back its own new branch (`dropNewBranch`).
6. **Files.** A spec part goes through `deps.writeSpec(slug, files,
   workspace.path)` → `specs.create` (D10). A task part goes through
   `deps.writeTasks(rows)` → `tasks.insert` + `refreshServerTasks` (D11), with
   `tasksPath` from the preflight. A failure is `partial` at step `files`.
7. **Record and report.** `recordBegun({ partId, ref, branch, baseSha,
   serverKey })`, then `recordBranch({ id, partId, branch, baseSha })`, fired
   and not awaited, as today.
8. **Renderer (`openBeginLane`, unchanged).**
   - Selects the server workspace after `section.load()`.
   - Runs the setup script in a terminal there.
   - Opens `/spec.plan` (staged on the server by
     `BUILD_SPEC_COMMAND_FILE`'s `workspaceId` routing) or the task run (its
     prompt names the server's `tasksPath`).

### Data shapes

```
Start request      { number, beginPartId, branch, base, serverKey? }      // serverKey: a saved server; absent = This Mac
Begun entry        { ref, branch, begunAt, baseSha?, serverKey? }
Part (after list)  { …, begunBranch, branchGone, begunServerKey }
prepareView        { …existing, localMode: boolean }

workspaces.preflight { projectPath, branch, base }        → { branchTaken, baseOnOrigin, fetch: { fetched, error }, tasksPath }
workspaces.create    { …, from: 'new', branch? }          → { …existing, startSha }
specs.create         { projectPath, root, slug, files }   → { created: ['spec.md', 'status.json'] }
tasks.insert         { projectPath, rows }                → { tasksPath }

workspaceManager.serverProject(projectPath, serverKey, { ensure }) → { link, host, serverKey, serverProjectPath } | { error, unsaved? }
```

New start refusals (copy in `cloudBriefsCopy.startErrorMessage`):
`serverUnavailable` (detail: the reason, which names the host), `serverOld`
(detail: host), `localMode`, `baseNotOnOrigin` (detail: base).

### Renderer

- **Dialog (`cloudStartDialog.js`).** Location radios: This Mac (checked) and
  each saved server, labelled by host.
  - A server is disabled with "offline" when it is not connected, and every
    server is disabled with the local-mode sentence when `view.localMode` is
    set.
  - Choosing a server filters the base menu to `remote` entries. A local base
    is switched to `origin/<target>` when offered, else to the first remote,
    else to none (Start disabled).
  - The workspace-name line counts that server's workspace names.
  - The request carries `serverKey`.
  - Choosing This Mac restores phase 1's menu and names.
- **Card.** `cloudBriefsCopy.partWorkspace` matches a server row by
  `begunServerKey` and branch; without `begunServerKey` it keeps today's
  local match. `cloudBriefsPanel.renderPartWorkspace` labels a server chip as
  in D3.

## Files

- `src/main/workspaceManager.js` — **Modified.** `create({ from: 'new',
  branch })` cuts a caller-named branch: a valid name, refused when taken, and
  the workspace named from its last segment. Both `from: 'new'` paths return
  `startSha`. `createOnServer` passes `startSha` through. New export
  `serverProject(projectPath, serverKey, { ensure })`.
- `src/server/projects.js` — **Modified.** New `workspaces.preflight`.
- `src/server/specs.js` — **Modified.** New `specs.create`.
- `src/server/tasks.js` — **Modified.** New `tasks.insert`.
- `src/main/cloud/cloudStart.js` — **Modified.**
  - The begun entry keeps `serverKey`.
  - `withBegunBranches` gains the `servers` argument and `begunServerKey`.
  - `handleStartRequest` gains the server path: `serverPreflight`, the
    origin-only base, the cut inside `createWorkspace` with `baseSha` from its
    answer, and `serverKey` in `recordBegun`.
  - `begunStands` with its fallback; the `alreadyBegun` detail names the host.
- `src/main/cloud/cloudStartService.js` — **Modified.**
  - Server deps: preflight, create, `specs.create`, `tasks.insert` +
    `refreshServerTasks`, `tasksPath`, `begunStands`, `hostOf`.
  - The `localMode` refusal, and `taskIds` from the merged list.
  - `withBegunBranches` builds the `servers` map, and `prepare` uses it and
    returns `localMode`.
- `src/renderer/cloudBriefsCopy.js` — **Modified.** Server-aware
  `partWorkspace`, the chip label and hint for a server part, the new
  `startErrorMessage` sentences, and the Location copy (offline and local-mode
  hints). `SERVER_LOCATION_LABEL` goes once unused; `COMING_SOON` stays for
  Orchestrate.
- `src/renderer/cloudStartDialog.js` — **Modified.** The Location radios, the
  base filter for a server, the workspace-name line per location, and
  `serverKey` in the request.
- `src/renderer/cloudBriefsPanel.js` — **Modified.** `renderPartWorkspace`
  draws a server chip (`name · host`, offline state).
- `src/renderer/styles/components/cloud-briefs.css` — **Modified.** The
  offline chip state and the location hint.
- `test/serverProjects.test.js` — **Modified.** `create({ from: 'new',
  branch })` on a server project, and `workspaces.preflight`.
- `test/serverSpecs.test.js` — **Modified.** `specs.create`.
- `test/serverTasks.test.js` — **Modified.** `tasks.insert`.
- `test/cloudStart.test.js` — **Modified.** The begun `serverKey`,
  `withBegunBranches` with `servers`, and the server path of
  `handleStartRequest` with its refusals.
- `test/cloudBriefsCopy.test.js` — **Modified.** `partWorkspace` for server
  rows, the chip text, the new start sentences, and the Location copy.

## Footprint

- src/main/workspaceManager.js
- src/server/projects.js
- src/server/specs.js
- src/server/tasks.js
- src/main/cloud/cloudStart.js
- src/main/cloud/cloudStartService.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudStartDialog.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/styles/components/cloud-briefs.css
- test/serverProjects.test.js
- test/serverSpecs.test.js
- test/serverTasks.test.js
- test/cloudStart.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None.

## Sequencing

1. **`workspaceManager.create({ from: 'new', branch })` and `startSha`.**
   - Validate `branch` for any `from`.
   - With `from: 'new'` and a branch: refuse it when taken, cut it from
     `origin/<base>` (fetched), and name the workspace from its last segment.
   - Return `startSha` from both `from: 'new'` paths, and pass it through
     `createOnServer`.
   - Tests in `test/serverProjects.test.js` (server `workspaces.create` with a
     branch: the branch starts at `origin/<base>`'s tip, the name, the taken
     and invalid refusals, `startSha` equal to the branch tip).
2. **Server `workspaces.preflight`** in `src/server/projects.js`: a registered
   project only; branch and base names validated; fetch `origin/<base>` with
   the last-copy fallback; answer `{ branchTaken, baseOnOrigin, fetch,
   tasksPath }`. Tests in `test/serverProjects.test.js`.
3. **Server `specs.create`** in `src/server/specs.js`: the `checkout()` and
   `needSlug()` guards, only `spec.md` and `status.json`, create-only. Tests in
   `test/serverSpecs.test.js` (written into a workspace; existing folder,
   bad slug, extra file name and foreign root refused).
4. **Server `tasks.insert`** in `src/server/tasks.js`: `needFrame(project())`,
   one load and save, clash refusal with nothing written, rows kept whole,
   `{ tasksPath }`. Tests in `test/serverTasks.test.js`.
5. **Begun store and liveness in the core.** `normalizeBegunEntry` and
   `addBegun` keep `serverKey`; `withBegunBranches(…, servers)` follows D13
   and sets `begunServerKey`. Tests in `test/cloudStart.test.js` (saved and
   known, saved and unknown, unsaved, gone on its server, Mac entries
   unchanged).
6. **The server path of `handleStartRequest`.**
   - `begunStands` with its fallback, and the `alreadyBegun` detail with the
     host.
   - The origin-only base (`baseNotOnOrigin`), then `serverPreflight` and its
     refusals, all before `brief.start`.
   - No `createBranch` on a server; `baseSha` from `createWorkspace`'s answer;
     `serverKey` into `recordBegun`.
   - Tests in `test/cloudStart.test.js` (each refusal sends no `brief.start`
     and writes nothing; success writes through the server deps; the Mac path
     is unchanged).
7. **The service wiring.**
   - `workspaceManager.serverProject`.
   - `cloudStartService`'s server deps (preflight with `ensure`, create,
     `specs.create`, `tasks.insert` + `refreshServerTasks`, `tasksPath`,
     `begunStands`, `hostOf`) and the `localMode` refusal.
   - `taskIds` from `tasksPayload`; the `servers` map for `withBegunBranches`
     through `git.branches`; `prepare` with the server-aware begun map and
     `localMode`.
8. **Copy.** `startErrorMessage` for `serverUnavailable`, `serverOld`,
   `localMode` and `baseNotOnOrigin`; the server-aware `partWorkspace`; the
   server chip label and hint (D3); the Location copy; `SERVER_LOCATION_LABEL`
   dropped. Tests in `test/cloudBriefsCopy.test.js`.
9. **The dialog.** The Location radios (This Mac checked, servers by host,
   offline and local-mode disabled), the base filter on a server, the
   workspace-name line per location, and `serverKey` in the request.
10. **The card chip.** `renderPartWorkspace` draws the server chip and its
    offline state, with CSS in `cloud-briefs.css`.
12. **The normal server way on Begin (added 2026-11-25, after T10).** The
    spec's Goal opens a server workspace "the normal server way", but step 8
    of the Flow left `openBeginLane` unchanged, so Begin skipped what New
    Workspace does for a server: the Send files step before setup
    (`sendFilesModal`, server-copy-files) and the notice that the project's
    committed history was sent and what stayed on this Mac. `selectBegunWorkspace`
    offers Send files for a server workspace before its setup script, and
    `sent` travels from `workspaceManager.serverProject({ ensure })` through
    the preflight and the start's answer to `cloudBriefsCopy.sentNotice`.
    Tests in `test/cloudStart.test.js` and `test/cloudBriefsCopy.test.js`.
11. **Developer walk.** Walk S1–S11 against a real Frame Server: a spec part
    and a task part on the server, a Mac part and a server part of one brief
    side by side, Begin refused while the server is offline, an older server
    refused at Start (D1), a `gitSharing: local` project, and the Mac path.
    Deferred (user, 2026-11-25): walked at the end of
    `frame-cloud-start-places`, in one walk that tests both specs. Until then
    this spec stays `implementing`.
