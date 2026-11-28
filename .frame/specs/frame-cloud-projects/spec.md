---
keywords: frame cloud, cloud hub, cloud projects, project link, projectId, frameProjectId, link.claim, connect folder, disconnect, on this device, rail cloud icon, account
related: frame-cloud-sign-in, settings-by-scope
---
# Frame Cloud projects

> **What we're building:** the desktop side of FrameCloud's desktop-projects
> (kaanozhan/FrameCloud PR #18), and one home for it. A cloud icon at the foot
> of the sidebar rail opens **Frame Cloud**: the account, the workspace's cloud
> projects with their state, and this device's folders with Connect / Create /
> Disconnect. A folder is recognised as a cloud project by its own `projectId`.
> Frame links and lists. It shows no briefs, and it writes nothing into the
> project folder.

## Problem

Frame Cloud sign-in shipped on `feat/frame-cloud-adaptor`
(`frame-cloud-sign-in`): Frame holds a bearer token and shows who is signed
in, inside Settings → Account, and that is all. Projects created on the web
are invisible in Frame, and Frame cannot say "this folder is that cloud
project".

The server side is live. FrameCloud #18 makes the desktop's bearer token a
reader of the workspace and links a folder by the folder's **own identity**:
the `projectId` already in `.frame/config.json` (`frameStore.getProjectId` /
`ensureProjectId`). The server stores it as `project.frame_project_id`, unique
per workspace; a project is "linked" while it carries one. That decision
("identity, not authority", 2026-09-16) replaces the earlier model in which
Frame wrote a `cloud: {projectId, workspaceSlug}` block into `config.json` and
the first device became a project's Home. A draft spec written against that
model (`frame-cloud-project-link`) was never committed; this spec replaces it.

The account, the workspace's projects and "which of my folders are in the
cloud" are all project-independent. Settings is the wrong home for them: a
settings section cannot hold two lists and a bulk action, and a second modal
that pops up after sign-in would stack on it. The rail's foot already holds
Frame's app-scope entries (Plugins, Feedback, Frame Settings, How to Use
Frame), each opening a modal — the account belongs there.

Also stale since FrameCloud #16: `device.register` / `device.me` no longer
return `access`, so Account shows a "Plan" row that always reads "—"
(`index.html:1611`, `frameSettingsModal.js:254`).

## Goal

### The two jobs, and the scenarios behind them

This spec does two things and nothing else: **connect** a folder to the cloud
project it belongs to, and **create** (or connect) a cloud project for a
folder that has none. Which machine a folder sits on plays no part — the
server keeps no device ↔ project relation, and neither does Frame.

| # | on this device | in the workspace | where it shows | what the user can do |
|---|---|---|---|---|
| S1 | no folder | project exists | Cloud projects | see it; Open on the web |
| S2 | Frame folder | nothing matches | On this device · *Not in Frame Cloud* | Create (name + slug prefilled) |
| S3 | Frame folder | a project matches by id / remote / name, unlinked | On this device · *Can be connected* | Connect, or pick another, or Create instead |
| S4 | Frame folder | the project to connect to already carries a **different** `projectId` (a `local`-mode clone, or a `.frame/` that was recreated) | On this device, same row as S3, unchecked | connect after one confirmation |
| S5 | Frame folder | a project carries this folder's id | both tabs, as Connected | Open, Disconnect |
| S6 | folder with `.frame/config.json` but no `projectId` | any | as S2 or S3 | the id is stamped only when the row is connected |
| S7 | folder without `.frame/`, or a path gone from disk | any | a muted count line, no row | initialise it first |
| S8 | a folder that was connected | project deleted on the web | falls back to S2 by itself | — |
| S9 | folders connected in workspace X | signed in to workspace Y | S2 rows; the header names Y | nothing is preselected for Create |
| S10 | any | list unreadable (offline, server down) | cached list + "Last updated …"; link actions disabled | Retry |

### 1. Read and link core — `src/main/cloud/cloudProjects.js`

Pure (no Electron import), built on `deviceFlow.js`'s `callTrpc`. `callTrpc`
today drops `input` on GET; it learns to send query input as
`GET /trpc/<name>?input=<url-encoded JSON>`. The core exposes the calls below,
`matchFolders(list, folders)` (S1–S5 classification from `project.list` and
local ids), `suggestSlug(name)` with local slug validation, and a
classification of link refusals (`remoteMismatch`, `mismatch`, `taken`,
`slugTaken`, `badRequest`, `notFound`).

Server contract (live; bearer from the existing session; main process only; no
transformer; mutation = `POST /trpc/<name>` with the input as the body; result
at `.result.data`):

| call | input → output |
|---|---|
| `project.list` | → `[{id, slug, name, status{source: "scratch"\|"github", link, frame, github}, frameProjectId: string\|null, createdAt}]` |
| `project.checkSlug` | `{slug}` → `{available}` |
| `link.candidates` | `{folderName, remote?, frameProjectId?}` → `[{id, slug, name, match: "id"\|"remote"\|"name"\|null, frameProjectId}]`, matches first. `match: "id"` with `frameProjectId: null` = the project's GitHub repo names this identity but no folder has claimed it |
| `link.claim` | `{projectId, frameProjectId, remote?, acceptRemoteMismatch?, takeOver?}` → `{projectId, projectSlug, workspaceSlug}`; the same identity again is a no-op with the same answer |
| `link.create` | `{name, slug, frameProjectId, remote?}` → same result; created already linked |
| `link.release` | `{projectId, frameProjectId}` → `{ok: true}`; only the stored identity may detach; a project with none answers ok |

Refusals (`message` = code), fixed handling:

| response | Frame |
|---|---|
| 409 `REMOTE_MISMATCH` | the row asks "This project points at another repository. Connect anyway?"; yes retries with `acceptRemoteMismatch: true` |
| 409 `FRAME_PROJECT_MISMATCH` on claim | the project carries a different `projectId`: the row asks once ("…already connected to a folder with a different identity. Connect this one instead?"); yes retries with `takeOver: true` |
| 409 `FRAME_PROJECT_MISMATCH` on release | this folder is not the owner — treat as detached, refresh, no error dialog |
| 409 `FRAME_PROJECT_TAKEN` | the list was stale: refresh; the row becomes Connected to the project that carries this id |
| 409 `SLUG_TAKEN` | error on the slug field, suggest the slug with `-2` |
| 400 `BAD_REQUEST` | should not happen: validate first — slug is 3–32 of `a-z 0-9` with single inner hyphens, not one of `new, briefs, import, settings, members, projects, inbox, search`; name non-empty |
| 404 `PROJECT_NOT_FOUND` | refresh the list |
| 401 · 412 `DEVICE_NOT_REGISTERED` · 412 `NO_WORKSPACE` | the sign-in spec's behaviour, unchanged: silent `signedOut` · `device.register` then retry once · web link |

### 2. Main-process service — `src/main/cloud/cloudProjectsService.js`

Takes the token from `cloudSession`; calls through `net.fetch`; lists this
device's folders from `src/main/workspace.js`; reads each folder's identity
with `frameStore.getProjectId` and its remote with
`git remote get-url origin`; caches the last `project.list` in `userData`
(keyed by `serverUrl` + workspace); pushes one state object to the renderer.
The renderer names a folder by **path**; the service reads the id and the
remote itself, so a renderer can never claim with an identity it made up.
`cloudSession` tells the service when the session changes and whether the
change was a sign-in the user started.

### 3. IPC

In `src/shared/ipcChannels.js`, handlers beside the existing `CLOUD_*` block:
`CLOUD_PROJECTS_REFRESH`, `CLOUD_FOLDER_CANDIDATES`, `CLOUD_CHECK_SLUG`,
`CLOUD_LINK_CLAIM`, `CLOUD_LINK_CREATE`, `CLOUD_LINK_RELEASE` (invoke) and
`CLOUD_PROJECTS_STATE` (push:
`{ projects, folders, uninitialisedCount, lastUpdated, stale, error? }`).

### 4. The rail's cloud icon and the Frame Cloud modal

A fifth button at the rail's foot, above Frame Settings, opens `#cloud-modal`
(`src/renderer/cloudHub.js`, wide modal). Like its neighbours it opens a modal
and switches no view. **The button does not render when no server address
resolves**, so packaged builds without a server show nothing new. It carries
no badge or dot in any state; its tooltip reads "Frame Cloud" or "Frame Cloud
— <account>".

The modal draws pushed state only (`CLOUD_SESSION_STATE`,
`CLOUD_PROJECTS_STATE`):

- **Signed out / signing in / failed** — the sign-in panes that live in
  Settings → Account today (`signedOut`, `requestingCode`, `awaitingApproval`,
  `registering`, `failed`), moved here unchanged in copy and behaviour. No
  tabs.
- **Signed in** — a header (account name and email · workspace name and slug ·
  this device · **Sign out**, plus the existing `ephemeral` and
  `signedInUnreachable` notes) over two tabs: **Cloud projects** and **On this
  device (n)**, where `n` counts the folders that are not connected. A **Refresh** button and the
  "Last updated …" note sit beside the tabs.

Everything that used to open Settings on Account opens this modal instead: the
`cloud.signIn` palette command, and the "bring Frame to the front" step at the
end of a sign-in.

### 5. Cloud projects tab — the workspace, seen from the cloud

One row per `project.list` entry, server order: name, slug, a source mark
(GitHub or scratch), the link state exactly as the web shows it, and which
folder here it belongs to:

| link state | on this device | row action |
|---|---|---|
| **Connected** | the folder's name (two folders → "2 folders") | **Open** — selects that project in Frame and closes the modal |
| **Connected** | — (no folder here carries its id; nothing to do) | Open on the web |
| **Not connected** | — | **Connect a folder…** — switches to On this device, on the folder whose suggestion is this project when there is one · Open on the web |

The tab has no picker of its own. Empty workspace → "No projects in
<workspace> yet." S10 → cached rows, the stale note and Retry; no cache → the
error and Retry.

### 6. On this device tab — this device, seen from the folders

One row per known folder with `.frame/config.json`, most recently opened
first inside each group. `link.candidates` runs per unconnected folder when
the tab is first shown and on Refresh — a few at a time, rows filling in as
answers arrive.

| group | rows | default | row controls |
|---|---|---|---|
| **Can be connected** (S3, S4) | the first candidate with a `match`, labelled "Your repository" (`id`), "Same remote" (`remote`) or "Same name" (`name`) | checked for `id` and `remote`; **unchecked for `name`, and for a candidate that already carries a different id** (S4, noted "Already connected") | a picker to choose any other candidate, or "Create a new project instead" |
| **Not in Frame Cloud** (S2) | name = the project's name, slug = `suggestSlug`, both editable; `project.checkSlug` live | **unchecked** | "Choose an existing project…" opens the same picker |
| **Connected** (S5) | the cloud project's name and slug | — | **Disconnect** (confirms, then `link.release`; the cloud project stays) |

A refusal that needs an answer (`REMOTE_MISMATCH`, a different identity) is
asked **on the row itself**, with its own two buttons; there is no separate
group or dialog for it. Under the groups, when it
applies: "<n> folders aren't Frame projects yet — initialise them to connect"
(S7). S6 folders are listed like any other; `ensureProjectId` runs for a
folder only at the moment its row is connected or created.

**Connect selected (n)** runs the checked rows one after another. Each row
shows its own progress and ends Connected or stays with its question or
message; one row's refusal never stops the rest. Nothing unchecked is
touched.

**After a sign-in the user started**, if any folder is not connected, the modal —
already open from the sign-in — switches to this tab under one line: "<n>
projects on this device aren't in <workspace>." with **Don't show again**.
That button sets `cloudConnectPromptDismissed` in `user-settings.json` (one
flag per machine) and stops only the automatic switch; the tab, its count and
every action stay. No separate modal exists. A launch with a stored session
or a silent refresh never opens anything.

### 7. What stays with the project

- **Connected mark** on the open project when its `projectId` matches
  ("Connected to <project> in <workspace>"); a miss is silent. The only
  request this makes is the list read.
- **Project Settings → Frame Cloud** (`src/renderer/projectSettingsModal.js`),
  one row, no picker of its own: **Sign in** (opens Frame Cloud) when signed
  out; "Not connected" + **Connect…** (closes Project Settings, opens Frame
  Cloud on this folder's row); when connected, the project's name, **Open
  Frame Cloud** and **Disconnect**. The row does not render for a folder
  without `.frame/config.json` or when no server resolves.

### 8. Settings → Account shrinks to one row

"Signed in as <name> · **Open Frame Cloud**", or "Frame Cloud · **Sign
in…**"; both close Frame Settings and open the modal. The state panes and the
Plan row leave `index.html` and `frameSettingsModal.js`; `access` leaves
`PUBLIC_KEYS`, `deviceFlow.js` (`runSignIn`, `sessionFromMe`) and
`sessionStore.js`.

### 9. Palette

`cloud.open` ("Frame Cloud: Open"), `cloud.connectProject` ("Frame Cloud:
Connect this project"), `cloud.disconnectProject` ("Frame Cloud: Disconnect
this project"), registered in `registerCommands()` (`src/renderer/index.js`)
beside `cloud.signIn`, each with a `when` predicate so it lists only when it
applies.

### 10. PRIVACY.md

Opening On this device or connecting sends each listed folder's name, git
remote and `projectId` to the configured FrameCloud server; the project-list
cache lives under app data; nothing is written into a project.

## Constraints

- **Identity is the only match.** A folder is connected when some project's
  `frameProjectId` equals its `projectId` — never by path, name or remote.
  Those three only rank `link.candidates`. Changing this changes the server.
- **Nothing cloud-related is written into the project folder.** No `cloud`
  block in `config.json`, no link state under `.frame/`. The link lives on the
  server; cache, session and the dismissal flag live under `userData`. This
  reverses the `config.json` `cloud` block that `frame-cloud-sign-in` listed
  under Out of Scope.
- **No identity for a bare directory, and none by listing.** `ensureProjectId`
  stays the only writer, returns null without `.frame/config.json`, and is
  called only when the user connects or creates that folder — never to draw a
  row.
- **No device ↔ project relation, in code or in copy.** Which machine may
  write to a project, the Home machine, mirror push and dispatch belong to
  later specs. No label says or implies that a device owns a project — "On
  this device" only names where the listed folders are.
- **`frame-cloud-sign-in` rules that hold unchanged:** the token stays in the
  main process and every HTTP call is made there; renderer state is built from
  an allowlist; the renderer draws pushed state and owns no second state
  machine; HTTP goes through `net.fetch` with the 15 s timeout and must not
  block startup, a modal or window close; a 401 is a silent `signedOut`; the
  core is pure and runs under `node --test` with a fake fetch; no new
  dependencies, no tRPC client; no new telemetry event; Frame never compares
  plans.
- **`frame-cloud-sign-in` decisions this spec overturns, deliberately:**
  (1) its Goal 6 — the Account section in Frame Settings — moves to the Frame
  Cloud modal; Settings keeps one row. (2) "Reachable from Settings → Account
  and the palette, nowhere else" widens to a rail icon, a Connected mark and a
  Project Settings row. What still holds: with no server resolved nothing new
  renders; nothing local is gated on being signed in or connected; nothing
  opens by itself at launch; no badge, dot or reminder asks the user to sign
  in or connect; the one automatic tab switch follows a sign-in the user
  started and can be turned off for good.
- **Bulk connect never decides for the user.** Create rows and name-only
  matches start unchecked; `REMOTE_MISMATCH` and a different identity are never
  confirmed by Connect selected.
- **One picker, one place.** Candidate picking and the Create form exist only
  in the On this device tab; Project Settings and the palette route there.
- **Modals never stack.** Opening Frame Cloud from Frame Settings or Project
  Settings closes that surface first (`settings-by-scope` C1); Frame Cloud
  does not open over the first-run onboarding screen or the guided tour.
  `settings-by-scope` C3 and C4 hold for the Settings and Project Settings
  rows: re-read on open, and say so when binding fails.
- **Server strings are untrusted.** Project names and slugs are rendered as
  text nodes, never as HTML.
- **One project, one identity — the server's rule, accepted here.** Any number
  of folders on any number of machines read Connected as long as they share
  the `projectId`, which `gitSharing: "repo"` clones do. Folders with
  different ids (`local`-mode clones, a recreated `.frame/`) cannot be
  connected to one project at the same time; connecting one replaces the
  other's id, and the other then reads Not connected.
- **Slug suggestion is a convenience.** It mirrors the server's `slugify`
  (FrameCloud `packages/protocol`) closely, not exactly; `project.checkSlug`
  and `link.create` have the last word. No valid suggestion → the field is
  left empty for the user.

## Success Criteria

- When no server address resolves, then the rail shows no cloud button,
  Settings and Project Settings show no Frame Cloud row, and no request is
  made.
- When a server resolves and Frame is signed out, then the cloud button shows
  with no badge, the modal shows the sign-in pane, and no `project.*` or
  `link.*` request is made.
- When sign-in is started from the rail, the palette, Settings or Project
  Settings, then the code, approval, denial, expiry and cancel behave as
  `frame-cloud-sign-in` specified, inside the Frame Cloud modal.
- When Frame Settings opens signed in, then Account is one row with the
  account name and Open Frame Cloud, with no Plan row; and no `access` key is
  in the `CLOUD_SESSION_STATE` payload or in `cloud-session.json`.
- When a project is created on the web and the modal is refreshed, then it is
  listed in Cloud projects as Not connected (S1), with its source mark; its
  Connect a folder… lands on On this device.
- When any label in the modal is read, then none says a project is connected
  "elsewhere" or belongs to a device.
- When a folder's `projectId` equals a listed `frameProjectId`, then Cloud
  projects reads "Connected · <folder>", On this device lists it under
  Connected, and the open project shows the Connected mark — with
  `project.list` as the only request.
- When On this device opens, then each unconnected folder lands in exactly one
  of Can be connected or Not in Frame Cloud; `id` and `remote` matches are
  checked; name matches, already-connected candidates and Create rows are
  not.
- When Connect selected runs over a mix of rows, then every checked row ends
  Connected or stays with its question or message, unchecked rows are
  untouched, and the web shows Connected for the ones that succeeded.
- When `link.claim` answers `REMOTE_MISMATCH`, then the row asks once and
  retries with `acceptRemoteMismatch: true` only on yes.
- When a folder claims a project that carries a different `projectId`, then
  its row asks once, retries with `takeOver: true` on yes, and the folder
  that held the old id reads Not connected after its next refresh.
- When Create is submitted with a taken slug, then the slug field shows the
  error and a `-2` suggestion; an invalid or reserved slug is rejected locally
  with no request.
- When Disconnect is confirmed, then `link.release` is called, the folder
  leaves Connected, the web reads Not connected, and the cloud project still
  exists; when release answers `FRAME_PROJECT_MISMATCH`, then the result is
  the same with no error dialog.
- When a folder has `.frame/config.json` but no `projectId`, then listing it
  leaves `config.json` untouched, and connecting it stamps the id once.
- When a user-started sign-in completes with unconnected folders, then the modal
  switches to On this device with the one-line notice; when Don't show again
  is clicked, then no later sign-in switches tabs; when Frame launches with a
  stored session, then nothing opens.
- When Connect… is clicked in Project Settings, then Project Settings closes
  and Frame Cloud opens on that folder's row.
- When the network is down with a cached list, then both tabs show cached
  state with "Last updated …" and disabled link actions; when a bearer call
  answers 401, then Frame goes to `signedOut` with no error dialog and the
  modal returns to the sign-in pane.
- When any renderer payload from the projects service is inspected, then it
  carries no token; when a project name contains markup, then it is shown
  literally.
- When `git status` is run in a project after listing, connect and
  disconnect, then the only possible change is a first-time `projectId` in
  `config.json` (S6).
- When `node --test test/cloudProjects.test.js` runs, then it passes with no
  Electron and no network, covering: query input encoding, `matchFolders` for
  S1–S5 and S8, candidate grouping and default checks, claim → mismatch →
  confirmed `takeOver`, stale `taken`, remote mismatch, release mismatch, slug
  suggestion, validation and collision, 401 and 412.
- When PRIVACY.md is read, then it names what listing and linking send, to
  whom, and where the cache is kept.

## Out of Scope

- Briefs, milestones and cloud specs in Frame — reading them as well as
  writing them. A later spec, likely a dock tab beside the terminal.
- Cloning or downloading a cloud project that has no folder here (S1).
- `.frame/` mirror push, the WS hub, dispatch.
- Home machine and the Team authority model; a server-side answer to
  `local`-mode clones sharing one project.
- Settings → Devices; tying device identity to the machine instead of the
  session.
- Switching workspaces from the desktop; a per-workspace or per-folder
  "don't ask" memory.
- The plan tier, `PLAN_REQUIRED` handling and the Pro panel.
- A CLI.

## Open Questions

- **When the list refreshes.** Nothing pushes changes (no WS hub). (a) On
  launch, on session change, when the modal opens, on the Refresh button, and
  on window focus at most once a minute; no timer — recommended; (b) a timer
  while the modal is open.
- **Connected mark beyond the open project.** (a) The open project's header
  only — recommended, the tab already lists every folder; (b) also a small
  cloud mark on connected rows in `projectListUI.js`.
- **"Open on the web" links.** Frame does not know the web address; only
  `verification_uri` carried it. (a) Store that URL's origin in the session at
  sign-in and build `{webOrigin}/{workspace}/{project}` — recommended;
  sessions stored before this spec have none, so the action hides until the
  next sign-in; (b) drop the action from this spec.
- **Wording of the different-identity question.** The server says the project
  carries another `projectId`, nothing more. Proposed: "This project is
  already connected to a Frame folder with a different identity — that happens
  with local sharing mode, or when .frame/ was recreated. Connect this folder
  instead? The other folder will read Not connected."
