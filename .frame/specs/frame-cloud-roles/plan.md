# Plan — Frame Cloud roles

## Architecture

### Resolved plan-time decisions

Business (asked, 2026-11-14):

- **D1 · A role Frame does not know.** Chosen: no special handling. Frame
  copies the protocol's `WORKSPACE_PERMISSIONS` and `can()` exactly. Rejected:
  "treat as viewer" and "hide nothing". Why: the user pointed out that the
  server's role is a closed enum (`admin | developer | viewer`,
  `workspaceRoleSchema`) and production runs #28. Only a session stored
  before #28 could hold an old value, and `loadSession` re-reads `device.me`
  at every launch. Under the copied `can()`, an unknown role simply holds no
  permission. The spec's Open Question is closed by this.
- **D2 · What a viewer sees of Frame Cloud in Frame.** Chosen: no cloud
  surface; send them to the web. A viewer still signs in. The Frame Cloud
  window shows their role and a card ("viewers follow the work on the web",
  Open on web) in place of the two tabs. There is no Briefs row, no Connected
  mark, no Connect / Create / Disconnect (window, Project Settings, palette).
  Local Frame works as always. Rejected: read-only Briefs (the spec's G2–G4).
  Why: the user's call ("a viewer has no business with Frame App"). The
  evidence pass also showed that a viewer can never link a folder
  (`link.claim` needs `work`). They reach Briefs only through a clone whose
  committed `projectId` already matches (`cloudProjects.js:79`). This
  **replaces** spec G2, G3, G4 and changes S1 and S3; the coverage table maps
  them to the new behaviour.
- **D3 · Hidden or disabled.** Chosen: hidden, with one line saying why.
  Asked; the user asked for the role model instead of picking. Once D2 took
  viewers out, it only concerns a developer's Create. Decided as the spec's
  G6 states it, matching the web's `useCan()`. Rejected: disabled with a
  tooltip.
- **D4 · A viewer's local specs, and Run for a viewer.** Moot after D2: a
  viewer has no Briefs, so neither question arises.

Business (silent):

- **D5 · Project Settings' Frame Cloud row.**
  - A viewer gets the viewer sentence and "Open Frame Cloud", with no
    Connect… or Disconnect.
  - A developer keeps both. Create is hidden inside the window anyway.
  - Why: the row is the same write surface as the window (evidence: the
    spec did not list it).
- **D6 · Palette commands.** `cloud.connectProject` and
  `cloud.disconnectProject` are not offered without `work`.
  - Why: they only open the window's On this device tab, which a viewer no
    longer has. The viewer card says why. This is how S9's "say why rather
    than fail" holds.
- **D7 · Precedence.** No workspace beats viewer. A signed-in user with no
  workspace sees the no-workspace card, as today.
- **D8 · What "Connected" means for teammates.** It stays as recorded
  (FrameCloud PROJECT_NOTES 2026-09-16, "Identity, not authority").
  - Raised by the user during this gate.
  - Confirmed: a teammate's brief writes reach the cloud exactly like the
    linker's. `services/brief.ts` checks membership and role, never the
    machine.
  - The wording on teammates' screens is a separate discussion, outside this
    spec.

Technical (asked):

- **D9 · How Frame learns a changed role.** Chosen: `cloudSession` re-reads
  `device.me` on every window focus while signed in. Today it does this only
  while there is no workspace. Rejected: re-reading alongside each Briefs
  list. Why: one listener keeps the window, Project Settings, the mark and
  Briefs current. It is the pattern frame-cloud-no-workspace already runs
  without a throttle (its D9), and it uses no timer
  (frame-cloud-projects).
- **D10 · Test posture.** Chosen: pure logic only. Rejected: none. Why: the
  project's convention (PROJECT_NOTES `## Testing`: pure modules under
  `test/*.test.js`, no DOM harness).

Technical (silent):

- **D11 · One permission map, in main's pure core.** `cloudProjects.js` gains
  `WORKSPACE_PERMISSIONS` (`work`: admin, developer; `manage`: admin), `can()`
  and `permissionsOf(role) → { work, manage }`.
  - The renderer never sees the map. `cloudProjectsService.publicState()`
    carries `permissions: { work, manage }`, and every renderer surface
    already listens to that state.
  - The role itself already reaches the renderer through
    `CLOUD_SESSION_STATE`, which is used for display only.
- **D12 · Main refuses before it sends.** Every write entry checks the
  permission it needs and returns `{ ok: false, reason: 'roleForbidden' }`
  without a request. The renderer is untrusted (frame-cloud-brief-start).
  Hiding is not protection (FrameCloud workspace-invites-and-roles).
- **D13 · `ROLE_FORBIDDEN` is its own reason, and it re-reads the role.**
  - `CODE_KINDS` maps `ROLE_FORBIDDEN` → `roleForbidden`, so every service
    that goes through `cloudProjectsService.call()` reports it.
  - `call()`'s failure path calls `cloudSession.refresh()` on `roleForbidden`
    and on `noWorkspace`. The second closes the evidence drift on C4: a
    removed member now reaches the no-workspace card on the refusal itself,
    not on the next launch.
  - Nothing is retried (frame-cloud-brief-done: final refusals are never
    retried).
- **D14 · A changed permission is pushed.** `onSessionChange` today pushes
  `CLOUD_PROJECTS_STATE` only when the server or workspace changes. It also
  pushes when `permissions` change, so the window, mark, Briefs row and open
  panel follow without a restart.
- **D15 · Copy lives in one new pure renderer module, `cloudRoles.js`.** It
  holds:
  - role labels (Admin / Developer / Viewer);
  - the workspace-with-role line;
  - the viewer card and the viewer's Project Settings row;
  - the developer's "An admin adds projects to Frame Cloud." line;
  - the `roleForbidden` sentence.

  `cloudBriefsCopy.js` and the window's `LINK_ERRORS` read that sentence
  from it. The agent-facing replies (`cloudDiscussions.js`, `cloudShape.js`)
  keep their own "Not recorded: …" / "Not shaped: …" voice.
- **D16 · The viewer card reuses the window's stand-in panel.** The
  no-workspace card already replaces the tab bar and both tabs in
  `#cloud-no-workspace` (`cloudHub.js:420`). The viewer card draws into the
  same element, so `index.html` does not change.
- **D17 · No auto-shown On this device for a viewer.**
  `shouldAutoShowDevices` takes `canWork`. The after-sign-in prompt is
  dropped for a role that cannot connect anything (frame-cloud-projects:
  the window never opens by itself except that landing).
- **D18 · In-flight flag is stale.** spec-context marks `cloudSession.js`,
  `deviceFlow.js` and `cloudHub.js` IN-FLIGHT under frame-cloud-early-access.
  That spec merged as #26 with its digest and outcome. Only its `status.json`
  still reads `tasks_generated`, so this is not a collision.

### Shape

```
device.register / device.me ──► session.workspace { id, slug, name, role, … }   (already stored)
cloudSession.getAuth().cloudWorkspace { name, slug, role }                     (role added)
cloudProjects.permissionsOf(role) ──► { work, manage }
cloudProjectsService
  ├─ can(permission) / refuseUnless(permission) → null | { ok:false, reason:'roleForbidden' }
  ├─ publicState().permissions                    → renderer
  └─ call() failure: roleForbidden | noWorkspace → cloudSession.refresh()
cloudSession focus (signed in) ──► refresh() ──► onSessionChange ──► push when permissions changed
```

| Role | Frame Cloud window | Briefs row, Connected mark | Connect / Disconnect | Create (`link.create`) | Brief writes, done reports |
|---|---|---|---|---|---|
| admin | tabs, "Workspace · Admin" | yes | yes | yes | yes |
| developer | tabs, "Workspace · Developer" | yes | yes | hidden, "An admin adds projects to Frame Cloud." | yes |
| viewer | viewer card instead of tabs | no | no | no | refused in main, never sent |
| no workspace | no-workspace card (unchanged) | no | no | no | refused (unchanged) |

Reads are not gated anywhere (C3). Main still serves `list` and `get` to any
caller; for a viewer, only the Frame surfaces that would ask are gone.

Write entries and the permission each needs:

| Entry (main) | Calls | Needs |
|---|---|---|
| `cloudProjectsService.linkClaim`, `linkRelease` | `link.claim`, `link.release` | work |
| `cloudProjectsService.linkCreate` | `link.create` | manage |
| `cloudBriefsService.create`, `decide`, `move` | `brief.create` (+ `addAttachment`), `brief.decide`, `brief.moveToDone` / `moveBackToActive` | work |
| `cloudDiscussionsService.discuss`, `handleFile` | prompt staging; `brief.recordDiscussion` (+ `addAttachment`) | work |
| `cloudShapeService.shape`, `handleFile` | prompt staging; `brief.shape` | work |
| `cloudStartService.start`, `sendBranch` | `brief.start`; `brief.recordBranch` | work |
| `cloudDoneService.report` | `brief.recordBranch`, `brief.recordCompletion` | work (skips silently) |

## Files

- `src/main/cloud/cloudProjects.js` — **Modified.** Adds:
  - `WORKSPACE_PERMISSIONS`, `can`, `permissionsOf`;
  - `ROLE_FORBIDDEN: 'roleForbidden'` in `CODE_KINDS`;
  - `shouldAutoShowDevices` takes `canWork`.
- `src/main/cloud/cloudSession.js` — **Modified.** `getAuth().cloudWorkspace`
  carries `role`. The focus listener re-reads `device.me` whenever signed in.
- `src/main/cloud/cloudProjectsService.js` — **Modified.**
  - `can`, `refuseUnless` and `publicState().permissions`;
  - a push when permissions change;
  - `call()` re-reads the session on `roleForbidden` / `noWorkspace`;
  - guards on `linkClaim`, `linkCreate`, `linkRelease`;
  - auto-show gets `canWork`.
- `src/main/cloud/cloudBriefsService.js` — **Modified.** `work` guards on
  `create`, `decide` and `move`.
- `src/main/cloud/cloudDiscussionsService.js` — **Modified.** `work` guards on
  `discuss` and on recording in `handleFile`.
- `src/main/cloud/cloudDiscussions.js` — **Modified.** A `roleForbidden`
  reply in `REASON_MESSAGES`.
- `src/main/cloud/cloudShapeService.js` — **Modified.** `work` guards on
  `shape` and on shaping in `handleFile`.
- `src/main/cloud/cloudShape.js` — **Modified.** A `roleForbidden` reply in
  `REASON_MESSAGES`.
- `src/main/cloud/cloudStartService.js` — **Modified.** `work` guards on
  `start` and `sendBranch`.
- `src/main/cloud/cloudDoneService.js` — **Modified.** `report` returns
  without `work`.
- `src/renderer/cloudRoles.js` — **New.** Pure copy: role labels,
  workspace-with-role, the viewer card and Project Settings row, the
  developer's create line, the `roleForbidden` sentence.
- `src/renderer/cloudBriefsCopy.js` — **Modified.** `roleForbidden` in the
  reason, decide, discuss, shape, start, move and create message tables.
- `src/renderer/cloudBriefsPanel.js` — **Modified.** `isAvailable()` also
  needs `permissions.work`, so a viewer has no Briefs row and an open panel
  leaves.
- `src/renderer/cloudProjectMark.js` — **Modified.** The Connected mark needs
  `permissions.work`.
- `src/renderer/cloudHub.js` — **Modified.** The workspace row shows the role.
  The stand-in panel draws the viewer card when signed in with a workspace
  and without `work`.
- `src/renderer/cloudHubTabs.js` — **Modified.** Without `manage`:
  - Create is hidden: "Create a new project instead", and `drawCreate`'s
    form and foot;
  - a create-mode row shows the developer's line, with "Connect to an
    existing project…" when there are candidates;
  - `LINK_ERRORS.roleForbidden`.
- `src/renderer/projectSettingsModal.js` — **Modified.** The viewer branch of
  the Frame Cloud row.
- `src/renderer/index.js` — **Modified.** `cloud.connectProject` and
  `cloud.disconnectProject` need `permissions.work`.
- `test/cloudProjects.test.js` — **Modified.** `can`, `permissionsOf`,
  `classifyLinkError` on `ROLE_FORBIDDEN`, and `shouldAutoShowDevices` with
  `canWork`.
- `test/cloudRoles.test.js` — **New.** Role labels, the workspace-with-role
  line, the viewer card copy with and without a web origin, the developer
  line.
- `test/cloudBriefsCopy.test.js` — **Modified.** `roleForbidden` resolves to
  the role sentence in every message table.
- `test/cloudDiscussions.test.js` — **Modified.** `replyMessage` for
  `roleForbidden`.
- `test/cloudShape.test.js` — **Modified.** `replyMessage` for
  `roleForbidden`.

## Footprint

- src/main/cloud/cloudProjects.js
- src/main/cloud/cloudSession.js
- src/main/cloud/cloudProjectsService.js
- src/main/cloud/cloudBriefsService.js
- src/main/cloud/cloudDiscussionsService.js
- src/main/cloud/cloudDiscussions.js
- src/main/cloud/cloudShapeService.js
- src/main/cloud/cloudShape.js
- src/main/cloud/cloudStartService.js
- src/main/cloud/cloudDoneService.js
- src/renderer/cloudRoles.js
- src/renderer/cloudBriefsCopy.js
- src/renderer/cloudBriefsPanel.js
- src/renderer/cloudProjectMark.js
- src/renderer/cloudHub.js
- src/renderer/cloudHubTabs.js
- src/renderer/projectSettingsModal.js
- src/renderer/index.js
- test/cloudProjects.test.js
- test/cloudRoles.test.js
- test/cloudBriefsCopy.test.js
- test/cloudDiscussions.test.js
- test/cloudShape.test.js

## Dependencies

None.

## Sequencing

1. **The permission core.** In `cloudProjects.js`:
   - add `WORKSPACE_PERMISSIONS`, `can(role, permission)` and
     `permissionsOf(role)`, a literal copy of the protocol's map and `can()`;
   - add `ROLE_FORBIDDEN: 'roleForbidden'` to `CODE_KINDS`;
   - give `shouldAutoShowDevices` a `canWork` input (false → no auto-show).

   Tests in `test/cloudProjects.test.js`:
   - each role × permission, and an unknown or missing role holding neither;
   - `classifyLinkError` on a 403 whose message is `ROLE_FORBIDDEN`;
   - the auto-show rule with `canWork: false`.
2. **The role reaches main's services and the renderer.**
   - `cloudSession.getAuth()` adds `role` to `cloudWorkspace`.
   - `cloudProjectsService` gains `can(permission)` and
     `refuseUnless(permission)`, and `publicState().permissions`
     (`{ work: false, manage: false }` while signed out or without a
     workspace).
   - `onSessionChange` remembers the last permissions and pushes when they
     change under the same session key.
   - The auto-show computation passes `canWork`.
3. **Learning a changed role.**
   - `cloudSession.init`'s focus listener calls `refresh()` whenever signed
     in, not only without a workspace.
   - `cloudProjectsService.call()`'s failure path calls
     `cloudSession.refresh()` when the reason is `roleForbidden` or
     `noWorkspace`, and still returns the failure unchanged.
4. **Main guards on links and briefs.**
   - `linkClaim` and `linkRelease` need `work`; `linkCreate` needs `manage`.
   - `cloudBriefsService.create`, `decide` and `move` need `work`. A move
     already held keeps going through `call()`, so a role lost during the
     hold comes back as `roleForbidden` from the server.
   - Each guard runs after the connected-folder check and before any request.
5. **Main guards on agent paths, Start and Done.**
   - `cloudDiscussionsService.discuss` and `cloudShapeService.shape` refuse
     to stage a prompt without `work`.
   - Their `handleFile` answers a request with `roleForbidden` without
     calling the server.
   - `cloudDiscussions.js` and `cloudShape.js` `REASON_MESSAGES` gain the
     `roleForbidden` reply, with tests in `test/cloudDiscussions.test.js` and
     `test/cloudShape.test.js`.
   - `cloudStartService.start` and `sendBranch` need `work`.
   - `cloudDoneService.report` returns at once without `work`.
6. **The role copy.**
   - New `src/renderer/cloudRoles.js` with role labels, `workspaceLine(ws)`
     ("Acme · Developer"), the viewer card, the viewer's Project Settings
     row, `CREATE_ADMIN_ONLY` and `ROLE_FORBIDDEN`. Wording follows the web:
     role names as on the members page; viewers "can read everything in the
     workspace"; "An admin can change your role."
   - `cloudBriefsCopy.js` points `roleForbidden` in `REASON_MESSAGES`,
     `DECIDE_MESSAGES`, `DISCUSS_MESSAGES`, `SHAPE_MESSAGES`,
     `START_MESSAGES`, `MOVE_MESSAGES` and `CREATE_MESSAGES` at
     `ROLE_FORBIDDEN`.
   - Tests in the new `test/cloudRoles.test.js` and in
     `test/cloudBriefsCopy.test.js`.
7. **A viewer has no cloud surface in Frame.**
   - `cloudBriefsPanel.isAvailable()` and `cloudProjectMark.update()`
     require `permissions.work`. Both already re-run on every projects push,
     so a role change hides or shows them.
   - `cloudHub` draws the viewer card into the stand-in panel when signed in
     with a workspace and without `work`. No workspace keeps its own card.
   - `projectSettingsModal.renderCloudRow` gets the viewer branch.
   - `index.js` adds `permissions.work` to the two palette `when`s.
8. **Developers and the role line.**
   - `cloudHub`'s workspace row reads `cloudRoles.workspaceLine`.
   - Without `manage`, `cloudHubTabs` hides "Create a new project instead" in
     `drawConnect`. It replaces `drawCreate`'s form and foot with the
     developer's line, plus "Connect to an existing project…" when the row
     has candidates.
   - `LINK_ERRORS` gains `roleForbidden`.
