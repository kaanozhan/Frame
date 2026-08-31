# Plan — project-dropdown

## Approach

Remove the rail markup/CSS and strip projectListUI down to a headless
controller: keep the projects array, selection flow, auto-select-first,
next/prev, add/remove, agent-status map and the workspace-nav block; delete
row rendering, drag reorder, rail expansion, list keyboard nav and the
custom badge tooltip. The existing switcher in index.js stays the single
selection UI: shown on every tab, menu rows extended with attention dots
(from the stored status map) and a × remove button (confirmRemoveProject,
now exported). The Projects tab becomes workspace-nav + a bottom-pinned
Add new Project button. focus() clicks the switcher open.

## Footprint

- index.html
- src/renderer/projectListUI.js
- src/renderer/index.js
- src/renderer/projectSection.js
- src/renderer/styles/components/project-section.css
- src/renderer/styles/layout.css
