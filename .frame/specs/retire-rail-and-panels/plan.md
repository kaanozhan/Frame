# Plan — retire-rail-and-panels

## Approach

A generic panel host in multiTerminalUI: viewMode `'panel'` plus
`_activePanelKey`, with a PANEL_REGISTRY mapping nav keys to
{ elementId, module open/close }. Mounting appends the existing panel
element into the center container with a `.panel-inline` override class and
calls the module's own show() (data loading unchanged). A MutationObserver
on the element's class attribute routes the module's own hide() (× buttons,
internal close paths) back to the terminals view — zero edits inside the
five panel modules. The workspace nav gains one entry per destination; the
instrument rail and its CSS are deleted; the theme toggle re-homes to the
sidebar icon rail.

## Footprint

- src/renderer/multiTerminalUI.js
- src/renderer/projectListUI.js
- src/renderer/index.js
- src/renderer/instrumentRail.js (deleted)
- src/renderer/sampleBanner.js
- index.html
- src/renderer/styles/components/panels.css
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/layout.css
