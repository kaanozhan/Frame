---
keywords: frame cloud, briefs, cloud briefs, brief board, read-only, sidebar briefs, milestones, brief detail
related: frame-cloud-projects, frame-cloud-sign-in, brief-capture-and-shaping
---
# Frame Cloud briefs, read-only

## Problem

`frame-cloud-projects` lets a folder be connected to a Frame Cloud project,
and there it stops: the briefs planned for that project on the web stay
invisible in Frame. Someone working in a connected folder has to switch to
the browser to see what the work is, what state it is in, and what was said
about it.

The server is already ready. On FrameCloud's `feat/desktop-projects` the
desktop bearer token reaches every `brief.*` and `milestone.*` procedure
(`workspaceProcedure`, covered by `apps/server/test/access.test.ts`). Only the
desktop UI is missing. FrameCloud's notes (2026-09-16) set the desktop to
read-only against the cloud for now: no brief writes from Frame.

## Goal

A **Briefs** row in the workspace nav, in the Context group, directly under
Sessions. It exists only while the open project's folder is connected to a
cloud project. Clicking it shows that project's briefs read-only, in the
centre area, the way Sessions opens.

**List.** A board like the web's (`brief-board.tsx`): columns Backlog /
Active / Done, grouped by the brief's derived `status`, and a **Show closed**
toggle that adds a Closed section. Each card shows `#number`, a Proposal or
Work badge, the title, the priority (work only), the milestone name, and for
an ended brief its ending fact ("Closed: reason", "Dropped: reason",
"Recorded as decision"). The header carries a count, **Refresh** and **Open
on web**.

**Detail.** Clicking a card slides a full-page detail over the board, with a
back button that returns to it. This is the Specs view's drawer behaviour
(`specsDashboard.js`), reused. The detail has a header (`#number`, kind,
status, title, **Open on web**), meta (priority, milestone, "Created <date>
by You / A workspace member"), and four tabs:
- **Description**: the body and the attachments (links).
- **Parts**: shape, type, title and why.
- **Comments**: text, author, date.
- **History**: `brief.events` turned into sentences.

Nothing in the panel writes to the cloud.

**Data.** The main process reads the data. The renderer sends only the
folder path. Main resolves the folder's connected project slug from
`cloudProjectsService`'s own state, calls the server with the session token,
and returns plain data. Calls used: `brief.list`
(`{projectSlug, includeClosed}`), `brief.getByNumber`, `brief.events`,
`milestone.list`, and `auth.me` (to say "You").

**Freshness.** Data is fetched when the panel opens, when Refresh is pressed,
and when the cloud state changes while the panel is visible. Nothing polls.

## Constraints

- **Read-only.** No mutation is called and no write control is drawn, even
  though the server would accept desktop writes (FrameCloud
  `desktop-projects` G5). Writes are a later decision.
- **Placement overturns `frame-cloud-projects`.** That spec's Out of Scope
  put briefs "likely [in] a dock tab beside the terminal". This spec places
  them in the sidebar under Sessions, by the user's decision (2026-09-18).
- **Hidden when not connected.** The nav row does not render unless the open
  folder is connected (`folders[].connected && project`, the same test
  `cloudProjectMark.js` uses). It shows no teaser, no Connect hint and no
  badge. When the folder stops being connected while the panel is open, the
  view returns to terminals.
- **Nav key and names.** `brief-capture-and-shaping` on `feat/pm-enhancement`
  already uses the nav key `briefs`, `briefsView.js` and the `.briefs*` CSS
  namespace for local briefs. This work uses `cloud-briefs` / `cloudBriefs*`
  so the two can meet in one tree. The visible label is "Briefs".
- **The token stays in main.** The renderer never receives the token and
  never names a slug or project id. Main resolves both from the folder path,
  following the `openOnWeb` pattern in `cloudProjectsService.js`.
- **Reuse the session handling.** Calls go through `cloudProjectsService`'s
  `call()` wrapper, so a 401 signs out silently and `DEVICE_NOT_REGISTERED`
  re-registers and retries once, both unchanged.
- **Body text is plain text.** The web renders it as `pre-wrap` text. Frame
  escapes it with `htmlUtils.escapeHtml` and does not run it through
  `marked`: this content comes from the network, and the renderer's regex
  scrubbing is not a sanitizer.
- **Attachment links** open in the system browser through the existing
  external-link path, and only for `http(s)` URLs.
- **No new dependency.** The web's copy helpers (`lib/brief.ts`:
  `KIND_COPY`, `priorityLabel`, `endingFact`, `formatDate`, `eventSentence`)
  are ported, not shared. The port has no Electron import, so it can be
  tested.
- **No names for people.** The server has no member endpoint. Authors and
  actors read "You" or "A workspace member", as on the web.
- **Server dependency.** Brief access needs FrameCloud's
  `feat/desktop-projects`, which `project.list` and `link.*` already require.
  Frame adds no fallback for older servers.

## Success Criteria

- When the open folder is connected to a cloud project, then a Briefs row
  appears under Sessions in the Context group.
- When the folder is not connected, or the user is signed out, or no server
  resolves, then no Briefs row renders.
- When the user switches to a project whose folder is not connected, then
  the row disappears. If the Briefs panel was showing, the view leaves it.
- When the user clicks Briefs, then the project's open briefs appear in
  Backlog / Active / Done by `status`, in server (`number`) order, and the
  nav row is highlighted.
- When Show closed is turned on, then ended briefs appear in a Closed section
  with their ending fact.
- When the project has no briefs, then the panel shows an empty state and a
  link to the project on the web.
- When a card is clicked, then the detail slides in over the board with the
  brief's header, meta and the four tabs. When the back button is clicked,
  the board returns.
- When the detail is open, then no control on it changes the brief. The only
  actions are tab switching, links, Refresh, Open on web and back.
- When the body contains HTML or script text, then it is shown as literal
  text.
- When a request fails (offline, server error), then the panel shows an
  error state with Retry. A 401 signs the user out silently, as elsewhere.
- When the panel is open and Refresh is pressed, or the cloud projects state
  changes, then the data is re-fetched.
- When the renderer asks for briefs of a path that is not a connected
  folder, then main refuses without calling the server.
- The pure core (`cloudBriefs.js`) and the copy helpers have unit tests:
  grouping, ending facts, event sentences and input shapes.

## Out of Scope

- Any brief or milestone write from Frame (create, decide, drop, close,
  reopen, comment, parts, attachments).
- A top-bar chip that pins the open brief (the Specs drawer chip).
- A Milestones or Inbox view.
- Briefs of projects that have no folder on this device.
- Reconciling cloud briefs with the local briefs of
  `brief-capture-and-shaping`.
- Live updates (WS hub) or polling.
- Member names or avatars.
