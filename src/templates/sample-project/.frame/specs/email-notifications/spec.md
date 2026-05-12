# Email notifications for task assignment

## Why

Users assigned a task by a teammate currently find out only when they
open TaskFlow. For small teams working asynchronously across time
zones, that's too slow. The minimum bar: a transactional email when a
task is assigned to you, with the title + a deep link.

## What's in scope

- Email on task assignment (to the assignee, not the assigner)
- Email on task @mention in description (someone tags you)
- Per-user opt-out in Settings → Notifications
- Plain-text + HTML version of each email
- Footer with unsubscribe link

## What's out of scope (v1)

- Slack / Discord / webhook integrations — separate spec later
- Digest emails ("3 things happened today") — needs preference
  modeling we don't want yet
- Push notifications (browser or mobile)
- Notification *inbox* in the app — see PROJECT_NOTES 2026-03-22

## Open questions for /spec.plan

- Email provider choice: Postmark vs SendGrid vs SES. Postmark has the
  best deliverability for transactional; SES is cheapest. Need to pick.
- Background job runner: BullMQ (Redis) or just `setImmediate` + retry?
  Depends on what fails when the email API is slow.
- Template engine: Handlebars vs MJML? MJML gives us the responsive
  HTML for free.

## Success criteria

- Email arrives in inbox < 30s after assignment
- Opt-out is honored within 1 minute of toggle
- Unsubscribe link works without requiring login
- No email leaks (test fixtures shouldn't be able to send real mail)
