# Plan — center-specs-tasks-views

## Approach

Dashboards gain an inline mode: `mountInline(container)` appends the module's
root element into multiTerminalUI's content container with an `.inline` class
(static positioning), loads data, and reports open state; `show()`/`toggle()`
delegate to a registered inline host so every existing deep link lands in the
center. multiTerminalUI adds viewModes `'specs'` and `'tasks'` that mount the
dashboards, plus `showSpecs()` (lifecycle-first: top active spec via
LIST_SPECS → specSection.open, fallback inline grid) and `showTasksBoard()`.
Closing (Escape/×) routes back to the terminals view. The sidebar nav wires
Specs/Tasks to these entry points and lights them up from the surface state.

## Footprint

- src/renderer/specsDashboard.js
- src/renderer/tasksDashboard.js
- src/renderer/multiTerminalUI.js
- src/renderer/projectListUI.js
- src/renderer/styles/components/panels.css
- src/renderer/styles/components/tasks-dashboard.css
- src/renderer/styles/components/terminals-view.css
