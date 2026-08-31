# Plan — topbar-presence

## Approach

New `presenceBar.js` renders agent chips into a static container inside the
tab bar's `.terminal-tab-actions`, reusing agentPanel's derivation (terminal
states across projects + laneStatus, agentName-gated) and its focus logic
(state.setProjectPath → enterLane). The launcher markup moves from the
sidebar tab into the same cluster; index.js bindings are untouched because
IDs survive. The Agent tab button, tab content and agentPanel module are
removed along with their CSS; index.js's tab-reveal special case goes too.

## Footprint

- src/renderer/presenceBar.js
- src/renderer/agentPanel.js (deleted)
- src/renderer/terminalTabBar.js
- src/renderer/index.js
- index.html
- src/renderer/styles/layout.css
- src/renderer/styles/components/terminal.css
