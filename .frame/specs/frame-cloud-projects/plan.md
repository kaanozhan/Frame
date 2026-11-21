# Plan — Frame Cloud projects

> IDs used below: **G1–G10** are the spec's numbered Goal items (G0 = the
> scenario table), **C1–C12** its Constraints in order, **SC1–SC21** its
> Success Criteria in order. The spec's own **S1–S10** are scenarios, not
> criteria, and keep that meaning here.

## Architecture

### Resolved plan-time decisions

**Business**

- **D1 · When the list refreshes → event-based, no timer** (asked). On
  launch with a session, on every session change, when the Frame Cloud modal
  opens, on its Refresh button, and on window focus at most once per 60 s.
  Rationale: nothing pushes changes (no WS hub), and an idle Frame should make
  no cloud request. A timer adds cancellation logic for little gain.
- **D2 · Connected mark → beside the project switcher only** (asked). A small
  cloud mark inside `#sidebar-current-project-wrap` (`index.html:136`), shown
  only while signed in **and** the open folder is connected; tooltip
  "Connected to <project> in <workspace>". The sidebar project list is not
  touched. Rationale (user): On this device already shows Connect / Disconnect
  for every folder, so the list needs no second indicator.
- **D3 · "Open on the web" → store the web origin at sign-in, with guards**
  (asked, after a security review requested by the user). The server already
  dictates `verification_uri_complete`, which Frame opens at sign-in, so
  storing that URL's origin adds no new trust. Being open source changes
  nothing: the address is not a secret. The risk is in how the link is built,
  so these are requirements, not options: (1) opening goes through
  `cloudSession.js`'s existing http(s)-only `openUrl` in the main process;
  (2) only `new URL(...).origin` is stored — no path, query or userinfo;
  (3) workspace and project slugs must pass the slug rule and are written
  with `encodeURIComponent`, else no link; (4) the main process builds the
  URL — the renderer sends a cloud project id, never a URL; (5) an `https`
  API requires an `https` web origin (`localhost` / `127.0.0.1` exempt).
  A session stored before this spec has no origin: the action hides until the
  next sign-in.
- **D4 · Wording of the different-identity question** (silent — one
  defensible answer, from the spec's proposal): "This project is already
  connected to a Frame folder with a different identity — that happens with
  local sharing mode, or when .frame/ was recreated. Connect this folder
  instead? The other folder will read Not connected." Buttons: **Connect this
  folder** · **Leave**.
- **D5 · Rail order** (silent): Plugins, Feedback, **Frame Cloud**, Frame
  Settings, How to Use Frame — the account sits directly above the gear, the
  editor convention the spec cites.

**Technical**

- **D6 · Test posture → pure logic and data transforms only** (asked). This is
  the convention the testing record describes (target the pure module, skip
  the Electron-coupled wrapper; no DOM harness exists). Consequence for the
  design: every decision the UI shows — grouping, default checks, labels,
  the auto-switch rule, the web URL — is computed in the pure core and pushed
  as ready rows, so the untested renderer only draws.
- **D7 · The modal uses `settingsOverlay.create`** (silent).
  `src/renderer/settingsOverlay.js:43` closes every other overlay it created
  when one opens. Registering Frame Cloud there gives C9 ("modals never
  stack" against both settings surfaces) with no new mechanism.
- **D8 · Sign-in panes move, not fork** (silent). The pane markup
  (`index.html:1560–1640`), `renderAccount` and its helpers
  (`frameSettingsModal.js:129–308`) and the `.settings-account-*` styles move
  to the new modal and are renamed `cloud-*`. `frameSettingsModal.js` keeps a
  one-row renderer. One implementation of the sign-in UI exists afterwards.
- **D9 · No new channel for the dismissal flag** (silent). "Don't show again"
  writes `cloudConnectPromptDismissed` through the existing
  `SET_USER_SETTING` (`ipcChannels.js:146`); the service reads
  `userSettings.get` when it builds state.
- **D10 · Two channels beyond the spec's list** (silent):
  `CLOUD_PROJECTS_GET_STATE` (pull on open — the pattern `CLOUD_GET_STATE`
  set) and `CLOUD_OPEN_ON_WEB` (D3 rule 4).
- **D11 · Inline confirmation for Disconnect** (silent). The row turns into
  "Disconnect from <project>? **Disconnect** · **Cancel**" — the same inline
  question pattern the refusal rows use. No new dialog component.
- **D12 · `link.candidates` runs three at a time** (silent), in the service,
  each result merged into state and pushed, so rows fill in progressively and
  a large project list cannot fire dozens of requests at once.
- **D13 · Naming** (silent). Frame already has a local "workspace"
  (`src/main/workspace.js` — the list of known projects). In new code the
  cloud one is always `cloudWorkspace`; the local list is "known folders".
- **D14 · Shared hot files** (silent). `spec-context` flags `index.html`,
  `src/renderer/index.js` and `src/shared/ipcChannels.js` as IN-FLIGHT for two
  long-stalled audit specs (`audit-q3-cross-platform`, planned since
  2026-07-20; `audit-q3-performance-resources`). Every spec touches these
  files; edits here are additive blocks beside the existing `CLOUD_*` /
  rail-foot code. No reordering of existing lines.

### Evidence the plan stands on

| claim | verified |
|---|---|
| `callTrpc` drops `input` on GET | `src/main/cloud/deviceFlow.js:185–188` |
| `access` is read in the core, the store and the public state | `deviceFlow.js:344,367` · `sessionStore.js:43` · `cloudSession.js:46` |
| Plan row | `index.html:1611–1612` · `frameSettingsModal.js:254` |
| `getProjectId` never writes; `ensureProjectId` returns null without config | `src/main/frameStore.js:215–236` |
| Known folders and `lastOpenedAt` | `src/main/workspace.js:99–125` |
| Rail foot = four modal buttons, wired in one block | `index.html:262–295` · `src/renderer/index.js:366–398` |
| Wide modal token | `src/renderer/styles/variables.css:96` (`--modal-width-wide: 1040px`) |
| Overlays close each other | `src/renderer/settingsOverlay.js:43` |
| Landing after sign-in is renderer-side, on `registering → signedIn` | `frameSettingsModal.js:231,239–245`; main only focuses (`cloudSession.js:218–224,274`) |
| 401 handling exists only inside `refresh()` | `cloudSession.js:306–310` — **drift**: no reusable "session expired" entry point; G2 adds one |
| `refresh()` re-saves the session from `device.me` | `cloudSession.js:303–304` — **drift for D3**: it would drop a stored `webOrigin`; the save must carry it over |
| Palette cloud commands live in `registerCommands()` | `src/renderer/index.js:641–654` |
| http(s)-only opener | `cloudSession.js:134` |
| Window-focus hook pattern in main | `src/main/gitStatusManager.js:47` |
| Tour exposes `isOpen`; onboarding does not | `guidedTour.js:492` · `onboarding.js:243` — G4 adds `isOpen` to onboarding |
| Atomic writes | `src/main/fsSafe.js:29` |
| No helper reads a git remote today | none found under `src/main/` — the service adds a local `execFile` call (pattern: `gitBranchesManager.js:65–70`) |
| Testing record | `.frame/PROJECT_NOTES.md` `## Testing` — present, used as written |

### Components

**Pure core — `src/main/cloud/cloudProjects.js`** (G1; C1, C5, C7, C12). No
Electron import; every function takes `{ api, token, fetchJson, signal }` like
`deviceFlow.js`.

- Calls: `listProjects`, `checkSlug`, `getCandidates`, `claim`, `create`,
  `release` — thin wrappers over `callTrpc`.
- `classifyLinkError(err)` → `remoteMismatch | mismatch | taken | slugTaken |
  badRequest | notFound | unauthorized | notRegistered | noWorkspace |
  network | other`, from `CloudError.kind`, `.status` and `.message` (the
  server puts its code in `message`).
- `matchFolders(projects, folders)` → `{ projectRows, folderRows }`.
  `folders` is `[{ path, name, projectId|null }]`. A project row:
  `{ id, slug, name, source, connected, folderNames[] , openPath|null }`.
  A folder row: `{ path, name, connected, project|null }`. Match is
  `frameProjectId === projectId` and nothing else (C1).
- `planFolderRow(folderRow, candidates)` → `{ group: 'connect' | 'create',
  candidate, matchLabel, alreadyConnected, checked, name, slug }`.
  `checked` is true only for `match: 'id' | 'remote'` on a candidate that
  carries no other id (C7).
- `suggestSlug`, `validateSlug` (3–32, `a-z0-9`, single inner hyphens,
  reserved list), `nextSlug` (`-2`, `-3`, …).
- `buildWebUrl({ apiUrl, webOrigin, workspaceSlug, projectSlug })` → string
  or null, enforcing D3 rules 2, 3 and 5.
- `shouldAutoShowDevices({ userStartedSignIn, dismissed, unconnectedCount })`.

**Session hooks — `src/main/cloud/cloudSession.js`** (G2, G8; C5). New
exports: `getAuth()` → `{ serverUrl, token, cloudWorkspace, webOrigin } |
null`; `onChange(listener)` called from `setState` with
`{ state, userStarted }` (`userStarted` is true only on the success branch of
`signIn()`); `sessionExpired()` — the body of today's 401 branch, extracted;
`reRegister()` → `device.register` once; `openUrl` exported. `signIn()`
stores `webOrigin` from the attempt's `verificationUrl`; `refresh()` carries
the stored `webOrigin` into its re-save. `access` leaves `PUBLIC_KEYS`.

**Service — `src/main/cloud/cloudProjectsService.js`** (G2, G3; C2, C3, C5).
Owns one state object and pushes it on every change:

```
{ status: 'signedOut' | 'loading' | 'ready' | 'stale' | 'error',
  cloudWorkspace: { name, slug } | null,
  projects: projectRow[],            // from matchFolders
  folders: (folderRow & plan)[],     // plan = planFolderRow, once candidates arrive
  uninitialisedCount, lastUpdated, canOpenWeb,
  promptDismissed, autoShowDevices,  // autoShowDevices is one-shot
  error?: 'network' | 'other' }
```

- Folder scan: `workspace.getProjects()` → paths that exist and have
  `.frame/config.json` (via `frameStore`), newest `lastOpenedAt` first; the
  rest are counted into `uninitialisedCount` (S7). Identity via
  `frameStore.getProjectId` — read-only (C3).
- Link operations take a folder **path** and a cloud project id. The service
  reads the id itself and calls `frameStore.ensureProjectId` only inside
  `claim` / `create` (S6, C3). It reads the remote with
  `execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout })`; no
  remote → the field is omitted.
- Every call goes through one wrapper: `getAuth()` or stop → call →
  `unauthorized` → `cloudSession.sessionExpired()`; `notRegistered` →
  `reRegister()` and one retry; `network` → `status: 'stale'` with the cache.
- Cache: `userData/cloud-projects.json`
  `{ version, serverUrl, cloudWorkspaceSlug, projects, savedAt }` through
  `fsSafe.writeFileAtomic`; ignored when `serverUrl` or the workspace slug
  differs; deleted on sign-out.
- Refresh triggers per D1; the focus trigger is throttled to 60 s and skipped
  while signed out.

**Frame Cloud modal — `src/renderer/cloudHub.js` +
`src/renderer/cloudHubTabs.js`** (G4–G6; C4, C6–C10). `cloudHub.js` owns the
overlay (`settingsOverlay.create('cloud-overlay', onOpen)`), the moved sign-in
panes, the signed-in header, the tab strip, and the public API
`open({ tab, folderPath })`, `toggle`, `signIn`, `signOut`, `accountState`.
`cloudHubTabs.js` draws the two tabs from `CLOUD_PROJECTS_STATE` and owns the
row interactions: picker, Create form with live `CLOUD_CHECK_SLUG`, inline
questions, Connect selected (sequential, per-row progress), inline Disconnect.
All server strings go through `textContent` (C10). Row copy contains no
"elsewhere" and no device ownership (C4, SC6).

Landing after sign-in: on `registering → signedIn` the hub opens itself if
closed — unless `onboarding.isOpen()` or `guidedTour.isOpen()` (C9) — and
shows the brief "Signed in to Frame Cloud" note that exists today. When the
next projects state carries `autoShowDevices`, it switches to On this device
and shows the one-line notice with **Don't show again** (G6).

**Project-scope pieces** (G7): `src/renderer/cloudProjectMark.js` — listens
to `CLOUD_PROJECTS_STATE` and `state.onProjectChange`, finds the open path in
`folders`, toggles the mark (D2). `projectSettingsModal.js` gains
`syncCloudRow()`, called from `syncFromProject()` (C9's re-read on open):
pulls both states over IPC, renders Sign in / Connect… / connected row;
Connect… closes the overlay and calls `cloudHub.open({ tab: 'device',
folderPath })`.

### Acceptance walk (not a task — how the spec is accepted)

Against a local FrameCloud (`pnpm db:migrate`, `pnpm dev`; API
`http://localhost:3777`, web `:5173`; `FRAME_CLOUD_URL` set): sign in from the
rail → On this device lists folders, connect two → web shows Connected; a
`local`-mode second clone asks the identity question; Disconnect → web shows
Not connected; a project created on the web appears after Refresh;
`git status` in every touched folder is clean; with `FRAME_CLOUD_URL` unset
nothing new renders.

## Files

| file | | purpose |
|---|---|---|
| `src/main/cloud/cloudProjects.js` | **New** | pure core: calls, error classes, matching, row planning, slugs, web URL, auto-show rule (G1) |
| `src/main/cloud/cloudProjectsService.js` | **New** | Electron shell: auth wrapper, folder scan, remote, candidates queue, cache, state push, IPC (G2, G3) |
| `src/main/cloud/deviceFlow.js` | Modified | `callTrpc` encodes query input; `access` no longer read (G1, G8) |
| `src/main/cloud/sessionStore.js` | Modified | drop `access`; persist `webOrigin` (G8, D3) |
| `src/main/cloud/cloudSession.js` | Modified | `getAuth`, `onChange`, `sessionExpired`, `reRegister`, export `openUrl`; `webOrigin` capture and carry-over; `access` out of `PUBLIC_KEYS` (G2, G8) |
| `src/shared/ipcChannels.js` | Modified | eight invoke channels + `CLOUD_PROJECTS_STATE` (G3, D10) |
| `src/main/index.js` | Modified | require, `setupIPC`, `init(window)` beside `cloudSession` (`:44,234,350`) |
| `src/renderer/cloudHub.js` | **New** | modal shell, sign-in panes, header, tabs, landing (G4, G6) |
| `src/renderer/cloudHubTabs.js` | **New** | Cloud projects and On this device tabs (G5, G6) |
| `src/renderer/cloudProjectMark.js` | **New** | Connected mark beside the project switcher (G7, D2) |
| `src/renderer/styles/components/cloud-hub.css` | **New** | modal, tabs, rows, mark; receives the renamed account styles |
| `src/renderer/styles/components/settings-modal.css` | Modified | `.settings-account-*` block leaves (`:377–`) |
| `src/renderer/styles/main.css` | Modified | import `cloud-hub.css` |
| `index.html` | Modified | `#cloud-btn` in the rail foot; `#cloud-overlay`; mark slot in `#sidebar-current-project-wrap`; Account shrinks to one row; Frame Cloud row in `#project-settings-overlay` |
| `src/renderer/frameSettingsModal.js` | Modified | account panes and `signIn`/`signOut`/`accountState` leave; one-row renderer stays (G8) |
| `src/renderer/projectSettingsModal.js` | Modified | `syncCloudRow()` (G7) |
| `src/renderer/onboarding.js` | Modified | export `isOpen` (C9) |
| `src/renderer/index.js` | Modified | wire `#cloud-btn` + tooltip; init the three new modules; `cloud.signIn`/`cloud.signOut` point at `cloudHub`; add `cloud.open`, `cloud.connectProject`, `cloud.disconnectProject` (G4, G9) |
| `PRIVACY.md` | Modified | what listing and linking send; where the cache lives (G10) |
| `scripts/intent-map.json` | Modified | a `cloud` feature entry so `find-module` answers "cloud", "account", "link" |
| `test/cloudProjects.test.js` | **New** | the core, with a fake fetch (SC20) |
| `test/cloudDeviceFlow.test.js` | Modified | query-input encoding; session shape without `access` |

## Footprint

- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudProjectsService.js
- src/main/cloud/deviceFlow.js
- src/main/cloud/sessionStore.js
- src/main/cloud/cloudSession.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/renderer/cloudHub.js
- src/renderer/cloudHubTabs.js
- src/renderer/cloudProjectMark.js
- src/renderer/styles/components/cloud-hub.css
- src/renderer/styles/components/settings-modal.css
- src/renderer/styles/main.css
- index.html
- src/renderer/frameSettingsModal.js
- src/renderer/projectSettingsModal.js
- src/renderer/onboarding.js
- src/renderer/index.js
- PRIVACY.md
- scripts/intent-map.json
- test/cloudProjects.test.js
- test/cloudDeviceFlow.test.js

## Dependencies

None.

## Sequencing

1. **Transport and session cleanup.** `callTrpc` sends GET input as
   `?input=<url-encoded JSON>`; `access` leaves `deviceFlow.js`,
   `sessionStore.js` and `PUBLIC_KEYS`; the Plan row leaves `index.html` and
   `frameSettingsModal.js`. Extend `test/cloudDeviceFlow.test.js`: input
   encoding on GET, body on POST unchanged, session without `access`.
   *(G1, G8 · SC4)*
2. **Core — reading and matching.** `cloudProjects.js` with `listProjects`,
   `matchFolders`, `buildWebUrl`. Start `test/cloudProjects.test.js`: S1, S5,
   two folders sharing an id, S8 (id no longer listed), a folder with no id;
   `buildWebUrl` — bad slug, non-http origin, https API with http origin,
   localhost exemption, missing origin. *(G0, G1 · C1 · SC7, SC20)*
3. **Core — linking.** `checkSlug`, `getCandidates`, `claim`, `create`,
   `release`, `classifyLinkError`, `suggestSlug`, `validateSlug`, `nextSlug`,
   `planFolderRow`, `shouldAutoShowDevices`. Tests: candidate order and
   labels; default checks (id/remote checked; name, already-connected and
   create unchecked); claim → `mismatch` → retry with `takeOver`; `remote
   mismatch` → retry with `acceptRemoteMismatch`; stale `taken`; release
   `mismatch` reads as detached; slug suggestion (Turkish characters, reserved
   words, length, no valid result), validation, collision; 401 and 412
   classes; the auto-show truth table. *(G1 · C7, C11, C12 · SC8, SC10–SC12,
   SC20)*
4. **Session hooks.** `getAuth`, `onChange` with `userStarted`,
   `sessionExpired` (extracted from `refresh()`), `reRegister`, exported
   `openUrl`; `webOrigin` captured in `signIn()` and carried through
   `refresh()`; `sessionStore` persists it. *(G2 · C5 · D3)*
5. **Service and IPC.** `cloudProjectsService.js`, the channels, main wiring.
   Folder scan, remote read, auth wrapper (401 / 412 / network), cache,
   candidates queue, D1 refresh triggers, `CLOUD_OPEN_ON_WEB`, dismissal flag
   read. State payload carries no token. *(G2, G3 · C2, C3, C5 · SC1, SC2,
   SC14, SC17, SC18)*
6. **Frame Cloud modal shell.** `#cloud-btn` (hidden while the session state
   is `unavailable`, no badge), `#cloud-overlay` via `settingsOverlay`, the
   sign-in panes moved and renamed, the signed-in header, the empty tab
   strip; landing after sign-in with the onboarding/tour guard;
   `cloud.signIn` / `cloud.signOut` repointed, `cloud.open` added; Settings →
   Account reduced to one row that closes Settings and opens the modal;
   account styles moved to `cloud-hub.css`. *(G4, G8, G9 · C6, C9 · SC1–SC4)*
7. **Cloud projects tab.** Rows with source mark, link state, folder names;
   Open (select the project, close), Open on the web (only when
   `canOpenWeb`), Connect a folder… (switch tab, focus the matching folder
   row); empty, stale and error states; Refresh and "Last updated …".
   *(G5 · C4, C8, C10 · SC5–SC7, SC17)*
8. **On this device tab.** The three groups, match labels, picker, Create
   form with local validation and live slug check, inline questions for
   remote mismatch and different identity (D4), Connect selected with per-row
   progress, inline Disconnect (D11), the S7 count line. *(G6 · C3, C4, C7,
   C8, C11 · SC8–SC14, SC19)*
9. **After sign-in.** Consume `autoShowDevices`: switch to On this device,
   show the one-line notice naming the cloud workspace, **Don't show again**
   → `SET_USER_SETTING cloudConnectPromptDismissed`. Nothing on launch or
   silent refresh. *(G6 · C6 · SC15)*
10. **With the project.** `cloudProjectMark.js` and its slot (D2);
    `syncCloudRow()` in Project Settings with Sign in / Connect… / Open Frame
    Cloud / Disconnect, hidden without `.frame/config.json` or without a
    server; `cloud.connectProject` and `cloud.disconnectProject` with `when`
    predicates. *(G7, G9 · C8, C9 · SC7, SC13, SC16)*
11. **Privacy note and module map.** PRIVACY.md: folder name, git remote and
    `projectId` go to the configured server when On this device loads and on
    connect; cache path; nothing written into a project. `intent-map.json`
    gains the `cloud` feature. *(G10 · SC21)*
