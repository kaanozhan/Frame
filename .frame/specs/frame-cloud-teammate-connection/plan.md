# Plan — Frame Cloud connection on a teammate's machine

## Architecture

### Resolved plan-time decisions

**Business**

- **D1 · Ready folders get their own group in On this device (silent; spec
  G2).** "Ready to connect" is listed first, above Suggested. Its detail
  names the project, says the folder is its repository, and offers Connect,
  one click. No picker and no Create: the identity already decides the
  project.
- **D2 · Project Settings connects a Ready folder in place (silent; spec
  G2).** The row reads "Ready to connect" with a primary Connect that calls
  the same IPC, plus Open Frame Cloud. It does not route to the window,
  because there is nothing to choose.
- **D3 · A Ready row in Cloud projects connects in the row, also with two
  folders here (silent).** A connection belongs to the device, not a folder,
  so two clones of one project leave nothing to choose. Today's "two folders
  → On this device" detour was for claims and stays only there.
- **D4 · A Not claimed row offers "Connect a folder…" (silent; spec G7).**
  It opens On this device on the suggested folder when there is one, where
  the match reason is shown. This replaces today's one-click claim in the
  row: claiming chooses a project's folder for everyone, so it is chosen
  where the reason can be read.
- **D5 · Disconnect on a "Connected · Not on this device" row asks first
  (silent; spec G8).** The same question as On this device, inline under the
  row.
- **D6 · The Briefs row, the Connected mark and the palette are unchanged
  (silent; spec G4).** All three read `folder.connected` from main
  (`cloudBriefsPanel.js:226`, `cloudProjectMark.js:56`,
  `index.js:806,816`), and its meaning changes in main. "Connect this
  project" already shows for any folder that is not connected and opens its
  On this device row, where a Ready folder now offers Connect
  (frame-cloud-roles D6 kept).
- **D7 · After a sign-in the user started, On this device still opens by
  itself while any folder is not connected; Ready folders count (silent).**
  A teammate's first sign-in, and every sign-in after FrameCloud's
  migration 0021, lands on Connect.
- **D8 · Viewers: unchanged (silent; spec C5).** No Connect, Disconnect,
  mark or Briefs (frame-cloud-roles D2, D5). Main refuses both new calls
  without `work`.

**Technical**

- **D9 · Tests: pure logic only (asked).** This matches the testing record.
  Tests cover `cloudProjects` (states, connection read, connect and
  disconnect calls, codes), `deviceFlow` (install id) and the new copy
  module. DOM code and the Electron shells stay untested.
- **D10 · The row and folder state lives in the pure core (silent; spec
  C6).** `matchFolders` gives each project row
  `state: 'connected' | 'ready' | 'notConnected' | 'notClaimed'` and each
  folder row `ready`, replacing the project row's `connected`. The renderer
  maps a state to words. Rejected: deriving it in `cloudHubTabs.js`, which
  has no test harness.
- **D11 · Reading the connection (silent; FrameCloud D10).**
  `normalizeProject` adds
  `thisDevice: Boolean(p.connection && p.connection.thisDevice === true)`.
  Frame does not read `connection.devices`; only the web uses it.
- **D12 · Cache version 1 → 2 (silent).** A list cached before `thisDevice`
  existed is ignored. Read with the old version, it would show every folder
  as Ready while offline.
- **D13 · `CLOUD_LINK_CONNECT { path }` (silent; FrameCloud D18).**
  - Main reads the folder's `projectId` (read, never stamp), finds the
    listed project carrying it, and sends
    `link.connect { projectId, frameProjectId }`.
  - Gate: `linkBlocked()` and `refuseUnless('work')`.
  - `PROJECT_UNLINKED` → `unlinked`. `FRAME_PROJECT_MISMATCH` →
    `identityChanged`, not `mismatch`, so no take-over question appears.
    Both, and `notFound`, refresh the list (it was stale) and show a line.
- **D14 · `CLOUD_LINK_DISCONNECT { projectId }` (silent; spec G5, G8;
  FrameCloud D19).**
  - It names a project, not a folder, because a connected project may have
    no folder here.
  - Main requires a listed project and sends `link.disconnect { projectId }`.
    `notFound` counts as done and refreshes.
  - Gate: `linkBlocked()` and `refuseUnless('work')`.
- **D15 · Release goes (silent; spec G5; FrameCloud D23).** Removed:
  `cloudProjects.release`, `linkRelease`, `IPC.CLOUD_LINK_RELEASE`, and its
  two callers, `cloudHubTabs.js:842` and `projectSettingsModal.js:414`.
- **D16 · Install id (silent; spec G6, C3; FrameCloud D9).**
  - `deviceFlow.resolveInstallId(stored, mint)` keeps a stored UUID and
    mints `randomUUID()` for anything else.
  - `formatDeviceInfo` carries `installId`, and `registerDevice` sends it.
  - `cloudSession.deviceInfo()` keeps it in `userSettings` under
    `cloudInstallId`. The session file is cleared on sign-out, so it cannot
    hold the id. The analytics id is deleted when analytics is turned off,
    and the spec keeps the two ids apart.
- **D17 · `INSTALL_MISMATCH` needs no handling (silent; FrameCloud D15).**
  Frame registers only a fresh session (sign-in) or one the server says has
  no device (`DEVICE_NOT_REGISTERED`). Neither is bound to another install,
  so the error can only show as an ordinary failure.
- **D18 · Copy in New `src/renderer/cloudConnectionCopy.js` (silent; spec
  C6).** It is pure, like `cloudRoles.js`, and holds:
  - the four chips and the claiming line;
  - the Not on this device note;
  - the connected explanation;
  - the Ready lead;
  - the Disconnect and take-over questions;
  - the connect and disconnect refusal lines;
  - Project Settings' row copy per state.
- **D19 · Overturned rules leave the code (silent; spec C9).**
  `cloudHubTabs.js`'s header ("No label says a project is connected
  'elsewhere' or belongs to a device") and `matchFolders`' doc comment ("a
  project row's `connected` is the server's link state") are rewritten to
  the per-device meaning.
- **D20 · Lands after FrameCloud `device-connections` steps 1–5 (silent;
  spec C1).** Against an older server, every folder would read Ready and
  Connect would fail.
- **D21 · The IN-FLIGHT flags are stale (silent).** `frame-cloud-early-access`
  merged (#26, with outcome and digest), but its `status.json` still reads
  `tasks_generated`. `audit-q3-cross-platform` (planned) touches other lines
  of `ipcChannels.js`.

### Data shapes

```js
// cloudProjects.normalizeProject
{ id, slug, name, source, frameProjectId, thisDevice, createdAt }

// cloudProjects.matchFolders(projects, folders)
projectRows: [{ id, slug, name, source, state, folderNames, openPath }]
//   state 'connected'    this device is connected (folderNames may be empty)
//         'ready'        a folder here carries the identity; this device is not connected
//         'notConnected' the project has an identity; nothing here carries it
//         'notClaimed'   no identity
folderRows: [{ path, name, connected, ready, project }]
//   connected  identity matches and this device is connected
//   ready      identity matches, this device is not connected
//   project    { id, slug, name } whenever the identity matches

// cloudProjects (new calls)
connect({ ..., projectId, frameProjectId })  // link.connect, POST → linkResult
disconnect({ ..., projectId })               // link.disconnect, POST → { ok: true }
CODE_KINDS += { PROJECT_UNLINKED: 'unlinked' }

// deviceFlow
formatDeviceInfo({ ..., installId }) → { name, os, appVersion, installId }
resolveInstallId(stored, mint)       → { id, write: 'set' | null }

// IPC
CLOUD_LINK_CONNECT    { path }      → { ok } | { ok: false, reason }
CLOUD_LINK_DISCONNECT { projectId } → { ok } | { ok: false, reason }
// CLOUD_LINK_RELEASE deleted
```

### Main

- `cloudProjectsService.publicState()`: `plan` is null for connected and
  ready folders, and `unconnectedCount` counts every folder that is not
  connected, so Ready folders count.
- `loadCandidates()` skips connected and ready folders: their project is
  already known.
- `connectedProject()` is unchanged in code. Its row's `connected` now means
  the device is connected, so every brief call through it follows (spec G4).
- `linkConnect` and `linkDisconnect` as D13 and D14. Both refresh after a
  success, like `afterLink`.

### Renderer

- **Cloud projects** draws `project.state` through the copy module:
  - Connected with a folder → Open.
  - Connected with no folder → "Not on this device" and Disconnect… (D5).
  - Ready → Connect in the row (D3).
  - Not connected → "Not on this device" with the new note.
  - Not claimed → the claiming line, and "Connect a folder…" (D4).
- **On this device** adds the `ready` kind first (D1). `drawConnected`
  carries the explanation, the new Disconnect question and
  `CLOUD_LINK_DISCONNECT`. `QUESTIONS.mismatch` takes the take-over text.
- **Project Settings** has three states: Connected (the explanation, the new
  question, `CLOUD_LINK_DISCONNECT`), Ready (Connect in place, D2) and Not
  connected (as today).

## Files

**Main**

- `src/main/cloud/deviceFlow.js`: **Modified.** `resolveInstallId`; `installId` in `formatDeviceInfo` and the `device.register` input.
- `src/main/cloud/cloudSession.js`: **Modified.** `deviceInfo()` reads, mints and keeps `cloudInstallId` in `userSettings`.
- `src/main/cloud/cloudProjects.js`: **Modified.** `thisDevice`, the four states and folder `ready`, `connect`, `disconnect`, `PROJECT_UNLINKED`; `release` removed.
- `src/main/cloud/cloudProjectsService.js`: **Modified.** `linkConnect`, `linkDisconnect`, the two IPC handlers, plans and candidates skip ready folders, cache version 2; `linkRelease` removed.
- `src/shared/ipcChannels.js`: **Modified.** `CLOUD_LINK_CONNECT`, `CLOUD_LINK_DISCONNECT`; `CLOUD_LINK_RELEASE` removed.

**Renderer**

- `src/renderer/cloudConnectionCopy.js`: **New.** Every word about a device's connection (D18).
- `src/renderer/cloudHubTabs.js`: **Modified.** Four row states, the Ready group and detail, the explanation, new questions, connect and disconnect calls, header comment.
- `src/renderer/projectSettingsModal.js`: **Modified.** The Ready state with Connect, the connected explanation and question, `CLOUD_LINK_DISCONNECT`.
- `src/renderer/styles/components/cloud-hub.css`: **Modified.** The claiming line under a chip, the Ready state dot.

**Tests**

- `test/cloudDeviceFlow.test.js`: **Modified.** `resolveInstallId` keeps a UUID and replaces anything else; `formatDeviceInfo` and `registerDevice` carry `installId`.
- `test/cloudProjects.test.js`: **Modified.** `thisDevice` from `connection`, the four states and folder `ready` (two folders, connected with no folder, unknown id), `connect` and `disconnect` inputs, `PROJECT_UNLINKED`; release tests removed.
- `test/cloudConnectionCopy.test.js`: **New.** Chips per state, the claiming line, the note, the explanation, both questions name the project and say who stays connected, Project Settings copy per state.

## Footprint

- src/main/cloud/deviceFlow.js
- src/main/cloud/cloudSession.js
- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudProjectsService.js
- src/shared/ipcChannels.js
- src/renderer/cloudConnectionCopy.js
- src/renderer/cloudHubTabs.js
- src/renderer/projectSettingsModal.js
- src/renderer/styles/components/cloud-hub.css
- test/cloudDeviceFlow.test.js
- test/cloudProjects.test.js
- test/cloudConnectionCopy.test.js

## Dependencies

None in Frame. FrameCloud `device-connections` steps 1–5 (server and
protocol) must be live on the server Frame talks to (D20).

## Sequencing

1. **The device keeps an install id.**
   - `resolveInstallId` in `deviceFlow.js`; `installId` in
     `formatDeviceInfo` and `registerDevice`.
   - `cloudSession.deviceInfo()` reads, mints and stores `cloudInstallId`
     (D16).
   - Tests: `cloudDeviceFlow.test.js`.
2. **Connect and disconnect replace release.**
   - `connect`, `disconnect` and `PROJECT_UNLINKED` in `cloudProjects.js`;
     `release` removed.
   - `linkConnect` and `linkDisconnect` with their IPC handlers in the
     service; `linkRelease` removed.
   - The channels in `ipcChannels.js`.
   - Both Disconnect callers switch to `CLOUD_LINK_DISCONNECT` with the
     project id (D13–D15).
   - Tests: `cloudProjects.test.js` (inputs, codes; release tests out).
3. **The device's connection decides Connected.**
   - `thisDevice` in `normalizeProject`; the four states and folder `ready`
     in `matchFolders`, with its doc comment (D10, D11, D19).
   - Cache version 2; ready folders skipped by plans and candidates (D12).
   - New `cloudConnectionCopy.js` with the chips, claiming line and note.
   - The Cloud projects tab draws the four states: Ready connects in the row
     (D3), Not claimed opens On this device (D4), Connected with no folder
     asks and disconnects (D5). Header comment rewritten.
   - Tests: `cloudProjects.test.js` (states, `ready`, `thisDevice`),
     `cloudConnectionCopy.test.js` (chips, line, note).
4. **On this device speaks per device.**
   - The `ready` kind first, with its detail and Connect (D1).
   - `drawConnected` gets the explanation and the new Disconnect question.
   - The take-over question and the connect and disconnect refusal lines
     come from the copy module.
   - Ready state dot in `cloud-hub.css`.
   - Tests: `cloudConnectionCopy.test.js` (explanation, Ready lead, both
     questions, refusals).
5. **Project Settings speaks per device.**
   - The Ready state with Connect in place (D2).
   - The connected explanation and question from the copy module.
   - Tests: `cloudConnectionCopy.test.js` (row copy per state).
   - Done when walked in the app against a local FrameCloud carrying
     `device-connections`:
     - sign in and see a clone read Ready to connect;
     - Connect, and see the mark and Briefs appear;
     - Disconnect, and see them go while another member's device stays
       connected;
     - sign out and back in, and see the folder still Connected.
