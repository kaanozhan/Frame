# Plan — Workspace list in the sidebar with agent alerts

## Architecture

### Resolved plan-time decisions

Business (settled with the user while the spec was written, 2026-11-17 and 2026-11-18):

- **B1 · Where the list lives** — open in the sidebar, not in a dropdown. Reverses `e13dc55`. The user's first goal is easy switching, and the Projects view has the room.
- **B2 · Default per view** — open in Projects, folded in Files, Changes and GitHub; each view remembers its own state. Those three views need the height for their own content.
- **B3 · What a waiting row says** — a trailing label on the same line (`approval · 2m`), not a second line. Rows keep one height, so the list does not jump when an agent starts waiting.
- **B4 · Status bar slot scope** — other projects only, as today. This project's workspaces are answered by the list. The slot gets a name and a filled state instead of a wider scope.
- **B5 · Popover grouping** — project, then workspace, then agents.
- **B6 · Archive** — one fixed row that opens a dialog. An archive that unfolds in place grows without limit.
- **B7 · "Add server…"** — removed from the list; a one-line "Connect a server…" shows only while no server is saved. The rail button, ⌘⌥N and the File menu remain.
- **B8 · Shortcuts** — none added. Two palette commands only.
- **B9 · Long list** — scrolls inside itself past eight rows.
- **B10 · Existing second line (silent)** — the conditional line under a branch (a custom name, `missing`, `offline`, and "project checkout" under main) stays as it is today. The spec's "rows stay one line" was written against `e13dc55`'s message; the code still draws that line when it adds something (`workspaceSection.js:242`). This spec adds no new second line and removes none: changing it was not asked for.
- **B11 · Folded header (silent)** — a click unfolds the list in place. There is no dropdown any more, so the folded header is a fold control, not a menu trigger.

Technical:

- **T1 · Tests (asked)** — pure logic and data transforms only. That is the project's convention (`test/workspaceRollup.test.js` covers `workspaces/rollup.js`); the renderer has no DOM harness.
- **T2 · "Switch workspace…" in the palette** — a picker mode in `commandPalette.js`, not one registered command per workspace. The spec orders the list by urgency, and `commandRegistry.search` orders by recency and fuzzy score.
- **T3 · How long an agent has waited** — `laneStatus.getStatus(id).lastActivityAt`. A waiting agent prints nothing, so its last activity is when the wait began. No new field in `laneStatus`.
- **T4 · Landing on another project's workspace** — `statusBar._focus` records the agent's workspace as that project's remembered one, switches project, waits for the workspace list to load and reselect, then calls `enterLane`. Today `enterLane` never changes the workspace scope (`multiTerminalUI.js:267`, `terminalManager.js:156`), so a terminal in a non-selected workspace is not shown.
- **T5 · Workspace names for other projects** — read with the existing `WORKSPACES_LIST` IPC when the popover opens, cached while it is open. A terminal state carries only `workspaceId`; an id with no record falls back to the id itself.
- **T6 · Fold state storage** — `localStorage` key `frame-ws-list-open` = `{ [view]: boolean }`, the same pattern as `frame-nav-groups`.
- **T7 · Dropdown code** — removed, not kept behind the folded state. Two ways to show the same rows would drift.

### Shape

One component, two states. `workspaceSection.js` keeps owning `#workspace-section` and now renders a header plus an inline list instead of a trigger plus a floating menu.

```
#workspace-section
  .ws-head            fold button (chevron · "Workspaces" | dot + branch + "N waiting") · "+"
  .ws-list            only while open; max-height = 8 rows, overflow-y: auto
    .ws-row main
    .ws-row …         local workspaces
    .ws-server …      one per saved server (head + rows | empty state), unchanged
    .ws-cta           "Connect a server…" — only when no server is saved
    .ws-archived-row  "Archived N" → archive dialog
```

Pure modules hold the logic, so it can be tested:

- `workspaces/attention.js` — one pass over terminal states gives the waiting queue for a project: `[{ terminalId, workspaceId, kind: 'approval'|'input', agentName, since }]`, approval first, then oldest `since`. From it: `workspaceWait(queue, workspaceId)` (the row's label source), `othersWaiting(queue, selectedId)` (`{ count, kind }` for the folded header), `nextWaiting(queue, onScreenTerminalId)`, and `waitLabel(kind, since, now)` → `approval · 2m`. Status buckets come from `rollup.js`, which stays the one place that maps `laneStatus` values.
- `workspaces/listPrefs.js` — `defaultOpen(view)` (`projects` → true, others false), `isOpen(prefs, view)`, `withOpen(prefs, view, open)`.
- `workspaces/otherProjects.js` — the grouping `statusBar.updateAgents` does today, moved out and extended one level: `[{ path, name, approval, input, workspaces: [{ id, label, agents: [...] }] }]`, plus `slotFace(total, waiting)` → `Other projects · 3 agents · 1 waiting`. Counts still come from the `projectStatusBadges.computeCounts` map that is passed in.

`workspaceSection.js` gains four small entry points the rest of the app calls: `setView(view)`, `selectById(id)`, `goToNextWaiting()`, `whenLoaded(projectPath)`.

Wait labels show minutes, so `workspaceSection` re-renders on a 30-second timer only while at least one label is on screen.

The filled slot is CSS on classes `statusBar.js` already sets (`agent-approval`, `agent-input`) plus one new class for the named face; colours are `--error` and `--warning-ink` with `--bg-primary` text, so each theme supplies its own.

## Files

- `src/renderer/workspaces/attention.js` — **New**. Waiting queue, row label, folded-header count, next waiting agent.
- `src/renderer/workspaces/rollup.js` — **Modified**. Exports `bucketOf`, so `attention.js` maps statuses the same way.
- `src/renderer/workspaces/listPrefs.js` — **New**. Open/folded state per sidebar view.
- `src/renderer/workspaces/otherProjects.js` — **New**. Other projects' agents grouped by project and workspace; the slot's face text.
- `test/workspaceAttention.test.js` — **New**. Queue order, row label, others' count, next waiting, label text.
- `test/workspaceListPrefs.test.js` — **New**. Defaults per view, remembered state, bad stored values.
- `test/otherProjectsAgents.test.js` — **New**. Grouping, this project excluded, unnamed workspace fallback, face text.
- `src/renderer/workspaceSection.js` — **Modified**. Header and inline list replace the trigger and dropdown; trailing wait label; fold per view; archive dialog; server foot rows; `setView`, `selectById`, `goToNextWaiting`, `whenLoaded`.
- `src/renderer/styles/components/workspaces.css` — **Modified**. Header, list, eight-row cap, trailing label, selected row, archive row and dialog; dropdown-only rules removed.
- `src/renderer/commandPalette.js` — **Modified**. `pick({ placeholder, items })`: a picker mode over caller-supplied items, with the same filter, arrows and Enter.
- `src/renderer/index.js` — **Modified**. `revealSidebarTab` tells `workspaceSection` the view; registers `workspace.switch` and `workspace.nextWaiting`, both without a shortcut.
- `src/renderer/statusBar.js` — **Modified**. Named face and filled state; popover grouped by workspace; `_focus` lands on the agent's workspace.
- `src/renderer/styles/components/status-bar.css` — **Modified**. Named chip, filled approval and input states, workspace sub-header in the popover.
- `src/renderer/state.js` — **Modified**. Exports the existing `rememberWorkspace(projectPath, id)`.
- `src/renderer/guide/guideContent.js` — **Modified**. Three sentences that describe the switcher as a dropdown and name "Add server… at the bottom of the workspace switcher".
- `src/renderer/guide/guideSketches.js` — **Modified**. The sketch of the open workspace switcher.
- `index.html` — **Modified**. The comment above `#workspace-section` (it describes a dropdown).

## Footprint

- src/renderer/workspaces/attention.js
- src/renderer/workspaces/rollup.js
- src/renderer/workspaces/listPrefs.js
- src/renderer/workspaces/otherProjects.js
- test/workspaceAttention.test.js
- test/workspaceListPrefs.test.js
- test/otherProjectsAgents.test.js
- src/renderer/workspaceSection.js
- src/renderer/styles/components/workspaces.css
- src/renderer/commandPalette.js
- src/renderer/index.js
- src/renderer/statusBar.js
- src/renderer/styles/components/status-bar.css
- src/renderer/state.js
- src/renderer/guide/guideContent.js
- src/renderer/guide/guideSketches.js
- index.html

## Dependencies

None

## Sequencing

1. **Attention logic.** Add `workspaces/attention.js` with `waitingQueue`, `workspaceWait`, `othersWaiting`, `nextWaiting` and `waitLabel`; export `bucketOf` from `rollup.js` and use it for status buckets. Write `test/workspaceAttention.test.js` with it.
2. **The open list.** In `workspaceSection.js`, render the "Workspaces" header with `+` and the inline list (main, local rows, server blocks) in place of the trigger and the floating menu; remove `openDropdown`, `closeDropdown`, the outside-click and Escape handlers and `triggerHtml`. Keep `rowHtml`'s labels, the ⋯ and context menu, inline rename and the missing-folder actions. Mark the selected row. Update `workspaces.css` and the comment in `index.html`.
3. **Wait label on rows.** Add the trailing label from `attention.workspaceWait` and `waitLabel` to `rowHtml` and the main row; start the 30-second re-render only while a label is shown.
4. **Fold per view.** Add `workspaces/listPrefs.js` and `test/workspaceListPrefs.test.js`. Add `workspaceSection.setView(view)`, called from `revealSidebarTab` in `index.js`. The header folds and unfolds the list for the current view and saves to `frame-ws-list-open`. Folded, it shows the selected workspace's dot and branch and, from `attention.othersWaiting`, "N waiting".
5. **Eight-row cap.** Give `.ws-list` a max height of eight rows with its own scroll, keep the scroll position across renders, and scroll the selected row into view on selection.
6. **Server foot rows.** Remove the "Add server…" row from the list. With no saved server, replace the three-line offer with one "Connect a server…" row that opens the Servers dialog on its add field. Server sub-headers, their Connect / Set up action and their empty states stay as they are.
7. **Archive dialog.** Replace the unfolding "Archived" section with one "Archived N" row (absent when N is 0) that opens a dialog: the records in the order `workspaceRegistry` already returns (newest first), a filter field, a scrolling list, Restore per row through the existing `restoreWorkspace`.
8. **Palette picker and the two commands.** Add `pick()` to `commandPalette.js`. Add `workspaceSection.selectById` and `goToNextWaiting` (select the workspace, then `enterLane`; `notify.info` when nothing waits). Register `workspace.switch` ("Switch Workspace…", items ordered by `attention`) and `workspace.nextWaiting` ("Go to Next Waiting Agent") in `index.js`, both without `shortcut`.
9. **Status bar slot face.** Add `workspaces/otherProjects.js` and `test/otherProjectsAgents.test.js`; make `statusBar.updateAgents` use it. Render the face as "Other projects · N agents[ · M waiting]"; add the outlined and filled styles to `status-bar.css`. The empty state is unchanged.
10. **Popover by workspace, and landing there.** Group the popover project → workspace → agents, reading names with `WORKSPACES_LIST` when it opens. Export `rememberWorkspace` from `state.js`, add `workspaceSection.whenLoaded`, and make `_focus` remember the agent's workspace, switch project, wait for the load, then `enterLane`.
11. **Guide.** Update the three sentences in `guideContent.js` and the switcher sketch in `guideSketches.js` to the open list.
