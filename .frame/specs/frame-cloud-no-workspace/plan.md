# Plan — Frame Cloud no workspace

## Architecture

### Resolved plan-time decisions

**Business, asked (2026-09-28):**

- **D1 · How Frame learns a new workspace.** Chosen: besides opening the
  window, the session is re-read when Frame's window regains focus while
  signed in without a workspace. Rejected: window open only. Rationale: a
  user who creates the workspace in the browser and comes back to an open
  Frame Cloud window would otherwise keep seeing the G-A panel until they
  close and reopen it. The extra `device.me` happens only in this state.
- **D2 · Where the G-A card lives.** Chosen: one panel in place of the tabs.
  Rejected: a card in Cloud projects plus a "Needs a workspace" variant of
  On this device. Rationale: it matches the page's G-A mockup, the card
  already counts this device's Frame projects, and neither tab needs a second
  variant. The spec's Goal and Success Criteria were updated to match.

**Technical, asked:**

- **D3 · Test posture.** Pure logic only, the project's convention (Testing
  record): `node --test` over `deviceFlow.js`, `cloudProjects.js` and a new
  pure copy module. The Electron wrappers (`cloudSession.js`,
  `cloudProjectsService.js`) and the DOM (`cloudHub.js`, `cloudHubTabs.js`,
  `projectSettingsModal.js`) stay untested.

**Decided silently (single defensible answer):**

- **D4 · The sign-in core needs no code change.**
  - `runSignIn` passes `data.workspace` through
    (`src/main/cloud/deviceFlow.js:350-356`), and `sessionFromMe` does the
    same (`:370-376`).
  - `sessionStore.pickSession` copies `workspace` as is
    (`src/main/cloud/sessionStore.js:42`).
  - `cloudSession.getAuth` already maps a missing workspace to
    `cloudWorkspace: null` (`src/main/cloud/cloudSession.js:240-244`).
  - So null already flows through. The step adds tests that pin it and one
    doc-comment line. `classifyTrpcError`'s `no_workspace` and the
    `noWorkspace` reason stay for an older server.
- **D5 · One "no workspace" status.**
  - `cloudProjectsService.status()` returns `'noWorkspace'` when signed in
    and `getAuth().cloudWorkspace` is null.
  - It is the one signal the renderer reads. Every other surface keys on
    it, or on `lastUpdated` staying null.
- **D6 · The G-A panel follows the projects state, the header follows the
  session.**
  - The panel needs the folder count, which only the projects push carries
    (`folders`).
  - The Workspace row is already drawn from the session in `renderHeader`.
  - The two agree because both come from the same `device.me` answer.
- **D7 · "Create a workspace ↗" reuses `CLOUD_OPEN_WORKSPACE_ON_WEB`.**
  - `openWorkspaceOnWeb()` opens `/{slug}` with a workspace and `/new`
    without one, built by a new pure `buildNewWorkspaceWebUrl`.
  - There is no new IPC channel: the header link and the panel button
    already mean "take me to my workspace on the web".
  - The URL is built in main from the stored web origin (frame-cloud-projects
    rule).
- **D8 · No web origin, no button.** A session stored before web links
  existed has no `webOrigin`. The panel's button is then disabled with the
  title "Sign in again to open Frame Cloud on the web", from the existing
  `canOpenWeb`.
- **D9 · Focus throttle.** It is 10 s (`NO_WORKSPACE_FOCUS_MS`), separate
  from the projects service's 60 s, because this re-read exists for the
  quick trip back from the browser. `cloudSession.refresh()` already merges
  concurrent calls.
- **D10 · A workspace that disappears is the same state.** When `device.me`
  later answers `workspace: null` (for example after an admin removes the
  user), the session key changes, the list resets and the status becomes
  `noWorkspace`. No extra code is needed. The cache is never written or read
  for an empty slug.
- **D11 · The after-sign-in devices prompt does not fire without a
  workspace.** `refresh()` clears `autoShowPending` when it skips the list,
  so the prompt never shows later for a sign-in the user no longer
  remembers.
- **D12 · Project Settings without a workspace.** The label is "No
  workspace". The description is "Create a workspace on the web to connect
  this project to Frame Cloud." The action is "Open Frame Cloud", which
  opens the window on the G-A panel.
- **D13 · Copy.** All new strings are English and live in one pure module
  (`cloudNoWorkspace.js`), in the voice of `cloudHubTabs.js`. No trial, plan
  or price is named.

### Main: no workspace, no workspace calls

`src/main/cloud/cloudProjects.js` (pure core):

- New `buildNewWorkspaceWebUrl({ apiUrl, webOrigin })` → `${origin}/new` or
  null.
- The origin checks (http/https only, no http origin for an https API
  outside loopback) move into a private `webBase(apiUrl, webOrigin)`, which
  `buildWebUrl`, `buildWorkspaceWebUrl` and the new builder share.

`src/main/cloud/cloudProjectsService.js`:

- `hasWorkspace()` is `Boolean(auth && auth.cloudWorkspace && auth.cloudWorkspace.slug)`.
- `status()`: signed in without a workspace → `'noWorkspace'`, checked
  before the list states.
- `refresh()`: signed in without a workspace scans the folders, clears
  `autoShowPending`, pushes, and returns. It makes no `project.list` call.
- `loadCandidates()`, `linkBlocked()` and `checkSlug()` refuse without a
  workspace. `linkBlocked` and `checkSlug` answer `{ ok: false, reason:
  'noWorkspace' }`, so a stray IPC call never reaches `link.*`.
- `onSessionChange`: the empty-slug key already differs from a real one.
  `loadCache` is skipped when the slug is empty.
- `openWorkspaceOnWeb()`: with a workspace it behaves as today, without one
  it opens `buildNewWorkspaceWebUrl` (D7).
- `publicState()` is unchanged in shape. `status` carries the new value, and
  `folders` stays filled so the panel can count them.

`src/main/cloud/cloudSession.js`:

- `init(window)` adds `window.on('focus', …)`. While `state.state ===
  'signedIn'` and `!state.workspace`, and at most once per
  `NO_WORKSPACE_FOCUS_MS`, it calls `refresh()` (D1, D9).
- The rest follows by itself: `setState` → `onSessionChange` in the projects
  service sees the new slug → the list loads → pushes to the renderer.

### Renderer: the G-A panel

`src/renderer/cloudNoWorkspace.js` (**New**, pure, no DOM or Electron):

- `workspaceRow(workspace)` → `{ value, link }`: `{ 'No workspace', 'Create
  a workspace' }` without one, and `{ name || slug || '—', 'Open in
  browser' }` with one.
- `panel(folderCount)` → `{ title, body, button, local }`:
  - `title` is "A workspace for your own projects".
  - `body` counts this device's Frame projects, with wording for 0, 1 and
    N. For example: "This device has 3 Frame projects. With a workspace you
    can add them to Frame Cloud and see their briefs from the web and your
    phone."
  - `button` is "Create a workspace".
  - `local` is "Frame on this machine needs no account. Everything here
    works as it does without Frame Cloud."
- `settingsRow()` → `{ label, description }` (D12).
- `NO_WEB_ORIGIN` is the disabled-button title (D8).

`index.html`, inside `[data-cloud-state="signedIn"]`:

- The Workspace row's link text gets its own span
  (`#cloud-workspace-link-label`), so the text can switch between "Open in
  browser" and "Create a workspace".
- The tab bar gets `id="cloud-tabbar"`.
- New `<div id="cloud-no-workspace" class="cloud-no-workspace" hidden>`
  after the two tab panels.

`src/renderer/cloudHub.js`:

- `renderHeader` draws the Workspace row from `workspaceRow(s.workspace)`.
- `renderProjects`: when `state.status === 'noWorkspace'` it hides
  `#cloud-tabbar`, both panels and `#cloud-device-notice`, and draws
  `#cloud-no-workspace`. Otherwise it hides the panel and restores the tabs
  through `setTab(activeTab)`.
- The panel's button invokes `CLOUD_OPEN_WORKSPACE_ON_WEB` and is disabled
  when `!state.canOpenWeb` (D8).
- Every string goes in with `textContent`.

`src/renderer/cloudHubTabs.js`: `render` returns early on `'noWorkspace'`,
so neither tab draws "No projects in this workspace yet." or asks for
candidates behind the hidden panels.

`src/renderer/projectSettingsModal.js`: `renderCloudRow` gets a
`projects.status === 'noWorkspace'` branch before the `!listed` one (D12).

`src/renderer/styles/components/cloud-hub.css`: `.cloud-no-workspace` is a
card in the existing cloud tokens (surface, border, spacing of
`.cloud-empty`), plus a muted line for `local`.

### What stays quiet by itself

These already read "nothing listed" as "nothing connected", and without a
workspace `lastUpdated` stays null:

- The Connected mark (`cloudProjectMark.openFolder`, which needs
  `projects.lastUpdated`).
- The palette's `cloud.connectProject` and `cloud.disconnectProject` (their
  `folder` is null).
- The Briefs view (shown only for a connected folder, frame-cloud-briefs-read-only).

None of these files change.

## Files

- `src/main/cloud/deviceFlow.js` — **Modified.** Doc comment on `runSignIn`/`refreshSession`: `workspace` may be null (D4).
- `src/main/cloud/cloudProjects.js` — **Modified.** Private `webBase`; new `buildNewWorkspaceWebUrl`, exported.
- `src/main/cloud/cloudProjectsService.js` — **Modified.** `noWorkspace` status; no `project.list`/`link.*` without a workspace; `openWorkspaceOnWeb` → `/new`; no cache for an empty slug; `autoShowPending` cleared.
- `src/main/cloud/cloudSession.js` — **Modified.** Focus re-read of `device.me` while signed in without a workspace.
- `src/renderer/cloudNoWorkspace.js` — **New.** Pure copy for the Workspace row, the G-A panel and the Project Settings row.
- `src/renderer/cloudHub.js` — **Modified.** Workspace row from `workspaceRow`; G-A panel in place of the tabs on `noWorkspace`.
- `src/renderer/cloudHubTabs.js` — **Modified.** Early return on `noWorkspace`.
- `src/renderer/projectSettingsModal.js` — **Modified.** `noWorkspace` branch in `renderCloudRow`.
- `index.html` — **Modified.** Link label span, `#cloud-tabbar` id, `#cloud-no-workspace` panel.
- `src/renderer/styles/components/cloud-hub.css` — **Modified.** `.cloud-no-workspace` card styles.
- `test/cloudDeviceFlow.test.js` — **Modified.** `runSignIn` and `refreshSession` with `workspace: null`; a workspace that appears on a later `me`.
- `test/cloudProjects.test.js` — **Modified.** `buildNewWorkspaceWebUrl` under the same origin guards; the existing builders unchanged.
- `test/cloudNoWorkspace.test.js` — **New.** Workspace row with and without a workspace; panel body for 0, 1 and N folders; no plan or trial words.

## Footprint

- src/main/cloud/deviceFlow.js
- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudProjectsService.js
- src/main/cloud/cloudSession.js
- src/renderer/cloudNoWorkspace.js
- src/renderer/cloudHub.js
- src/renderer/cloudHubTabs.js
- src/renderer/projectSettingsModal.js
- index.html
- src/renderer/styles/components/cloud-hub.css
- test/cloudDeviceFlow.test.js
- test/cloudProjects.test.js
- test/cloudNoWorkspace.test.js

## Dependencies

None. The server side is FrameCloud's `desktop-no-workspace`, already
implemented on `feat/desktop-no-workspace`.

## Sequencing

1. **Pin the null workspace in the sign-in core.**
   - Add the doc-comment line to `deviceFlow.js` (D4).
   - In `test/cloudDeviceFlow.test.js`:
     - `runSignIn` with `device.register` answering `workspace: null`
       returns `{ ok: true }` with `session.workspace === null`.
     - `refreshSession` with `device.me` answering `workspace: null`
       returns it as null.
     - A later `me` answering a workspace returns that workspace.
   - The existing 412 `NO_WORKSPACE` case stays as it is.
2. **The `/new` link.**
   - Extract `webBase` in `cloudProjects.js`.
   - Add and export `buildNewWorkspaceWebUrl`.
   - Cover it in `test/cloudProjects.test.js`: https origin, loopback over
     http, http origin refused for an https API, non-http refused.
   - The existing `buildWebUrl`/`buildWorkspaceWebUrl` tests keep passing
     unchanged.
3. **The projects service stops at no workspace.** In
   `cloudProjectsService.js`:
   - Add `hasWorkspace`, the `noWorkspace` status, and the early return in
     `refresh()` (which clears `autoShowPending`).
   - Add the guards in `loadCandidates`, `linkBlocked` and `checkSlug`.
   - Skip `loadCache` for an empty slug.
   - `openWorkspaceOnWeb` opens `/new` without a workspace.
4. **Re-read on focus.** In `cloudSession.js` `init(window)`, add the focus
   listener with `NO_WORKSPACE_FOCUS_MS` (10 s), which calls `refresh()`
   only while signed in without a workspace (D1, D9).
5. **The copy.**
   - Write `src/renderer/cloudNoWorkspace.js` (`workspaceRow`, `panel`,
     `settingsRow`, `NO_WEB_ORIGIN`).
   - Write `test/cloudNoWorkspace.test.js`: both row forms; panel body for
     0, 1 and 3 folders; no string contains "trial", "plan", "Pro" or a
     price.
6. **The G-A panel in the Frame Cloud window.**
   - `index.html`: link label span, `#cloud-tabbar`, `#cloud-no-workspace`.
   - `cloudHub.js`: `renderHeader` uses `workspaceRow`. `renderProjects`
     swaps the tabs for the panel on `noWorkspace` and back. The button uses
     `CLOUD_OPEN_WORKSPACE_ON_WEB` and is disabled without `canOpenWeb`.
   - `cloudHubTabs.js`: early return.
   - `cloud-hub.css`: `.cloud-no-workspace`.
7. **Project Settings row.** Add the `noWorkspace` branch in
   `projectSettingsModal.js` `renderCloudRow`, using `settingsRow()` and an
   "Open Frame Cloud" action.
8. **Walk it.** Run Frame against the local FrameCloud dev server on
   `feat/desktop-no-workspace`, and record the walk in the spec's
   `outcome.md`:
   - Sign in as an onboarded user with no workspace. The window reaches the
     G-A panel with the right folder count, and the Workspace row reads "No
     workspace".
   - Relaunch: same view, and no `project.list` in the server log.
   - Project Settings shows "No workspace". There is no Connected mark and
     no Briefs row.
   - "Create a workspace ↗" opens `/new`. After creating one and switching
     back with the window open, the list appears.
   - Sign out works.
