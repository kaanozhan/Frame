---
keywords: layout migration, consent, unmerged guard, pre-consent writes, overlay layout, AGENTS.md ownership, project open sequence, deferral
related: non-invasive-overlay, spec-docs-delivery-invariant, activity-monitor
---
Migration split along ownership: Frame's own meta files relocate into `.frame/`
automatically on project open, and only the `AGENTS.md` prose rewrite is asked
about. The deadlock it fixes was an ordering bug — the stagers and
`upgradeSpecDocs` ran before anything asked to migrate, dirtying the root
`AGENTS.md`, after which the dirty-tree guard refused forever.

Rejected: keeping move and rewrite fused (legacy init wrote `AGENTS.md`
everywhere, so no project could migrate silently); a renderer-driven migration
(an IPC round trip that `WATCH_SPECS` races into); storing the pending decision
(after the move the stale file lives in `.frame/` and the fingerprint is gone);
a reopenable receipt modal (the activity panel already is that surface);
`.frame/config.json` for the deferral (committed in `repo` mode, so a teammate
inherits the "no").

Rules established: only unmerged paths (`U` codes, plus `DD`/`AA`) defer a
migration — modified and staged files move with their content. Nothing is
written to a project whose layout question is open, gated in both
`openProjectLayout` and `specManager` because the two IPC messages race. A
decision is derived from the text (`upgradeAgentsText` would change bytes), never
recorded, so applying it empties itself. An automatic move must report itself:
banner plus `migration.completed` carrying `backupDir`. Frame-planted symlinks
are removed silently and `GEMINI.md` gets no replacement — named on the banner,
not asked about.

Chain: spec.md → plan.md → tasks.md → outcome.md
