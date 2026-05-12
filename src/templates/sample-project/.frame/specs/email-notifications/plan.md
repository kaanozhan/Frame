# Plan — Email notifications for task assignment

## Provider: Postmark

Picked over SendGrid (price-comparable, worse deliverability for
transactional) and SES (better price but harder ops — bounce/complaint
handling is on us). Postmark gives us a clean API, automatic suppression
list management, and reasonable pricing at our scale.

## Architecture

```
Task assigned   →   Worker queue (BullMQ)   →   Postmark API   →   Inbox
       │                      │
       │                      ↓
       │              Retry policy (5x, exponential)
       │                      │
       └──────── Audit log ───┘
```

### Why a queue

- Postmark API can be slow or rate-limited. We don't want the user
  waiting on the assignment write while we send mail.
- Retries on transient failures (timeouts, 5xx) without coupling to
  the request lifecycle.
- A dead-letter queue lets ops see what's stuck.

### Why not just `setImmediate`

Considered. Two reasons it loses:
1. Lost on process restart. We deploy multiple times a week.
2. No retry, no visibility, no audit.

The Redis cost (~$10/mo for our scale) is worth it.

## Templates: MJML → compiled HTML

Templates live in `src/email/templates/*.mjml`. A build step compiles
them to HTML + a plain-text variant. The runtime renderer just
interpolates `{{user_name}}`, `{{task_title}}`, `{{task_url}}` into the
compiled output.

Three templates initially:
- `task_assigned.mjml`
- `task_mentioned.mjml`
- `welcome.mjml` (already exists as inline HTML — port to MJML)

## Opt-out model

Single boolean per user: `email_notifications_enabled` on the users
table, defaults true. The unsubscribe link sets it to false using a
signed token (no login required).

Granularity (per-type opt-out) is explicitly deferred. We can add it
later without a migration.

## Risks

- **Deliverability spiral.** If users mark emails as spam, our domain
  reputation tanks. Mitigation: clear opt-out, sane defaults, low
  send volume. Set up DMARC + SPF + DKIM properly before launch.
- **Token leakage in unsubscribe links.** Mitigation: tokens are
  scoped (just toggle this one user's bool), single-use, and signed.
  Compromise of one token doesn't compromise the account.

## Files touched (estimated)

- New: `src/notifications/queue.js`, `src/notifications/sender.js`,
  `src/email/templates/*.mjml`, `src/email/renderer.js`,
  `src/db/migrations/008_email_prefs.sql`
- Modified: `src/api/tasks.js` (enqueue on assign),
  `src/api/users.js` (settings endpoint), `src/ui/Settings.jsx`
- Tests: heavy fixturing in `tests/notifications/`

## Estimated effort

3-5 days of focused work. The MJML build pipeline + queue setup are
the long poles; the actual notification logic is simple once those
are in place.

---

*Run `/spec.tasks` to break this into a discrete task list when ready
to start. Currently this spec is in `planned` phase — captured but not
yet scheduled.*
