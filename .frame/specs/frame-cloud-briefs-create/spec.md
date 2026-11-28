---
keywords: frame cloud, briefs, new brief, create brief, cloud write, brief.create, attachments, ai links
related: frame-cloud-briefs-read-only, frame-cloud-projects, frame-cloud-sign-in
---
# Frame Cloud briefs, create

## Problem

`frame-cloud-briefs-read-only` shows a connected project's briefs in Frame,
but a new one can only be opened on the web. Someone who spots work while
in the terminal has to switch to the browser, find the project and open
New brief there, then come back and press Refresh to see it in Frame.

FrameCloud has supported this since `brief-board`. The web's **New brief**
panel (`new-brief-dialog.tsx`) calls `brief.create` and then
`brief.addAttachment` once per link. On `feat/desktop-projects`, the desktop
bearer token already reaches both: `apps/server/test/access.test.ts` covers
"lets a desktop create a brief with its bearer". The only missing piece is
Frame's UI.

## Goal

A **New brief** button in the Briefs panel header, and in its empty state.
It opens a form that slides in over the board. This is the same drawer the
detail uses (the Specs drawer behaviour). The form matches the web's:

- **Kind**: a Work / Proposal switch, with Work selected by default. The
  chosen kind's explanation shows under it (`KIND_COPY`).
- **Title**: required, up to 200 characters (`BRIEF_TITLE_MAX`).
- **Description**: optional plain text.
- **Priority**: shown only for Work. Medium unless changed.
- **AI conversations & links** (optional), as on the web: a "Paste a
  link…" field. A pasted full `http(s)` URL is added at once; a typed one is
  added on Enter or Add. Each row names its service (Claude artifact or
  chat, ChatGPT, Gemini, Figma, GitHub, otherwise the host) as a default
  title that can be edited, and can be removed. Anything that is not an
  `http(s)` URL is refused with a message and kept in the field for fixing.
- A submit button labelled **Create work** or **Create proposal**. It shows
  **Creating…** while the request runs.

There is no milestone, target branch or assignee field. As on the web, a
new brief takes the workspace's default target branch, and nothing else is
set.

**Data.** The renderer sends the folder path and the form's fields. Main
resolves the connected project slug from `cloudProjectsService`, as the
read path does. It builds the `brief.create` input
(`{projectSlug, kind, title, body?, source, priority?}`), sends priority only
for Work and leaves out an empty body. It calls the server through the same
`call()` wrapper. Then, in order, it calls `brief.addAttachment`
(`{id, title, url}`) once per link. It stops at the first link that fails,
and returns the created brief's `number` together with any attachment
failure. The create and its links are one IPC call, so the renderer never
holds a brief id.

**After creating**, the drawer closes onto the board, which reloads and
shows the new brief in its column. If a link failed, the brief still
exists. The board then shows a dismissible notice: "Brief #n was created,
but some links were not attached." followed by the error sentence. It does
not open the detail, which is where the web differs.

## Constraints

- **This overturns read-only for creating.** `frame-cloud-briefs-read-only`
  held "no mutation is called and no write control is drawn", following
  FrameCloud's notes (2026-09-16), which planned for writes to come later.
  This spec lifts that rule for `brief.create` and for the
  `brief.addAttachment` calls that follow it inside the same create. Every
  other write stays out, including adding a link to an existing brief.
- **The token stays in main.** As in the read spec, the renderer never names
  a slug, project id, brief id or token. Main refuses a path that is not a
  connected folder without calling the server.
- **Reuse the session handling.** 401 and `DEVICE_NOT_REGISTERED` behave as
  they already do in `cloudProjectsService.call()`.
- **Validate on both sides.** The renderer blocks an empty or whitespace
  title and a title over 200 characters before sending. Main checks the
  input's shape again (kind, priority enum, lengths) and does not trust the
  renderer. The server's refusals (`PROJECT_NOT_FOUND`, `NOT_WORK`,
  `BAD_REQUEST`, …) are turned into sentences ported from the web's
  `briefErrorMessage`, and the form stays open with what was typed.
- **Links are checked in main too.** Main accepts only `http(s)` URLs and
  titles of 1–200 characters after trimming (`BRIEF_ATTACHMENT_TITLE_MAX`).
  An invalid link refuses the whole request before `brief.create` is sent,
  so a bad link never leaves a half-made brief behind.
- **`source` is `desk`.** `brief.create` requires a source. FrameCloud's
  `brief-board` plan gives `desk` to the Board surface, where a person fills
  in a form, and Frame's form is the same kind of surface. `terminal` and
  `context` stay free for later terminal or agent capture. Decided by the
  user, 2026-09-19.
- **No double create.** While a create is in flight, the submit button is
  disabled and Enter does nothing.
- **Names and placement.** Everything stays inside the `cloudBriefs*`
  namespace and the existing `#cloud-briefs-panel`. The `briefs` names used
  by `brief-capture-and-shaping` are left alone.
- **No service logos.** The web's `linkService` rules are ported as pure
  code. Rows show the service's name and the host as text; no logo assets
  are added.
- **No new dependency.** Copy (`KIND_COPY`, `priorityLabel`, the error
  sentences, the links hint) goes into `cloudBriefsCopy.js`. The input
  builder and the `linkService` port go into pure modules with no Electron
  import, so they can be tested.

## Success Criteria

- When the Briefs panel is showing, then the header has a New brief button.
  When the project has no briefs, then the empty state offers one too.
- When New brief is clicked, then the form slides in over the board with Work
  selected, priority Medium, and an empty title, description and link list.
  Each opening starts from an empty form.
- When Proposal is selected, then the priority field disappears, and the
  request carries no priority.
- When submit is pressed with an empty or whitespace-only title, then no
  request is sent and the title field says "Give the brief a title."
- When a valid form is submitted, then exactly one `brief.create` is sent,
  with `projectSlug` resolved in main. The drawer closes, the board reloads,
  and the new brief shows in its column.
- When links are added, then after `brief.create` succeeds, one
  `brief.addAttachment` per link is sent, in the order shown, and the new
  brief's Description tab lists them.
- When a pasted text is not an `http(s)` URL, then it is not added as a
  row, the field says so, and the text stays in the field.
- When a link row's title is cleared, then submit sends nothing and says
  "Each link needs a title."
- When `brief.create` succeeds but a link fails, then no further links are
  sent, the drawer closes onto the reloaded board, and the board shows the
  notice with the brief's number and the error sentence.
- When `brief.create` fails (a server refusal or a network error), then no
  attachment is sent, and the form stays open with its fields intact and an
  error sentence. A 401 signs out silently and the panel hides, as
  elsewhere.
- When the renderer asks to create for a path that is not a connected
  folder, then main refuses without calling the server.
- When the description contains HTML or script text, then it is sent as-is
  and shown as literal text afterwards (the read path already escapes it).
- The input builder, the `linkService` port and the new copy have unit
  tests: Work vs Proposal shape, an empty body left out, title trimming and
  limits, link validation and service naming, stop-at-first-failed-link, and
  error-code sentences.

## Out of Scope

- Every other brief or milestone write: edit, decide, drop, close, reopen,
  record decision, comments, parts, and adding or removing a link on an
  existing brief.
- Milestone, target branch or assignee on create.
- Creating briefs for projects that have no folder on this device.
- Creating a brief from the terminal, the command palette or an agent.
- Local briefs from `brief-capture-and-shaping`, and reconciling them with
  cloud briefs.
- Live updates (WS hub) or polling.
