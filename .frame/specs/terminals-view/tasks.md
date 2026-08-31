# Tasks — terminals-view

- [x] T01 · Naming sweep: user-facing "Frame" (work-stream sense) → "Terminal"
      in laneBoard.js, terminalTabBar.js, laneDetailRail.js, agentDispatch.js,
      agentPanel.js. Product-name/init-sense strings, DOM ids and storage keys
      untouched.
- [x] T02 · terminalsView.js: N-column pane grid of all current-project
      terminals — pane header (live status dot via laneStatus, name, tool,
      close), xterm mount/dispose lifecycle, click-to-focus, "+ new terminal"
      ghost pane.
- [x] T03 · View interactions + persistence: LAYOUT bar (1/2/3 columns),
      maximize ⤢ / back-to-grid ❐, drag-header reorder with dropover
      highlight; `{cols, order, maximizedId}` per project in localStorage
      `frame-terminals-view`.
- [x] T04 · Routing: add viewMode 'terminals' (terminalManager +
      multiTerminalUI), make it the default center view on project selection;
      board stays reachable via Home.
- [x] T05 · Sidebar workspace nav: `Terminals (n)` item under the selected
      project in the Projects tab, active-state styling, live count, click →
      terminals view.
- [x] T06 · CSS: terminals-view.css in the prototype's visual language +
      sidebar navitem styles; import in main.css.
- [x] T07 · Verify: npm test green, live-run screenshots (grid, maximize,
      reorder persistence, new terminal), update STRUCTURE via
      `npm run structure:changed`, write outcome.md + digest.md.
