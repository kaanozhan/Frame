---
keywords: frame cloud, milestone, started milestone, milestone strip, overdue, milestone progress, board filter, briefs panel
related: frame-cloud-briefs-read-only, frame-cloud-briefs-create, frame-cloud-brief-start, frame-cloud-brief-manual-done
---

# Frame Cloud milestones

## Problem

FrameCloud built milestones in two steps. `milestone-board` (PR #31) gave them
pages, a goal, an end date, brief counts and Start / Close / Reopen.
`board-active-milestone` (PR #32) allowed one started milestone per project,
put it on the Board as a strip with progress and Overdue, let the Board be
narrowed to it, and let a milestone carry its own target branch. Both specs
list "Milestones in Frame desktop" as out of scope.

Frame reads `milestone.list` since frame-cloud-briefs-read-only, which left
milestone views out. It keeps three fields:

- **`normalizeMilestone` keeps `id`, `name` and `status`.** The goal, the end
  date, the target branch and the brief counts are dropped.
- **A card and the detail show a milestone's name, nothing else.** Nobody
  working in Frame sees which milestone is the started one, when it ends, how
  far it is, or that it is overdue.
- **The board cannot be narrowed.** To see the started milestone's briefs, a
  developer leaves Frame for the web.
- **The target branch moves without a word.** A milestone's target branch is
  applied to its unfinished briefs, so a brief's `targetBranch` can change
  after a part was begun from the old one.

## Goal

The Briefs view shows the project's started milestone and can be narrowed to
it. Milestones stay read-only in Frame.

- **More of the milestone.** `normalizeMilestone` also keeps `goal`,
  `targetDate`, `targetBranch`, `startedAt`, `closedAt` and `briefs`
  (`backlog`, `active`, `done`, `closed`).
- **A strip above the columns** while the project has a started milestone:
  its name, end date, "N of M done", a progress bar and Overdue. The name
  opens the milestone's page on the web. No started milestone, no strip.
- **Narrowing.** The strip narrows the board to that milestone's briefs and
  back to all briefs. The three columns and Show closed stay. The board opens
  on all briefs.
- **Telling cards apart.** On the full board, the started milestone's name on
  a card is a badge; any other milestone's name stays plain text.
- **The detail's Milestone row** reads the name with its status and end date,
  "Overdue" included, and opens the milestone on the web.
- **Home's tracker** (added at plan time, 2026-11-15). While the open folder's
  Briefs are available and its project has a started milestone, Home shows
  that milestone on the "Welcome to Frame!" row: the strip's facts on one
  line (name, Overdue, end date, progress bar, "N of M done"). Clicking it
  opens Briefs narrowed to that milestone. No started milestone, no tracker.

## Constraints

- Milestone controls stay on the milestone's page on the web (FrameCloud
  board-active-milestone). Frame creates, edits, starts, closes and reopens
  nothing (frame-cloud-brief-manual-done: every other brief or milestone
  mutation stays on the web).
- A milestone groups briefs, it does not hold them: every brief stays in its
  column, and narrowing is a view the user chooses (FrameCloud
  milestone-board D7).
- Progress is done / (backlog + active + done); closed briefs are outside it.
  Overdue is a started milestone whose end date is before the viewer's local
  today with briefs left. Both are computed in Frame's pure core with the
  web's rules (`lib/milestone.ts`), ported rather than shared.
- The strip counts from the board's own briefs, a held move included, so
  Move to Done moves the numbers without a re-read (FrameCloud
  board-active-milestone; frame-cloud-brief-manual-done's hold).
- A project has at most one started milestone. An older server may still
  return several; Frame then shows the earliest started one and never fails.
- An older server sends no counts, date or target branch. The strip then
  shows the name only, and the rest reads as today.
- No new request: `milestone.list` and `brief.list` already carry everything.
  Home's tracker reads `milestone.list` alone. No timers
  (frame-cloud-briefs-read-only T11).
- Network text is escaped plain text; the web link is built in main from the
  stored origin (frame-cloud-projects).
- A viewer sees the same strip and narrowing; nothing here is a write.
- Unit tests cover the pure core and copy (project convention: DOM untested).

## Success Criteria

- When a project has a started milestone, then the board shows its name, end
  date and "N of M done" above the columns.
- When that milestone is past its end date with briefs left, then the strip
  reads Overdue.
- When a project has no started milestone, then the board looks as it does
  today.
- When the strip's name is clicked, then the milestone's page opens in the
  browser.
- When the board is narrowed, then the columns and Show closed hold only that
  milestone's briefs, and clearing it brings every brief back.
- When a brief is opened from a narrowed board and closed, then the board is
  still narrowed.
- When a brief of the started milestone is moved to Done, then the strip's
  numbers follow at once, and follow back on Undo.
- When a card belongs to the started milestone, then its milestone name is a
  badge; a card of a planned or closed milestone shows plain text.
- When the open folder changes to another project, then the narrowing is
  cleared.
- When the server sends a milestone with only `id`, `name` and `status`, then
  nothing breaks and the strip shows the name.
- When the open folder is connected and its project has a started milestone,
  then Home shows its tracker beside "Welcome to Frame!".
- When Home's tracker is clicked, then Briefs opens narrowed to that
  milestone.
- When the open folder is not connected, or its project has no started
  milestone, then Home looks as it does today.

## Out of Scope

- Creating, editing, starting, closing and reopening a milestone in Frame
- A Milestones page in Frame (the web's `/milestones`)
- Milestone dates in notifications or an inbox
- Burndown, velocity and timeline views
- A workspace-level view across projects
- Moving a begun part's branch onto a new target

## Open Questions

- **A brief's milestone from Frame.** `brief.setMilestone` is a `work` call
  the web makes from the brief detail.
  - (a) Frame stays read-only; "Open on web" changes it.
  - (b) The detail's Milestone row becomes a select, as on the web.
- **A milestone in Frame's New brief form** (frame-cloud-briefs-create).
  - (a) No: a brief takes its milestone afterwards, on the web.
  - (b) A Milestone select for work, offering open milestones.
- **Does the narrowing survive?**
  - (a) It lives in the panel and is cleared when the panel closes.
  - (b) It is remembered per project across launches.
- **A target branch that moved under a begun part.** The brief's
  `targetBranch` follows its milestone; a part's branch may have been cut
  from the old target. Frame's start record may not hold the base it used.
  - (a) Nothing: the row reads "On `<branch>`" and the merge check uses the
    new target.
  - (b) Record the base at Begin and say so on the row when it differs.
- **Planned milestones.** The web's strip is the only filter.
  - (a) Same in Frame: only the started milestone narrows the board.
  - (b) A select over every open milestone, plus "No milestone".
