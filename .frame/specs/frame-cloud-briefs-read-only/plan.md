# Plan — Frame Cloud briefs, read-only

## Architecture

### Resolved plan-time decisions

- **Nav row count (asked):** no count. Data is fetched only when the panel
  opens, and a count would add a request on every project switch.
- **Main-process home (asked):** a new `cloudBriefsService.js`. It reuses
  `cloudProjectsService`'s `call()` and a new `connectedProject(path)`
  export. Brief reading stays out of a 560-line file that owns linking.
- **Test posture (asked):** pure logic only. `node --test` covers
  `cloudBriefs.js` and `cloudBriefsCopy.js`. DOM code stays untested, which is
  the project's convention (PROJECT_NOTES § Testing).
- **"You" without `auth.me` (silent, drift from the spec):** the session
  already holds `user` from `device.register` / `device.me`, and
  FrameCloud's `userSchema` has an `id`. Main reads `session.user.id` and
  makes no extra call.
- **Four tabs; target branch in the meta row (silent):** the web's fifth tab,
  Settings, holds only the target branch, which is an editable setting there.
  Read-only, it is one meta fact.
- **Drawer reuses the Specs classes (silent):** the detail markup carries
  `specs-dashboard-detail`, `-bar`, `-back` and `-content`, so the slide,
  reduced-motion handling and back button come from the existing CSS in
  `panels.css:4826-4922`. The board, cards and detail body get their own
  `cloud-briefs-*` rules in a new stylesheet.
- **Leaving when disconnected (silent):** the panel's own `hide()` drops
  `.visible`, and `multiTerminalUI`'s MutationObserver
  (`multiTerminalUI.js:586-593`) routes back to terminals. No host change.
- **Attachment links (silent):** the renderer opens them with
  `shell.openExternal` behind an `http(s)` check, the same pattern as
  `cloudHub.js:160`. **Open on web** goes through main, the `openOnWeb`
  pattern.
- **Show closed is not persisted (silent):** it resets to off each time the
  panel opens. Nothing in the spec asks for memory.
- **No palette command or shortcut (silent):** the spec's Goal names only
  the nav row.
- **Milestone names (silent):** `milestone.list` is fetched with the list,
  and cards map `milestoneId` → `name`.
- **Stale answers (silent):** each load carries a sequence number, so an
  answer for a previous project or brief is dropped. Same idea as
  `specSection.js`'s `seq`.

### Data flow

```
renderer cloudBriefsPanel ──invoke(path, …)──▶ cloudBriefsService (main)
                                                 │ connectedProject(path) → {slug,name} | null
                                                 │ call(ctx → cloudBriefs.*)   (401 / re-register rules)
                                                 ▼
                                               cloudBriefs.js ──callTrpc GET──▶ brief.list / milestone.list
                                                                               brief.getByNumber / brief.events
```

**`src/main/cloud/cloudBriefs.js`** (pure, same style as `cloudProjects.js`):
- `listBriefs({api, token, fetchJson, projectSlug, includeClosed})` →
  normalized `Brief[]`.
- `listMilestones({…, projectSlug})` → `[{id, name, status}]`.
- `getBrief({…, projectSlug, number})` → normalized `BriefDetail`.
- `briefEvents({…, id})` → `[{id, at, actorId, event, data}]`.
- `buildBriefWebUrl({apiUrl, webOrigin, workspaceSlug, projectSlug, number})`
  → `<project url>/briefs/<n>`, built on `core.buildWebUrl`.

Normalization reduces each object to the fields the UI draws. It coerces
strings, returns `null` for missing dates, and drops unknown enum values to
safe defaults (an unknown `status` becomes `backlog`).

**`src/main/cloud/cloudBriefsService.js`** (the Electron shell):
- `list(path, {includeClosed})`:
  - `connectedProject(path)`, or `{ok:false, reason:'notConnected'}`.
  - Then, in parallel through `call()`: `listBriefs` and `listMilestones`.
  - Returns `{ok, project:{name, slug}, briefs, milestones, meId, canOpenWeb}`.
- `get(path, number)`:
  - Checks the connection the same way.
  - `getBrief`, then `briefEvents(brief.id)`.
  - Returns `{ok, brief, events, meId}`.
- `openOnWeb(path, number?)`: the project URL, or the brief URL when a
  number is given, opened through `cloudSession.openUrl`.
- Failures are `{ok:false, reason}` using `classifyLinkError`'s reasons
  (`network`, `notFound`, `unauthorized`, `other`). They never throw.

**`cloudProjectsService` additions:**
- `connectedProject(path)` → `matchFolders(projects, folders).folderRows`
  entry for `path`, returned as `{id, slug, name}` when connected, else
  `null`.
- `call` is exported.

**IPC** (in the `CLOUD_*` block of `ipcChannels.js`):

| channel | args | returns |
|---|---|---|
| `CLOUD_BRIEFS_LIST` | `(path, {includeClosed})` | the `list()` result |
| `CLOUD_BRIEF_GET` | `(path, number)` | the `get()` result |
| `CLOUD_BRIEFS_OPEN_ON_WEB` | `(path, number?)` | `boolean` |

**`src/renderer/cloudBriefsCopy.js`** (pure, no DOM, no Electron). A port of
FrameCloud `apps/web/src/lib/brief.ts`:
- Columns and labels: `groupByColumn`, `COLUMNS` (Backlog / Active / Done
  with their hints), `KIND_COPY`, `priorityLabel`.
- Ending and dates: `endingFact`, `formatDate`.
- People and history: `actorLabel`, `eventSentence`.
- `reasonMessage(reason)` for the panel's error states.

**`src/renderer/cloudBriefsPanel.js`** (the host contract `init / show / hide /
isVisible`, plus `isAvailable()`):
- `init(cloudHub)`:
  - Subscribes to `hub.onProjects`, `hub.onSession` and
    `state.onProjectChange`.
  - On each change it calls `projectListUI.updateWorkspaceNav()`.
  - While visible it re-checks availability: when the folder is no longer
    connected it calls `hide()`, otherwise it reloads.
- `isAvailable()` → `cloudProjectMark.openFolder()` says connected.
- `show()` → loads the board. `hide()` → closes the drawer and drops
  `.visible`.
- Board:
  - Header: title, count, **Show closed** toggle, Refresh, Open on web.
  - Three columns, plus a Closed section when the toggle is on.
  - Cards are built with `escapeHtml`.
- States: loading, empty (with Open on web), and error (with Retry). The
  `unauthorized` state renders nothing new, because the session push hides
  the row.
- Drawer:
  - Opens on card click and closes on back or Esc.
  - Header: `#n`, kind, status, title, Open on web.
  - Meta: priority, milestone, target branch, "Created <date> by …" from the
    `created` event.
  - Tabs: Description (body `pre-wrap`, attachments), Parts, Comments,
    History.

**Nav row** (`projectListUI.js`): after Sessions,

```js
{ view: 'cloud-briefs', icon: '◇', label: 'Briefs',
  open: ui => ui.showPanel('cloudBriefs'), surfaces: ['panel:cloudBriefs'],
  available: () => require('./cloudBriefsPanel').isAvailable() }
```

`refreshWorkspaceNav()` sets `row.hidden = item.available ? !item.available()
: false` for every row.

**Router** (`multiTerminalUI.js`): `PANEL_REGISTRY.cloudBriefs = { elementId:
'cloud-briefs-panel', module: () => require('./cloudBriefsPanel') }`.

## Files

- `src/main/cloud/cloudBriefs.js` — **New** — pure brief/milestone reads,
  normalization, brief web URL.
- `src/main/cloud/cloudBriefsService.js` — **New** — Electron shell:
  path → connected slug, calls through `call()`, IPC handlers.
- `src/main/cloud/cloudProjectsService.js` — **Modified** — export `call` and
  a new `connectedProject(path)`.
- `src/shared/ipcChannels.js` — **Modified** — `CLOUD_BRIEFS_LIST`,
  `CLOUD_BRIEF_GET`, `CLOUD_BRIEFS_OPEN_ON_WEB`.
- `src/main/index.js` — **Modified** — require and `setupIPC` the new
  service.
- `src/renderer/cloudBriefsCopy.js` — **New** — pure copy helpers ported
  from the web.
- `src/renderer/cloudBriefsPanel.js` — **New** — the Briefs view: board,
  drawer, states, availability.
- `src/renderer/multiTerminalUI.js` — **Modified** — `PANEL_REGISTRY` entry.
- `src/renderer/projectListUI.js` — **Modified** — Briefs row and the
  `available` hide pass.
- `src/renderer/index.js` — **Modified** — `cloudBriefsPanel.init(cloudHub)`.
- `index.html` — **Modified** — `#cloud-briefs-panel` markup (header, body,
  drawer aside).
- `src/renderer/styles/components/cloud-briefs.css` — **New** — board,
  cards, detail body and tabs.
- `src/renderer/styles/components/panels.css` — **Modified** —
  `#cloud-briefs-panel` visibility rules beside `#sessions-panel`.
- `src/renderer/styles/main.css` — **Modified** — import `cloud-briefs.css`.
- `test/cloudBriefs.test.js` — **New** — call shapes, normalization, web
  URL guards.
- `test/cloudBriefsCopy.test.js` — **New** — grouping, ending facts, event
  sentences, labels.

## Footprint

- src/main/cloud/cloudBriefs.js
- src/main/cloud/cloudBriefsService.js
- src/main/cloud/cloudProjectsService.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/multiTerminalUI.js
- src/renderer/projectListUI.js
- src/renderer/index.js
- index.html
- src/renderer/styles/components/cloud-briefs.css
- src/renderer/styles/components/panels.css
- src/renderer/styles/main.css
- test/cloudBriefs.test.js
- test/cloudBriefsCopy.test.js

## Dependencies

None. `marked` is deliberately not used for brief bodies.

## Sequencing

1. **Pure read core.** Write `src/main/cloud/cloudBriefs.js`:
   `listBriefs`, `listMilestones`, `getBrief`, `briefEvents`, the
   normalizers and `buildBriefWebUrl`. Write `test/cloudBriefs.test.js`
   with the fake-fetch style of `cloudProjects.test.js`: GET input shapes,
   normalization of partial or unknown values, URL guards.
2. **Main service and IPC.**
   - In `cloudProjectsService.js`, export `call` and add
     `connectedProject(path)`.
   - Write `cloudBriefsService.js` with `list`, `get`, `openOnWeb` and
     `setupIPC`. A path that is not connected is refused before any call.
   - Add the three channels to `ipcChannels.js` and register the service in
     `src/main/index.js`.
3. **Copy helpers.** Write `src/renderer/cloudBriefsCopy.js` as a port of
   the web's `lib/brief.ts` helpers, with `test/cloudBriefsCopy.test.js`:
   `groupByColumn` order, `endingFact` precedence, every `eventSentence`
   branch, and "You" vs "A workspace member".
4. **Panel shell and nav row.**
   - Add the `#cloud-briefs-panel` markup to `index.html`, the
     `PANEL_REGISTRY` entry, and the Briefs row with its `available` hide
     pass in `projectListUI.js`.
   - Write `cloudBriefsPanel.js` with `init`, `show`, `hide`, `isAvailable`
     and the subscriptions, and wire it in `src/renderer/index.js`.
   - Add the visibility CSS in `panels.css`.
   - The row appears only for connected folders and opens an empty panel.
5. **Board.**
   - Load through `CLOUD_BRIEFS_LIST`.
   - Header: count, Show closed, Refresh, Open on web.
   - Backlog / Active / Done columns and a Closed section.
   - Card rendering with `escapeHtml`, the loading, empty and error/Retry
     states, and the stale-answer sequence guard.
   - New `cloud-briefs.css`, imported in `main.css`.
6. **Detail drawer.**
   - Card click → `CLOUD_BRIEF_GET`.
   - The drawer reuses the `specs-dashboard-detail*` classes; back or Esc
     closes it.
   - Header and meta, including the creator from the `created` event.
   - Tabs: Description (plain-text body, `http(s)` attachment links),
     Parts, Comments, History (`eventSentence`).
   - Open on web goes to the brief's own URL.
7. **Live availability.** When the folder stops being connected while the
   panel is open, the panel hides and the view returns to terminals. When
   the cloud projects state changes while it stays connected, the panel
   reloads. Check this across a project switch, sign-out and disconnect.
8. **Focus reload (added after implementation, T11).** When the Frame
   window regains focus while the panel is visible and connected, reload
   the board and the open brief, throttled to once per 30 s. Renderer
   `window` focus only; no main-process change.
