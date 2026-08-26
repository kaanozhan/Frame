# Tasks — Home, Terminals and Agents — three surfaces folded into one model

- T01 · Move the status vocabulary into `laneStatus.js` — `statusLabel` with a
  `short` flag, `attentionMark`, `cleanCommand`, `formatRelativeTime`,
  `assignmentIcon`, `assignmentText` — and point `laneBoard` and the rail at it,
  leaving `_armQuietTimer` and the init-once guard untouched.
- T02 · Add the tab strip to `terminalsView.js`: `openTabs` and `activeTab` in
  the per-project prefs, `_buildTabStrip()`, `openTab`/`closeTab`, the
  single-terminal body, and horizontal scroll on the strip — remounting the
  terminal on every Overview↔tab switch, never skipping the mount.
- T03 · Turn the pane's maximise control into the magnifier that opens a
  terminal's own tab, and delete `maximizedId` with every branch that reads it.
- T04 · Retire the `detail` view mode: delete `terminalGrid.js` and the
  cell-assignment logic, drop `gridLayout` and the dead viewMode restore from
  `terminalManager.js`, redefine `enterLane` and `isViewingFrame`, and align
  `agentDispatch` so Start uses the focused idle terminal.
- T05 · Rebuild the top bar as `Home` plus a removable `Terminals` plus section
  chips, where × drops Terminals from the strip without touching the section;
  drop the per-terminal tabs, layout select, presence container and dead
  `enterFrames`, and delete `presenceBar.js` with the orphaned
  `.btn-lane-frames` CSS.
- T06 · Make the Overview pane header legible: status text and attention marker
  drawn from `laneStatus`, with no rail in Overview.
- T07 · `git mv laneDetailRail.js otherTerminalsRail.js` and rework it for the
  single-terminal body only — closed by default, opened by a hover control that
  remembers its state, showing only approval and input in the collapsed strip.
- T08 · Export `computeCounts()` from `projectStatusBadges.js`, give the sidebar
  `◆` chip its attention state, and fill the status bar's left slot with the
  other-projects indicator and its hover menu — opening upward after a short
  delay, forgiving on close, grouped by project, click navigating to the agent.
- T09 · Rewrite `laneBoard.js` as the four-card project board with a
  `mount()`/`update()` split, add the idempotence guard to `_renderBoardView`,
  delete `laneRail.js`, and carry the `!malformed` filter into the Specs card.
- T10 · Finish the vocabulary sweep: add `Go to Home` to the palette, rename the
  Frame and Mainframe commands to Terminal and Home, rebind the shortcuts to the
  new `enterLane`, and collapse the duplicated empty state into one definition.
