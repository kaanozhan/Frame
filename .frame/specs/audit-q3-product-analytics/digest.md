---
keywords: telemetry, analytics, events, opt-out, privacy, aptabase, registry
related: audit-q3-reliability-recovery
---
Went from one `app_started` event to a 10-event registry answering roadmap
questions without weakening privacy: every event+prop+value declared in
`telemetryEvents.js` (pure module, enum-only, unit-tested) — `track()` drops
anything unregistered, renderer events revalidated in main over
TELEMETRY_TRACK. Fail-closed opt-out: unreadable user-settings + failed .bak
⇒ telemetry off for the session (closed the re-opt-in corruption bug).
Activation = unique users per plain event (no first_* milestones). Stayed on
Aptabase (PostHog rejected — identity/funnels conflict with no-user-tracking
stance). Cardinality guards: custom tools → `custom`, plugin ids never sent,
errors are a fixed 9-category enum. Rule: any registry addition lands in
PRIVACY.md in the same change.

Chain: spec.md → plan.md → tasks.md → outcome.md
