---
keywords: feedback, github issue, github discussion, feature idea, mailto, sidebar nav, support channel, bug report
related: sidebar-nav-groups, audit-q3-ux-error-feedback, audit-q3-product-analytics, settings-by-scope
---

# Feedback from inside Frame — an issue, an idea, or an email

> **Revised during implementation (2026-08-31).** This document describes what
> was built. Four decisions were overturned on the way, deliberately and with
> the user; they are listed under **Revision history** at the end and recorded
> in full in `outcome.md`.

## Problem

Frame has no way to hear from the people using it. A user who hits a bug or
wants a feature has to leave the app, find the repository on their own, and
work out where to write — so most of them write nowhere. The one report that
did arrive (issue #122, `spec-status-repair`) was worth a whole spec; it came
from a user who already knew where the repo was. Everyone who doesn't is
silent, and their silence is indistinguishable from satisfaction.

The sidebar already has the shelf this belongs on: the workspace nav's
**Frame** group (`sidebar-nav-groups`) holds the rows that are about Frame
itself rather than the open project, and it currently holds exactly one —
Activity.

## Goal

A **Feedback** row in the sidebar's Frame group opens one panel with three
tabs — one per kind of feedback — and the kind is the whole routing decision.
A reporter can say what they have; they cannot say which transport suits it,
so Frame does not ask.

```
tab (the kind) → { title, description } + the diagnostics that kind attaches
     → compose() → { subject, body }        ← the one place a body is built
     → deliver(channel, subject, body)
          ├─ Bug          → github.com/kaanozhan/Frame/issues/new?title=&body=
          ├─ Feature idea → github.com/kaanozhan/Frame/discussions/new?category=ideas&title=&body=
          └─ Reach us     → mailto:<feedback addresses>?subject=&body=
```

Every channel opens a draft the reporter submits themselves. Frame never
publishes on anyone's behalf, which is what lets them read how the markdown
renders, fix a sentence, and drag in a screenshot before anything exists. One
composer builds every body, so a change to what a report says is a change in
one pure module and the channels cannot drift apart.

## Constraints

- **No Resend, and no third-party mail key in the app.** An API key shipped in
  a packaged Electron app is extractable from `app.asar`; a Resend key is not
  the write-only public identifier that the Aptabase key is
  (`telemetry.js:12-15`). Email leaves through the user's own client over
  `mailto:` — decided with the user on 2026-08-29. Frame gains no outbound
  network call for this feature.
- **The GitHub target is fixed to `kaanozhan/Frame`**, not the open project's
  remote and not `origin`. This feedback is about Frame; routing it at the
  user's own repository would file Frame's bugs in a stranger's tracker.
- **Nothing is published on the user's behalf.** Every channel opens a draft
  on a surface the user submits from — a prefilled issue form, a prefilled
  discussion, a mail draft. Frame reports a handoff, never a send.
- **The kind decides the channel.** The reporter chooses what they have, never
  where it goes; one kind has exactly one destination, and that is what lets
  the tab, its prompts and its routing come from a single table.
- **One composer, no exceptions.** A transport receives a finished subject and
  body and may not build, re-order or append to them. A change to what a report
  says is a change in one pure module.
- **Privacy: a body carries only what the user typed plus the diagnostics the
  form shows them** — and where a kind shows none, it carries none. No project
  path, no project name, no file contents, no repository remote — the same line
  `telemetry.js` and `PRIVACY.md` hold.
- **Errors are visible.** Failures surface through the shared `notify.js`
  toast, and any new markup escapes through `htmlUtils.js`; no local toast and
  no local `escapeHtml` (`audit-q3-ux-error-feedback` rule of record).
- **Any telemetry event added here is declared in `telemetryEvents.js` and
  documented in `PRIVACY.md` in the same change** (`audit-q3-product-analytics`
  rule of record), with enum props only.
- The Frame nav group's existing mechanics stay as they are: `WORKSPACE_NAV_GROUPS`
  row shape, `surfaces` for the active highlight, collapse state in
  `frame-nav-groups` (`sidebar-nav-groups`).

## Success Criteria

- When the sidebar's Frame group is expanded, then it lists **Activity** and
  **Feedback**, and Feedback's row highlights while its surface is open — the
  same way Activity's does, including while the group is collapsed.
- When the user opens Feedback, then the panel offers **Bug**, **Feature idea**
  and **Reach us**, opens on Bug, and each tab asks for what that kind of
  report needs rather than one prompt for all three.
- When the user writes a bug and sends it, then the browser opens on
  `kaanozhan/Frame`'s new-issue page with the title and body already filled in,
  for the user to review and submit.
- When the user writes a feature idea and sends it, then the browser opens on
  `kaanozhan/Frame`'s new-discussion page under the **Ideas** category, filled
  in the same way — a proposal is argued in a discussion, not filed as a defect.
- When the user writes a message on Reach us, then their mail client opens on a
  draft addressed to Frame's feedback addresses with the subject and body
  filled in, and Frame reports it as handed off rather than as sent.
- When the user moves between tabs, then each tab keeps what was typed in it,
  and a tab is cleared only after its own delivery succeeds.
- When a URL-carried body would exceed what the platform's URL handler accepts,
  then Frame copies the body to the clipboard, opens the target without it, and
  tells the user to paste — the same rule on all three channels, and never a
  window that opens empty with no explanation.
- When the same subject and body are handed to each of the three transports,
  then all three carry them byte-identically — asserted by a test over the
  composer, so a transport can only encode.
- When the user submits with an empty title or an empty description, then the
  form says so and sends nothing.
- When a body is composed for a kind that attaches diagnostics, then it
  contains the user's text and the shown diagnostics (Frame version, OS) and
  nothing else; when it is composed for a kind that attaches none, then it
  contains the user's text alone and no Environment section exists at all —
  both asserted by tests over the composer with a project open.
- When feedback is submitted, then one registered telemetry event records the
  channel used and no free-form text.

## Out of Scope

- Sending mail from Frame's own infrastructure (Resend, a relay endpoint, any
  hosted sender) — rejected above; revisit as its own spec if it ever returns.
- Reading, listing or replying to feedback inside Frame. The GitHub panel
  already lists the open project's issues; Frame's own issue list is not this
  spec.
- **Attaching a screenshot from Frame.** No transport here can carry one:
  `mailto:` has no attachment field (RFC 6068 defines `subject`/`body`/`cc`
  only — a URL that could attach local files would be a security hole), and
  GitHub's image upload is web-UI-only, absent from the REST API. Automating it
  would need a hosted uploader, which is the backend this spec already rejects.
  Every route now ends on a page the user can drop an image into before they
  submit, which is the reason the GitHub channels open a form rather than
  filing for them. Decided with the user on 2026-08-29.
- Attaching logs, crash dumps or the activity log to a report.
- In-app feedback about the **user's own project** routed to their repository.
- A feedback entry point anywhere other than the sidebar's Frame group.

## Answered questions

- **Which address(es) does the email path use?** Three personal inboxes
  (`plan.md` D1), with the mutual visibility of a `mailto:` draft confirmed
  with the user before shipping, and a `TODO` marking the day Frame has an
  address of its own.
- **Does the feedback type change routing, or only the text?** It became the
  routing itself: the kind is the tab, the tab is the destination, and no type
  travels inside the report at all.

## Revision history

Four decisions were overturned during implementation. Each is recorded with
its reasoning in `outcome.md`; in short:

1. **The `gh` CLI path was removed** (reversing the ladder in the original
   flow). `gh issue create` publishes immediately under whichever account is
   signed in, so the reporter never sees the rendered markdown, cannot fix a
   sentence, and cannot attach the screenshot that this spec had already
   conceded no transport could carry. With it went the label decision — GitHub
   ignores `labels=` from anyone without triage rights — and the main-process
   wrapper, the IPC channel and the failure classifier.
2. **The body became markdown** (`### Environment` and bullets) once the only
   GitHub path was a rendered page.
3. **The panel split into tabs**, first two and then three, retiring the
   two-buttons-on-one-form design: offering both channels asked the reporter a
   question they had no basis for answering.
4. **A feature request became a discussion, not an issue**, and stopped
   attaching diagnostics. A proposal is not a defect: in a tracker it becomes
   an unassigned task that reads as a rejection when closed, while a discussion
   can be argued, upvoted, and converted into an issue by GitHub the day the
   work is committed to. This depends on Discussions being enabled on
   `kaanozhan/Frame` — confirmed with the user; were it off, the URL would 404
   where Frame cannot see it.
