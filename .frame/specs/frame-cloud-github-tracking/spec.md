---
keywords: frame cloud, github tracking, pull request, pr state, review state, tracking off, implemented, briefs panel
related: frame-cloud-brief-done, frame-cloud-brief-manual-done, frame-cloud-brief-start, frame-cloud-briefs-read-only
---

# Frame Cloud GitHub tracking

## Problem

FrameCloud's `brief-github-tracking` (PR #27) made GitHub tell the cloud about
pushes, pull requests and reviews, and gave each project a "Track pull
requests and merges on GitHub" setting. Its spec leaves "phase 2's PR tones
and `partStatus` order" to a Frame spec. Frame's Briefs view has not followed:

- **`off` reads as `ready`.** `MERGE_TRACKING` in `cloudBriefs.js` knows only
  `ready` and `needs_github`, and `normalizeBrief` falls back to `ready`. On a
  project with tracking turned off, Move to Done asks for a reason the server
  does not need, parts are counted as "N of M merged" although nothing can
  merge, and no notice says tracking is off.
- **Pull requests are dropped.** `normalizePart` keeps none of `prNumber`,
  `prState`, `prBase`, `prReview` and `prUrl`. A part with an open, approved or
  changes-requested PR still reads "On `<branch>`" or "Implemented".
- **An off-target merge is invisible.** A PR merged into another base keeps
  the part short of merged, and Frame shows no reason why.
- **Nothing asks GitHub now.** The server's read-time check became a
  10-minute fallback; the web has "Refresh from GitHub" (`brief.refresh`),
  Frame has no such control.

## Goal

Frame's Briefs view shows what GitHub tracking adds, in the web's words.

- **Three tracking values.** `mergeTracking` is `ready | needs_github | off`
  on the brief and on the board (`mergeTrackingOf`: `needs_github` wins, then
  `off`).
- **Tracking off.**
  - Move to Done needs no reason, as under `needs_github` (`copy.needsReason`
    already keys on `ready`).
  - A part whose completion is recorded reads "Implemented"; the summary
    reads "N of M implemented", where a merged part counts as implemented.
  - The Ready for Done badge is hidden.
  - The board shows the web's notice, "GitHub tracking is off for this
    project. Turn it on in the project's settings to ask GitHub.", with "Open
    on web" leading to the project's settings.
- **PR states on a part row,** only while tracking is `ready`:
  - "PR #N · Open", "PR #N · In review", "PR #N · Approved" (tone `review`);
  - "PR #N · Changes requested" (tone `attention`);
  - "Merged into `<prBase>`, not `<target>`" for an off-target merge (tone
    `attention`).
  - "PR #N" opens `prUrl` in the browser.
- **Summary and card.** The parts summary gains "N in review" and "N changes
  requested" beside merged, implemented and dropped. The card names the first
  thing a person should look at, as the web's K2 attention row does.
- **History.** `part-merged`, which Frame still reads as "changed this
  brief" (frame-cloud-brief-manual-done D8), gets the web's sentence: "“title”
  merged into `<target>` at `<sha>`", with "through PR #N" for `pr` evidence
  and no actor.
- **Refresh from GitHub** in the brief detail calls `brief.refresh` and
  re-reads the brief. It is absent unless tracking is `ready`.

## Constraints

- The cloud alone decides merged; Frame only points with a branch and a SHA
  (frame-cloud-brief-done). A PR is a pointer on the row and never counts as
  a merge in Frame.
- The words are the web's, verbatim, ported into `cloudBriefsCopy.js` rather
  than shared (frame-cloud-briefs-read-only, frame-cloud-brief-manual-done).
- Frame never builds a GitHub URL. It opens the server's `prUrl`, and only
  when it is http(s) (frame-cloud-briefs-read-only: network text is escaped
  plain text).
- The setting changes only on the web, in the project's Settings (FrameCloud
  2026-11-08). Frame shows it and links there.
- No timers and no polling: the board reloads on open, on focus, after a
  write and on a cloud push (frame-cloud-briefs-read-only T11).
- A Done brief's rows keep their words and offer no Begin, Run or Refresh
  (`partStatus({ done })`).
- An older server sends no PR fields and no `off`. Rows then read as today.
- `brief.refresh` is a `work` procedure; who sees the control belongs to
  frame-cloud-roles.
- Unit tests cover the pure core and copy (project convention: DOM untested).

## Success Criteria

- When a project's tracking is off, then Move to Done sends at once with the
  Undo hold, and no reason dialog opens.
- When tracking is off and a part's completion is recorded, then its row
  reads "Implemented" and the summary reads "N of M implemented".
- When tracking is off, then the board shows the notice once, above the
  columns, and "Open on web" opens the project's settings.
- When a project has no GitHub installation and tracking is also off, then
  the `needs_github` notice shows, not the off one.
- When a part has an open PR with no review, then its row reads
  "PR #N · Open".
- When the PR's review is requested, approved or changes requested, then the
  row reads "In review", "Approved" or "Changes requested" after the number.
- When a PR is merged into a base other than the brief's target, then the row
  reads "Merged into `<base>`, not `<target>`" and the part does not count.
- When a PR is merged into the target, then the row reads "Merged into
  `<target>`", as today.
- When "PR #N" is clicked, then the pull request opens in the browser; with
  no `prUrl`, the number is plain text.
- When "Refresh from GitHub" is pressed, then the brief is re-read after the
  server's check, and a `TRACKING_OFF` refusal shows the web's sentence.
- When the server sends none of the PR fields, then every row reads as it
  does before this spec.

## Out of Scope

- Turning tracking on or off from Frame
- Link commit and Drop part from Frame (`brief.linkCommit`, `brief.dropPart`)
- Opening a pull request for a part from Frame
- Live updates to an open panel (the WS hub)
- Checks and CI status
- Hiding controls by role (frame-cloud-roles)

## Open Questions

- **Where the PR states sit in `partStatus`.** The web's order is dropped →
  merged → PR → Implemented → On branch. Frame also has the folder's own
  record and a live lane between merged and On branch.
  - (a) A live agent's lane wins over the PR; otherwise the PR wins over the
    record's own state.
  - (b) The PR always wins once one exists.
- **Is Refresh from GitHub needed in Frame?**
  - (a) Yes, in the detail's Parts tab, as on the web.
  - (b) No: webhooks plus the reads Frame already makes are enough, and the
    web keeps the control.
- **The permission-pending state** (Pull requests · read not yet approved).
  - (a) Frame shows nothing; PR fields are simply absent.
  - (b) Frame repeats the web's badge with "Open on web".
