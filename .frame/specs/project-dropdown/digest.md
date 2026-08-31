---
keywords: project switcher, dropdown, sidebar, headless controller, project selection, add project
related: project-rail, sidebar-project-section, terminals-view
---
Project selection consolidated into the sidebar's current-project switcher,
now visible on every tab (rows: Frame tag + agent-attention dot + hover ×
remove + "+ Open a project…"); the far-left rail (same-day project-rail
spec) was removed — explicit overturn. projectListUI became a headless
controller (no list DOM; selection/auto-select/next-prev/badge store/
workspace nav); Projects tab = workspace nav + bottom-pinned Add new
Project. Accepted regression: no drag-reorder UI (IPC kept). Orphaned
list/rail CSS pruned from layout.css and project-section.css.

Chain: spec.md → plan.md → tasks.md → outcome.md
