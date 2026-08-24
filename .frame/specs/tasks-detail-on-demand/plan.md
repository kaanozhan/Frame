# Plan — tasks-detail-on-demand

## Approach

Replace the three scattered "show empty / hide content" toggles in
`tasksDashboard.js` with one `syncAside()` that owns the aside's visibility:
form open → form; else selected task → detail; else collapsed. Every path
that changes selection or form state (`selectTask`, `clearSelection`,
`showForm`, `hideForm`, the TASKS_DATA re-render, `hide()`/project change)
routes through it, so there is a single place where the panel can be wrong.

Collapse is `display: none` on `.tasks-dashboard-detail` (default) with an
`.open` class re-enabling `display: flex`. The columns are already
`flex: 1; min-width: 0`, so removing the aside from layout widens them with
no further CSS work.

The empty-state block (`.tasks-dashboard-detail-empty` and its add card /
hint) is deleted from markup, CSS and JS — with the aside hidden by default
it can never be seen, and the header's New Task button is the surviving
entry point.

## Footprint

- index.html
- src/renderer/tasksDashboard.js
- src/renderer/styles/components/tasks-dashboard.css
