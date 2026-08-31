# Outcome — project-dropdown

Shipped 2026-08-20. Live-verified + 222 tests pass, no boot errors,
watchdog quiet.

## What shipped

- **Rail removed** (overturning same-day project-rail, explicitly): markup,
  avatar/flyout CSS and expansion handlers gone; the sidebar is back at the
  window's left edge.
- **The current-project switcher is the one selector**: visible on every
  tab including Projects (its "hidden on Projects" special case removed).
  Menu rows kept Frame tags and gained agent-attention dots (from the
  status map) and a hover × remove (confirmRemoveProject, now exported).
  "+ Open a project…" entry unchanged.
- **projectListUI → headless controller** (~700 → ~380 lines): projects
  array, selection, first-boot auto-select, next/prev, add/remove, badge
  store (getAgentStatus), workspace nav. Row rendering, drag reorder, list
  keyboard nav, custom tooltip, avatars deleted. `focus()` ("Focus Project
  List") opens the switcher via registered hooks; data changes rebuild the
  menu while open.
- **Projects tab** = workspace nav + bottom-pinned Add new Project
  (projectSection slimmed to that one binding).
- **Orphaned CSS pruned**: old .project-item family (layout.css), the
  entire list/header/status top half of project-section.css.

## Known regression (accepted in spec)

Drag-to-reorder projects has no UI (REORDER_WORKSPACE_PROJECTS IPC stays
for a future surface). Dropdown order = stored workspace order.

## Verified live

Dropdown pick switches project → terminals view; label tracks; Cmd+Shift+]
cycles; add button pinned bottom; rows show Frame tag + ×; no pageerrors.
