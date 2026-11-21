# Outcome — Frame Cloud projects

## T01 — callTrpc query input and access removal

Made `callTrpc` encode GET input as `?input=<url-encoded JSON>` (omitted when there is none) and exported it; removed `access` from `runSignIn`, `sessionFromMe`, `sessionStore.pickSession`, `cloudSession`'s `PUBLIC_KEYS` and `signedInState`, and the Plan row from `index.html` / `frameSettingsModal.js`. The test fake now records the query separately so route keys stay path-only; added GET/POST encoding and no-`access` session tests. Files: deviceFlow.js, sessionStore.js, cloudSession.js, index.html, frameSettingsModal.js, test/cloudDeviceFlow.test.js.

_Captured: 2026-09-17 · 6 file change(s)_

---

## T02 — Pure core: reading, matching, web links

Created `src/main/cloud/cloudProjects.js` with `listProjects`, `normalizeProject`, `matchFolders` (identity-only match; a project row's `connected` is the server's link state, so a project linked by a folder elsewhere still reads Connected with no folder names) and `buildWebUrl` (origin-only, slug-shape check, https API needs https web origin unless the web host is loopback). Started `test/cloudProjects.test.js` with a fake fetch that decodes `?input=`. `buildWebUrl` checks slug shape only; the reserved-word list arrives with T03's `validateSlug`.

_Captured: 2026-09-17 · 2 file change(s)_

---

## T03 — Pure core: linking, slugs, row planning

Added the five link calls, `classifyLinkError`, `suggestSlug` / `validateSlug` / `nextSlug`, `planFolderRow` and `shouldAutoShowDevices` to `cloudProjects.js`, with tests for every case the task lists. Beyond the plan: `release()` itself turns `FRAME_PROJECT_MISMATCH` into `{ ok: true, notOwner: true }`; `planFolderRow` takes the folder's own id as an optional third argument and returns all candidates as `options` for the picker; `validateSlug` returns a reason code (`empty|length|format|reserved`) instead of a boolean. Files: src/main/cloud/cloudProjects.js, test/cloudProjects.test.js.

_Captured: 2026-09-17 · 2 file change(s)_

---

## T04 — Session hooks and stored web origin

Added `getAuth`, `onChange` (fired from `setState` with `{ state, userStarted }`, true only on `signIn()`'s success), `sessionExpired` (refresh's 401 branch now calls it), `reRegister`, and exported `openUrl` plus `fetchJson` from `cloudSession.js`. `webOrigin` (origin of the verification URL) is a main-only variable: saved at sign-in, carried through `refresh()`, restored on load, cleared on sign-out/expiry, and persisted by `sessionStore.pickSession`. Deviation: `fetchJson` is exported too, so the projects service shares the 15 s `net.fetch` wrapper. Files: cloudSession.js, sessionStore.js.

_Captured: 2026-09-17 · 2 file change(s)_

---

## T05 — Projects service and IPC

Created `cloudProjectsService.js` (folder scan, remote read, one auth wrapper, `userData/cloud-projects.json` cache, three-at-a-time candidates, token-free push) and wired it in `src/main/index.js`; added the nine `CLOUD_PROJECTS_*` / `CLOUD_LINK_*` / `CLOUD_OPEN_ON_WEB` channels. Choices beyond the plan: the list re-reads on entering signed-in or on a user-started sign-in, not on every `device.me` re-save; link handlers return `{ ok, reason, field?, suggestion? }` instead of throwing; `release` treats `PROJECT_NOT_FOUND` as detached; link actions refuse with `network` while the list is stale; `CLOUD_CHECK_SLUG` validates locally first and suggests `nextSlug` when the slug is taken. Files: cloudProjectsService.js, ipcChannels.js, src/main/index.js.

_Captured: 2026-09-17 · 3 file change(s)_

---

## T06 — Frame Cloud modal shell

Added `#cloud-btn` (rail foot, above the gear, hidden while `unavailable`) and `#cloud-overlay` (wide `settingsOverlay`), and created `cloudHub.js` with the moved sign-in panes (renamed `cloud-*`), the signed-in header, the tab strip, `open/toggle/signIn/signOut/accountState` and the guarded landing after sign-in. Settings → Account shrank to one row; the palette repointed `cloud.signIn`/`cloud.signOut` and gained `cloud.open`; `onboarding.js` exports `isOpen`; account styles moved to the new `cloud-hub.css`. Deviations: the tooltip text is fixed when attached, so `index.js` swaps in a fresh copy of the button whenever its label changes (this avoids touching `tooltip.js`, which is outside the Files list), and the onboarding/tour guard plus the tab renderer are passed into `cloudHub.init()`.

_Captured: 2026-09-17 · 10 file change(s)_

---

## T07 — Cloud projects tab

Created `cloudHubTabs.js` (passed to `cloudHub.init` as its tab renderer) and drew the Cloud projects tab: name/slug, source mark, Connected/Not connected, folder name(s) or "—", with Open (select + close), Connect a folder… (switch to On this device with the project id) and Open on the web (via `CLOUD_OPEN_ON_WEB`, only on rows without a folder here and with a per-row `canOpenWeb`); loading, error, stale and empty states with Retry. Server strings go through `textContent` only; row styles added to `cloud-hub.css`. Files: cloudHubTabs.js, cloudHub.js (comment), index.js, cloud-hub.css.

_Captured: 2026-09-17 · 4 file change(s)_

---

## T08 — On this device tab

Drew On this device in `cloudHubTabs.js`: Can be connected / Not in Frame Cloud / a pending "looking for matches" group / Connected, with the picker, the create form (debounced `CLOUD_CHECK_SLUG`, `-2` suggestion), inline remote-mismatch and different-identity questions (D4 copy), sequential Connect selected (n) that never answers a question, inline Disconnect, the S7 line, and stale-state disabling; styles in `cloud-hub.css`. Deviations: local slug validation runs through `CLOUD_CHECK_SLUG` (main validates before any request) instead of requiring main's core in the renderer, so editing the name does not re-suggest the slug; a pending group was added for folders whose candidates have not arrived. Followup: a shared pure `slug` module under `src/shared/` would let the renderer re-suggest slugs as the name changes.

_Captured: 2026-09-17 · 2 file change(s)_

---

## T09 — After-sign-in prompt

Made `cloudHub.js` handle a projects push with `autoShowDevices`: when the modal is open it switches to On this device and shows "<n> projects on this device aren't in <workspace>." with **Don't show again** (writes `cloudConnectPromptDismissed` via `SET_USER_SETTING`); the notice hides on reopen or when leaving the tab. It never opens the modal itself, so a landing blocked by onboarding or the tour stays blocked; launch and silent refreshes can't trigger it because main sets the flag only after a user-started sign-in. Files: src/renderer/cloudHub.js.

_Captured: 2026-09-17 · 1 file change(s)_

---

## T10 — Connected mark, Project Settings row, palette

Added `cloudProjectMark.js` (mark slot in `#sidebar-current-project-wrap`, shown only when signed in and the open folder is connected; `openFolder()` shared with the palette), the Project Settings Frame Cloud row with `syncCloudRow()` (Sign in / Not connected + Connect… / connected + Open Frame Cloud + inline-confirmed Disconnect; hidden without a server or `.frame/config.json`; says so when the state can't be read), and the `cloud.connectProject` / `cloud.disconnectProject` palette commands. Deviations: the mark's tooltip is a native `title` (the tooltip module can't change its text); the disconnect command opens Frame Cloud on that row with its Disconnect question already open, via a new `confirmDisconnect` option on `cloudHub.open`. Files: cloudProjectMark.js, projectSettingsModal.js, index.js, index.html, cloudHub.js, cloudHubTabs.js, cloud-hub.css.

_Captured: 2026-09-17 · 7 file change(s)_

---

## T11 — Privacy note and module map

Rewrote PRIVACY.md's Frame Cloud section: where it lives now, no plan label, the stored web origin, and a new Cloud projects part covering what listing and connecting send (folder name, git remote, `projectId`) to the configured server, when the list is read, that only a first-time `projectId` is written into a project, and where `cloud-projects.json` and the prompt flag live. Added a `cloud` feature to `scripts/intent-map.json` and regenerated STRUCTURE.json. Deviation: the feature lists all five `main/cloud/*` files (the task said four; `sessionStore.js` is the fifth).

_Captured: 2026-09-17 · 3 file change(s)_

---


---

## UI/UX pass (after T11)

Reshaped the modal from screenshots with the user, in commit `100295b`:
- The modal takes the guide's size.
- The header is an avatar card. The workspace has Open in browser (new
  `CLOUD_OPEN_WORKSPACE_ON_WEB`, `buildWorkspaceWebUrl`). "Last seen" is gone.
- Cloud projects drops the Source column and the slug, aligns its rows with
  `subgrid`, and draws four cases from this device's view: Connected + Open;
  Connected elsewhere; Ready to connect, which claims in place; and Not on this
  device, with a `note` tooltip instead of a CTA.
- On this device becomes list + detail with one decisive action per folder.
  **Departs from §6: no ticking and no Connect selected (n) in this phase.**
- The signed-out state becomes a pitch (`cloudWelcome.js`) beside a sign-in
  card that holds every device-flow step. Learn more is disabled.

Candidates now load as soon as the list is ready, so both tabs can read them.
The decisions and the user's words are in PROJECT_NOTES, 2026-09-18.

Files: index.html, cloudHub.js, cloudHubTabs.js, cloudWelcome.js,
cloud-hub.css, tooltip.js, tooltip.css, variables.css, cloudProjects.js,
cloudProjectsService.js, ipcChannels.js, test/cloudProjects.test.js.

_Captured: 2026-09-18 · 12 file change(s)_
