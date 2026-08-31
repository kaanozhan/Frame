# Plan — terminals-view

## Approach

The center is owned by `MultiTerminalUI` and routed by `_onStateChange` off
`manager.viewMode`. We add a new view mode `'terminals'` rendered by a new
module `terminalsView.js`, make it the default on project selection, and add
a workspace nav block under the selected project in the sidebar's Projects
tab. The lane board stays reachable via the existing Home affordance but is
no longer the landing view.

### 1. terminalsView.js (new)

Prototype's terminals screen as a renderer module:

- `render(container, { manager })` — reads `manager.getTerminalStates()`
  (already project-filtered), renders a header bar (`LAYOUT 1/2/3`, hint) and
  an N-column CSS grid of panes.
- Each pane: header (status dot from `laneStatus.deriveStatus`, name, tool
  label, actions: maximize ⤢/❐, close ×) + an xterm mount div. Terminals
  attach the same way `terminalGrid` cells do (open + fit on mount, dispose
  on teardown). Clicking a pane focuses that terminal's input.
- Ghost pane `+ new terminal` → `manager.createTerminal()` (existing cap
  feedback applies).
- Per-project view prefs `{cols, order[], maximizedId}` in localStorage key
  `frame-terminals-view` (same pattern as laneRail's `frame-lane-rail`).
- Drag reorder: HTML5 drag on pane header, drop on pane → splice order,
  re-render (prototype behavior, `dropover` highlight).
- Status dots re-derive on the existing status tick (subscribe like laneBoard
  does; no new polling).

### 2. Routing (multiTerminalUI.js, terminalManager.js)

- `viewMode: 'terminals'` added; `_onStateChange` routes it to
  `terminalsView.render` into `contentContainer`.
- `setCurrentProject` → after session restore, set viewMode to `'terminals'`
  (was `'board'`). Board remains a valid mode (Home).
- Tab bar keeps working; its "Home" goes to board as today.

### 3. Sidebar workspace nav (projectListUI.js)

- Under the *selected* project row, render a nav block: `Terminals` item with
  live count (from `manager.getTerminalsByProject(path).length`), prototype
  `.navitem` styling (inset accent bar when active).
- Click → ensure project selected + viewMode `'terminals'`.
- Count refreshes on terminal create/close (subscribe to manager state
  changes; projectListUI already re-renders on workspace changes).

### 4. Naming sweep (user-facing strings only)

- `laneBoard.js`: "No frames yet" → "No terminals yet", "Create your first
  frame" → "…terminal", "New Frame" → "New Terminal", context menu items.
- `terminalTabBar.js`: "Active Frames" → "Active Terminals"; "Mainframe"
  label → "Home". Frame tab labels → terminal names (default name generation
  "Frame N" → "Terminal N" if present).
- `laneDetailRail.js`, `agentDispatch.js`, `agentPanel.js`: work-stream
  "Frame" strings → "Terminal".
- NOT touched: product-name "Frame", "Frame project"/initialize strings,
  `isFrameProject`, DOM ids, storage keys.

### 5. CSS (terminals-view.css new, layout.css touch)

- Prototype language: pane bg `#0a0908` (matches xterm theme), 1px
  `--border-default` borders, header row with grab cursor, `.dropover`
  accent ring, layout-bar buttons like `.tb-btn`, ghost pane dashed.
- Sidebar navitem styles for the workspace nav block.

## Risks / notes

- Many xterm instances mounted at once: bounded by the 9-per-project cap and
  already exercised by grid watch-mode. Fit on resize per pane
  (ResizeObserver, as terminalGrid does).
- Session restore ordering: apply saved pane order after restore completes;
  unknown ids in saved order are dropped, new ids appended (prototype's cfg
  normalization).
- Reload/teardown: panes must dispose their xterm views on view switch to
  avoid the double-attach bug class that grid handles today.

## Footprint

- src/renderer/terminalsView.js
- src/renderer/multiTerminalUI.js
- src/renderer/terminalManager.js
- src/renderer/projectListUI.js
- src/renderer/laneBoard.js
- src/renderer/terminalTabBar.js
- src/renderer/laneDetailRail.js
- src/renderer/agentDispatch.js
- src/renderer/agentPanel.js
- src/renderer/styles/components/terminals-view.css
- src/renderer/styles/layout.css
- src/renderer/styles/main.css
- index.html
