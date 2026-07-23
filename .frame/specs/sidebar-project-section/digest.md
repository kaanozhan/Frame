---
keywords: sidebar, projects, open project modal, clone, workspace
related: lane-orchestrator
---
Projects became the root of the sidebar with an Open Project modal (Select
Folder / Create New / Clone GitHub Repo) as a UI shell over existing flows —
`openProjectModal.js` delegates to `state` and `CLONE_GITHUB_REPO`, keeping
the result listener in index.js. Escape handling is gated on modal
visibility so keys never leak to the terminal (repo-wide pattern). Markup,
wiring, and styling landed as separate tasks; per-project terminal sessions
and Frame status surface on the project rows.

Chain: spec.md → plan.md → tasks.md → outcome.md
