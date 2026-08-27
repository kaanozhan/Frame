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

## Second pass (added 2026-08-27 — see `spec.md` §0)

The definition changed after T01–T10 shipped. These are the tasks that carried
the change; all are complete on the branch, none are merged.

- T11 · Land on Home when a project has no running terminals — there is nothing
  to return to, so the board is the honest destination. (`4256757`) — **done**
- T12 · The status bar's other-projects slot says "in other projects", not
  "elsewhere": the word has to name where, or the count means nothing.
  (`027ed3b`) — **done**
- T13 · The collapsed sidebar rail reads as an edge, not a broken sidebar.
  (`226e3bc`) — **done**
- T14 · Home becomes a dashboard: a header (project name + branch) and two
  groups that split the window evenly. Orchestration leaves the board for the
  sidebar's Work group, its live session announced by a running badge on that
  row. Reverses §4's four-card model. (`8829c5a`) — **done**
- T15 · Retire the Terminals section's tab strip; every live terminal becomes a
  breadcrumb chip in the top bar beside Terminals itself. Prefs move from
  `openTabs`/`activeTab` to `shownTerminal` + `hiddenFromBar`; the magnifier
  returns to `⤢` meaning "enlarge"; `terminalChipNotice` teaches that a chip's
  `×` drops the chip, not the terminal; the enlarged header gains the spec/task
  assignment chip. Reverses §2 and T02/T03. (`f1cb8a3`) — **done**
- T16 · The top bar's Terminals wears the sidebar's own `›_` mark and the mono
  face of the chips it heads, so one destination does not look like two things.
  (`9c47044`) — **done**
- T17 · The Add Project CTA belongs to the empty sidebar only — with a project
  selected the switcher already leads to the same modal. (`ca6ffdd`) — **done**

**Remaining before this spec can close:** regenerate `outcome.md` (extend with
T11–T17 and their actual files) and `digest.md` from it, then set
`phase: done` — at branch end, with the PROJECT_NOTES write-up.
