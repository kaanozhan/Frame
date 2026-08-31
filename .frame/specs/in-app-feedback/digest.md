---
keywords: feedback, github issue, github discussion, feature idea, mailto, sidebar nav, support channel, bug report
related: sidebar-nav-groups, audit-q3-ux-error-feedback, audit-q3-product-analytics, settings-by-scope
---
A Feedback row in the sidebar's Frame group opens a three-tab panel — Bug,
Feature idea, Reach us — and the kind is the routing: an issue form, a
discussion under Ideas, a mail draft. One table in `src/shared/feedbackReport.js`
holds each kind's label, prompts, channel and whether it attaches diagnostics;
the panel renders that table and the tab strip comes from it, so a tab cannot
exist in markup the composer does not know. `compose()` is the only body
builder and takes diagnostics optionally — with none there is no Environment
section at all, which is how a feature idea sends nothing about the machine.
Every channel opens a draft the user submits: the `gh` CLI path was built
(T08/T09) and removed, because filing from the CLI publishes at once under the
reporter's account with no chance to read the markdown, fix a line, or drag in
a screenshot. That also killed labels — GitHub drops `labels=` for anyone
without triage rights — and the subject prefix, and the IPC channel with them.
Rules established: the kind decides the channel, never the reporter; a
transport may only encode; the form shows exactly what it sends. Requires
Discussions enabled on `kaanozhan/Frame`; recipients are three personal inboxes
with a TODO for the day Frame owns an address. Tested as pure logic only (D4) —
no DOM harness exists.

Chain: spec.md → plan.md → tasks.md → outcome.md
