# Plan — project-rail

## Approach

Move `#projects-list` + `#project-add-btn` into a new `#project-rail`
body-level column (before `#sidebar`). `createProjectItem` gains a leading
initials avatar (accent ring when isFrameProject, replacing the FRAME
tag/📁 marker); name/status/remove stay in the row and are revealed only in
the expanded state via CSS (rail body is an absolutely positioned flyout
whose width animates 56→240px on :hover/:focus-within; overflow hidden +
nowrap keep collapsed rows clean). Agent badges collapse to a corner dot on
the avatar. The workspace nav re-homes from "after the active list item" to
a static `#workspace-panel` inside the sidebar's Projects tab, with a
project header updated in setActiveProject. All list logic (selection, drag
reorder, remove, badges, keyboard, auto-select) is untouched.

## Footprint

- index.html
- src/renderer/projectListUI.js
- src/renderer/styles/layout.css
- src/renderer/styles/components/project-section.css
- src/renderer/styles/components/terminals-view.css
