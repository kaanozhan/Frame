# Project Notes — TaskFlow

Architectural decisions, context, and "we tried that, didn't work" notes
that should survive across AI sessions. Add new entries at the top.

---

### [2026-03-22] Defer email notifications to v2

Discussed adding email notifications for task assignment. Decision: punt
to v2. Reasoning:

- Adds a third dependency (email provider — SendGrid/Postmark/SES)
- Real-time presence on the dashboard probably covers 80% of the need
- Notifications without preferences = noise; preferences = scope explosion

Captured as `.frame/specs/email-notifications/` for when we're ready.
The spec exists in `planned` phase — we have a plan, no tasks yet.

---

### [2026-03-08] PostgreSQL over MongoDB

We considered MongoDB for the document-shaped task records. Picked
PostgreSQL instead because:

1. Our access pattern is heavily relational (users → teams → tasks)
2. We already needed transactions for the team-assignment flow
3. JSONB on Postgres covers the "flexible payload" need without giving
   up the relational primitives

The migration from SQLite → Postgres is in flight; see the spec at
`.frame/specs/migrate-to-postgres/`.

---

### [2026-02-19] Single OAuth provider for v1

Resisted the urge to support every OAuth provider upfront. Shipped only
Google OAuth in v1. Rationale:

- 92% of our target users have Google Workspace accounts
- Adding GitHub/GitLab/Microsoft each adds setup friction
- Easier to add later than to refactor a multi-provider abstraction
  built before we had real users

Decision encoded in the architecture: `src/auth/oauth.js` is intentionally
not provider-abstracted. When we add a second provider, we'll refactor —
not before.

---

### [2026-02-04] Stick with Express, not Fastify

Fastify is faster on paper. We don't have a performance problem. Stayed
on Express because:

- Larger ecosystem (Passport.js auth integration matters)
- The team knows it cold
- 10ms of latency vs developer velocity is not a real trade for us yet

Revisit if we hit > 1000 req/s sustained on any single endpoint.

---

### [2026-01-15] No microservices

Considered splitting auth, tasks, and notifications into separate
services. Decision: monolith for the foreseeable future. Reasoning:

- We're a 3-person team. Microservices is a tool for large orgs
  managing inter-team coordination, not 3 people in a Slack channel.
- The operational surface (3 deployments instead of 1) is not free.
- Splitting is reversible. Premature splitting wastes weeks.

If we ever hit a real reason (a service that needs different scaling,
different language, different deploy cadence), we'll split *that* one
specifically.
