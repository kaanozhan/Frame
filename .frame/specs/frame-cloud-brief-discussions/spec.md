---
keywords: frame cloud, brief discussion, discuss, proposal, discussion record, lane, agent dispatch, command bus
related: frame-cloud-briefs-read-only, frame-cloud-briefs-create, lane-orchestrator
---
# Frame Cloud brief discussions

## Problem

A proposal is an idea parked for later: a thought captured alone, or
something a team floated that is not work yet. Its value comes from being
talked over, and today that talk happens in an agent session that nothing
connects back to the brief. When the session ends, what was argued and
decided is gone, and the next conversation starts from zero.

FrameCloud now stores these conversations (`brief-discussions` there):
`brief.recordDiscussion({ id, summary, url?, provider? })` appends one
`discussion-recorded` event to an open proposal and writes no column, so the
user's description is never touched. The web lists the records under the
description but deliberately has no way to write one. The writing surface is
Frame.

## Goal

Frame becomes the place where a user expands a proposal by talking it over
with an agent, and every conversation leaves a record on the brief.

- **Discuss.** The detail drawer of an open proposal shows a **Discuss**
  button. It opens a new lane, starts the project's default AI tool (no
  picker), and hands it Frame's
  discuss prompt: the brief's number, title, description, links and every
  earlier discussion record, so a second conversation continues the first.
  The prompt steers the agent to understand the proposal, discuss it with
  the user, never rewrite the description (a better wording is offered as a
  suggestion inside the conversation), and at the right moments ask whether
  to record what has been settled so far.
- **A summary document, when the user wants one — as a link only.** When
  the lane's CLI can publish a document (a claude.ai artifact from Claude
  Code), the agent may offer to write the discussion up there, and only does
  so on a yes. The published link becomes the record's `url`. Local
  HTML/Markdown files are not offered yet (decided by the user,
  2026-09-21).
- **Recording.** On the user's yes, the agent runs one command that Frame
  staged for this lane. The command drops a request on a Frame command bus;
  main calls `brief.recordDiscussion` and writes a reply the command prints
  ("recorded", or why not), so the agent can tell the user truthfully.
  `provider` is set by main from the lane's CLI, not by the agent.
- **The lane is visible from the brief.** A lane opened by Discuss is
  assigned to the brief (`assignment.kind: 'brief'`). While it is open, the
  brief's card and detail show the lane's activity dot, and the Discuss
  button becomes **Go to discussion**, which enters that lane. One lane per
  brief.
- **Reading.** The Description tab lists the brief's discussion records
  below the description, newest first: date, who recorded it, the provider,
  the summary as plain text, and the link when there is one. History names
  the event. When a record lands while the drawer shows that brief, it
  reloads.

## Constraints

- **One new write, and only this one.** `frame-cloud-briefs-create` allowed
  `brief.create` and its `brief.addAttachment` calls and nothing else. This
  spec adds `brief.recordDiscussion` and no other mutation — in particular no
  `brief.update`: the description stays the user's, and the agent never
  edits it (decided by the user, 2026-09-21).
- **The token and the brief id stay in main.** As in the read and create
  specs. The staged command and the bus request carry a discussion id that
  main issued at Discuss, never a brief id, slug or token; main maps it to
  the folder, the brief number and the CLI. A request with an unknown id, or
  for a folder that is no longer connected, is refused without calling the
  server.
- **The command needs no `.frame/`.** A connected folder need not be a Frame
  project, so the command is staged by main outside the repo and named by
  absolute path in the prompt, run with the `FRAME_NODE` every terminal
  already has (`ptyManager.js`). Nothing is written into the user's repo by
  Frame.
- **Reuse the bus idiom, not the orchestration bus.** Requests are written
  atomically (tmp + rename) and drained by a main-side watcher, as
  `orchestrationManager` does for `$FRAME_ORCH_BUS`; the discussion bus is
  its own directory and does not depend on an orchestration session.
- **Reuse dispatch.** The lane is opened through `agentDispatch.dispatch`
  (`createNew`), which already refuses at the lane cap with a message and
  never types into a bare shell.
- **Validate in main.** `summary` is required and at most 10,000 characters
  (`BRIEF_TEXT_MAX`); `url` is optional and only `http(s)`. The server's
  refusals (`NOT_A_PROPOSAL`, `ALREADY_CLOSED`, `BRIEF_NOT_FOUND`, network,
  sign-out) come back to the command as sentences.
- **Only open proposals.** Discuss is not shown on work or on an ended
  proposal; the server refuses both anyway.
- **Plain text, as before.** Summaries are network content: escaped, never
  run through `marked`. Links open in the system browser, `http(s)` only.
- **Session handling unchanged.** Calls go through `cloudProjectsService`'s
  `call()`; a 401 signs out quietly.
- **Names.** `cloudBriefs*` / `cloud-briefs`, as the earlier cloud brief specs
  keep them apart from local briefs.

## Success Criteria

- When an open proposal is shown in the drawer, then it has a Discuss button;
  when a work brief or an ended proposal is shown, then it has none.
- When Discuss is clicked, then a new lane opens with the project's default
  AI tool and
  receives one prompt carrying the brief's number, title, description, links
  and earlier discussion records, and the absolute path of the staged
  command. The prompt offers a summary document only as a published link
  and never offers a local file.
- When a lane opened by Discuss is open, then the brief's card and detail
  show its activity dot and the button reads Go to discussion, which enters
  that lane; when the lane is closed, then Discuss returns.
- When the agent runs the command with a summary, then exactly one
  `brief.recordDiscussion` is sent with that summary, the optional `url`, and
  the lane's CLI as `provider`, and the command prints that it was recorded.
- When the server refuses (not a proposal, ended, not found, network,
  signed out), then no record exists and the command prints the reason.
- When the command is run with an unknown discussion id, an empty or too
  long summary, or a non-`http(s)` url, then nothing is sent and the command
  says why.
- When Frame is not running, then the command gives up after a bounded wait
  and says Frame did not answer.
- When a record lands while its brief is open in the drawer, then the
  Description tab shows it at the top of the Discussions list without a
  manual refresh, and History has a line for it.
- When a summary contains HTML or script text, then it is shown as literal
  text.
- The prompt builder, the request validation and the bus request/reply
  handling have unit tests under `node --test`.

## Out of Scope

- Editing the brief from a discussion (`brief.update` or any other write).
- Recording a discussion held outside Frame (claude.ai, ChatGPT) without a
  Discuss lane.
- Discuss on work briefs.
- Choosing which CLI Discuss starts.
- Local HTML/Markdown summary files. Kept as a note: they will need support
  later, since a record can only point at an `http(s)` link today.
- Transient "discussing…" state visible to other devices or on the web.
- Holding records locally while offline and syncing them later.
- Editing or deleting a discussion record.

