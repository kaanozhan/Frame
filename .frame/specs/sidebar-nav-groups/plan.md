# Plan — sidebar-nav-groups

## Approach

`WORKSPACE_NAV_ITEMS` becomes `WORKSPACE_NAV_GROUPS`: an array of
`{ key, label, items[] }` holding the same row descriptors. `buildWorkspaceNav`
renders a header plus a rows container per group; `refreshWorkspaceNav` keeps
its existing per-row queries, so counts, agent chips and the `.on` highlight
need no rework.

Collapse state lives in localStorage under one key (`frame-nav-groups`), read
at build time and written on toggle — same shape as the terminals view's
prefs. When a group is collapsed and holds the active surface, its header
carries the `.on` marker, so the highlight is never invisible.

History retires: its nav row, its `PANEL_REGISTRY` entry, its palette entry,
its `#history-panel` markup and `historyPanel.js` all go. The IPC channels
stay — `promptsPanel` is their other consumer, and `TOGGLE_HISTORY_PANEL`
now lands only there, which is what the menu item already wanted.

## Footprint

- src/renderer/projectListUI.js
- src/renderer/multiTerminalUI.js
- src/renderer/paletteSources.js
- src/renderer/historyPanel.js (deleted)
- index.html
- src/renderer/styles/components/project-section.css
- src/renderer/styles/components/panels.css
