---
keywords: frame cloud, brief shape, shape, work brief, brief part, part definition, lane, command bus, brief.shape
related: frame-cloud-brief-discussions, frame-cloud-briefs-read-only, frame-cloud-briefs-create
---

# Frame Cloud brief shape

## Problem

In Frame, a proposal can be discussed and moved to work, but a work brief
stops there. Nothing splits it into the specs and tasks that Run will start
from. The brief's Parts tab says "Parts appear once the brief is shaped",
and no action in Frame shapes it.

FrameCloud now stores a Shape (`brief-shape` there). `brief.shape({ id,
parts })` writes every part and `shaped_at` in one transaction on an open,
unshaped work brief. Each part carries `title`, `shape` (`spec | task`),
`type` and a free-markdown `definition`, which replaces `why`: the column
is dropped and its text is copied into `definition`. `addPart` is gone, so
`brief.shape` is the only way a part is born. The web shows parts
read-only and deliberately has no Shape button. The writing surface is
Frame.

## Goal

Frame becomes the place where a decided piece of work is shaped into parts
with an agent, once, on the user's approval.

- **Shape.** The detail drawer and the card of an open, unshaped work brief
  show a **Shape** button. It opens a new lane with the project's default AI
  tool and hands it Frame's shape prompt. The prompt carries the brief's
  number, title, description, links, discussion records and comments, and
  it steers the agent through four steps:
  1. Read the brief and the code. When the folder has `.frame/specs/`, also
     read the spec catalog, so a part does not repeat or collide with an
     existing spec.
  2. Ask the user what the split depends on.
  3. Propose a split: one spec, several specs, tasks, or a mix. Each part
     has a title, `spec | task`, a type, and a definition deep enough that
     `spec.new` could run from it without asking about the goal. The
     definition uses the suggested headings: why, what, decisions made, done
     when, out of scope, open questions.
  4. Write only after the user approves the whole set.
- **One write, at the end.** On the user's yes, the agent runs one command
  that Frame staged for this lane, passing every part in one payload. Main
  validates it, calls `brief.shape` once, and writes a reply that the
  command prints ("shaped into N parts", or why not). A session that ends
  without a yes writes nothing.
- **The lane is visible from the brief.** A lane opened by Shape is assigned
  to the brief. While it is open, the card and the detail show its activity
  dot, and Shape becomes **Go to shaping**. One lane per brief.
- **Reading.** The Parts tab shows "Shaped <date>" and, under each part, its
  definition (collapsed by default). `why` is gone from the view. History
  names the `shaped` event. When a Shape lands while the drawer shows that
  brief, the drawer reloads.

## Constraints

- **One new write.** Earlier specs allowed `brief.create`, `addAttachment`,
  `recordDiscussion` and `decide`. This spec adds only `brief.shape`: no
  `updatePart`, `removePart` or `reorderParts`, and no `brief.update`.
- **Shape is one-shot** (FrameCloud brief-shape). Once `shapedAt` is set,
  the Shape button is gone and never comes back. The server's
  `ALREADY_SHAPED` is still handled as a sentence.
- **The token and the brief id stay in main** (frame-cloud-brief-discussions).
  The staged command and its bus request carry only a session id that main
  issued. Main maps that id to the folder and the brief. A request with an
  unknown id, or for a folder that is no longer connected, is refused
  without calling the server.
- **The prompt travels as a file** (frame-cloud-brief-discussions T18). It
  is staged under userData, and the lane gets a single "Read '<path>' and
  follow it exactly" line. Nothing is written into the user's repo.
- **Reuse, don't fork, the discussion machinery.** The bus is written with
  tmp + rename, claimed by rename, and answered in `replies/`, with a
  bounded wait and withdrawal. Dispatch goes through `agentDispatch`, and the
  lane assignment is `assignment.kind: 'brief'`.
- **Validate in main.** This mirrors FrameCloud's `shapeBriefInputSchema`:
  - at least one part;
  - `title` within the brief title limit;
  - `shape` in `spec | task`, and `type` in `feature | fix | refactor | docs | test`;
  - a `definition` that is not empty and is at most 10,000 characters.

  The server's refusals (`NOT_WORK`, `ALREADY_CLOSED`, `ALREADY_SHAPED`,
  `BRIEF_NOT_FOUND`, network, sign-out) come back to the command as
  sentences. Because `call()` folds codes into `badRequest`, they are
  caught inside the called function, as `decideThrough` does.
- **Plain text.** Definitions are network content, so they are escaped and
  never run through `marked`. They are shown pre-wrapped, as on the web.
- **Tolerant reading.** `normalizePart` reads `definition` and no longer
  reads `why`. A part without a definition shows an empty one rather than
  failing the drawer.
- **Names.** `cloudBriefs*` / `cloud-briefs`, as in the earlier cloud brief
  specs.

## Success Criteria

- When the drawer or board shows an open work brief whose `shapedAt` is
  null, then it has a Shape button. A proposal, an ended brief and a shaped
  brief have none.
- When Shape is clicked, then a new lane opens with the project's default AI
  tool. It receives one line that names a staged prompt file, and that file
  carries the brief's number, title, description, links, discussion records
  and comments, the definition headings, and the absolute path of the staged
  command.
- When a Shape lane is open, then the card and detail show its activity dot
  and the button reads Go to shaping, which enters that lane. When the lane
  is closed and nothing was shaped, then Shape returns.
- When the agent runs the command with N valid parts, then exactly one
  `brief.shape` is sent with those parts in order, and the command prints
  that the brief was shaped into N parts.
- When the command is run with an unknown session id, no parts, or a part
  with a bad shape, type, title or definition, then nothing is sent and the
  command says why.
- When the server refuses (not work, ended, already shaped, not found,
  network, signed out), then no part exists and the command prints the
  reason.
- When Frame is not running, then the command gives up after a bounded wait
  and says Frame did not answer.
- When a Shape lands while its brief is open in the drawer, then the Parts
  tab shows the Shaped date and the parts without a manual refresh, and
  History has a line for it.
- When a definition contains HTML or script text, then it is shown as
  literal text.
- The prompt builder, the parts validation and the bus request/reply
  handling have unit tests under `node --test`.

## Out of Scope

- Run: starting a part as a spec or task, worktrees, and the part lifecycle
  (`started`, `merged`, `dropped`).
- Editing, removing or reordering parts from Frame, and re-shape.
- Deriving the Shaped stage in `statusFor`, or a stage label on the web.
- Shape questions routed to the Inbox, and Shape started remotely.
- The bottom-up entry (New Task / New Spec opening a shaped brief).
- Choosing which CLI Shape starts.
- A published write-up link for the Shape session.

## Open Questions

- **One command or two.** One option is to generalise the discussion
  command and bus into a single brief-session command (one id store, a
  `record` and a `shape` verb). The other is to stage a separate
  `shape-brief.js` beside `record-discussion.js`, with its own id store.
- **Move to Work and Shape.** The lifecycle page suggests an optional chain.
  Should the Move to Work dialog offer "Move to Work and Shape", or should
  Shape stay a separate click on the new work brief?
