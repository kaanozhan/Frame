---
keywords: workspace switcher, workspace list, sidebar, agent waiting, status bar agents, other projects, archived workspaces, command palette
related: workspaces, terminals-home-agents, status-bar, multi-server-connections, sidebar-nav-groups, workspace-hardening
---

# Workspace list in the sidebar with agent alerts

## Problem

Workspaces exist for parallel work, but moving between them is slow and their state is hidden.

- **Switching takes two clicks.** The list sits in a dropdown under the project switcher: open it, pick a row. There is no shortcut and no palette command for switching.
- **Waiting agents are invisible.** With the dropdown closed only the selected workspace's dot shows. The Terminals count in the sidebar covers only the selected workspace, and the status bar's agent slot skips this project on purpose. An agent blocked on approval in another workspace of the same project shows nowhere.
- **A dot does not say why.** Red or amber says something waits, not which agent, on what, or for how long.
- **The status bar slot is easy to miss.** It is a glyph and a number, with a small pill when something waits.
- **The archive unfolds in place.** Opening "Archived" drops every archived workspace into the menu. It grows with use.

The Projects view of the sidebar has six nav rows and empty space below them, so the room for an open list is already there.

## Goal

The workspace list stays open in the sidebar, so a switch is one click and waiting agents are visible without opening anything. The status bar's agent slot names its scope and fills with the theme's status colour when an agent waits. The archive costs one row in the sidebar however large it gets.

Design reference (interactive, with a Today / Proposed switch): https://claude.ai/artifact/GEmHofWYbFhsrfuTQB6ZaW
The prototype's row numbers and its single-key shortcuts are not part of this spec.

**The list**

- Sits under the project switcher and above the Work group. Its header reads "Workspaces" and carries `+` (New Workspace, ⌘⇧N).
- The header folds the list. Folded, it shows the selected workspace's dot and branch, like today's trigger, plus "N waiting" when agents wait in other workspaces.
- Open by default in the Projects view. Folded by default in Files, Changes and GitHub. Each view remembers its own state.
- Rows stay one line: dot, branch, then a trailing slot. The slot shows a waiting label (`approval · 2m`, `input · 9m`) when an agent in that workspace waits, and is empty otherwise.
- Past eight rows the list scrolls inside itself, so the nav below never moves (user decision, 2026-11-18).
- Servers keep one sub-header each, with the link state and Connect / Set up while the link is down.
- The foot of the list is one "Archived N" row that opens a dialog: newest first, filterable, scrolls inside itself, Restore per row.

**Command palette** (two commands, no keyboard shortcuts)

- "Switch workspace…", ordered by urgency.
- "Go to next waiting agent": approval before input, then the longest wait. It selects the workspace and the terminal together.

**Status bar agent slot**

- Scope is unchanged: agents in the user's other projects.
- The face reads "Other projects · N agents", and "· M waiting" when any wait.
- While an agent waits the whole slot is filled: the theme's error colour for approval, its warning colour for input only. With nothing waiting it is a quiet outlined chip.
- The popover groups by project, then by workspace, then lists that workspace's agents.

## Constraints

- **Reverses the dropdown move of 2026-11-15** (`e13dc55`, workspaces). That commit put the list in a dropdown; this spec opens it again in the Projects view. The folded state keeps the dropdown's trigger face, so views that need the room lose none.
- **Rows stay one line**, as `e13dc55` set. No git or PR badges on rows; `workspacePr.rowBadgesHtml` stays unused here.
- **Removes "Add server…" from the list**, one of the entry points `c3c6f0df` added (multi-server-connections). The rail's Add Server button, ⌘⌥N and the File menu stay. Creating a remote workspace still goes through the one New Workspace dialog, where the server is chosen.
- **One status vocabulary.** Labels, order and colours come from `laneStatus` and `workspaces/rollup.js` (approval → input → working → idle). No second tally: counts come from the same pass `projectStatusBadges.computeCounts` uses (terminals-home-agents D8).
- **Selection rules are untouched** (workspaces): `projectPath` is the project identity and `state.getWorkspaceRoot()` is where checkout views point. This spec changes how a workspace is selected, not what selecting does.
- **No new keyboard shortcuts** (user decision, 2026-11-18). Workspace switching has none today and this spec adds none. Existing shortcuts are untouched.
- **Row actions survive the move:** the ⋯ and context menu, rename in place, and Restore / Remove on a missing folder.
- **Theme tokens only.** The filled slot and the labels use the theme's own error and warning tokens, so every theme colours them itself. Pulsing dots stop under `prefers-reduced-motion`.
- New commands go through `commandRegistry`, like the other workspace commands.

## Success Criteria

- When a project with workspaces is open in the Projects view, then the list is open under the project switcher and one click on a row selects that workspace.
- When the Files, Changes or GitHub view is shown for the first time, then the list is folded to one row showing the selected workspace's dot and branch.
- When the user folds or unfolds the list in a view, then that view opens the same way after a restart, and the other views are unaffected.
- When the open list holds more than eight rows, then it scrolls inside itself, the selected row is scrolled into view, and the nav below keeps its place.
- When the list is folded and agents wait in other workspaces of this project, then the header shows "N waiting" in the colour of the most urgent one.
- When an agent in a workspace waits on approval or input, then its row ends with the status and how long it has waited; otherwise the row ends with nothing.
- When the user runs "Go to next waiting agent" from the palette, then the most urgent waiting terminal that is not on screen is shown, in its workspace; when none waits, a notice says so and nothing changes.
- When the user opens "Switch workspace…" in the palette, then workspaces are listed most urgent first and Enter selects the highlighted one.
- When agents run in other projects, then the status bar slot reads "Other projects · N agents", with "· M waiting" when any wait.
- When any agent in another project waits on approval, then the slot is filled with the theme's error colour; when agents wait only on input, with its warning colour; when none wait, it is an outlined chip.
- When the slot's popover is open, then agents are grouped by project and, inside each project, by workspace.
- When the user clicks an agent in the popover, then Frame switches to that project, selects that agent's workspace and shows its terminal.
- When the project has archived workspaces, then the list ends with one "Archived N" row, whatever N is; when it has none, the row is absent.
- When the user opens "Archived N", then a dialog lists them newest first, a filter narrows the list, and Restore puts a workspace back in the list.
- When a saved server's link is down, then its sub-header shows the state and a Connect or Set up action.
- When no server is saved, then the list shows one "Connect a server…" row; after the first server is saved the row is gone and no "Add server…" row replaces it.
- When the user opens a row's ⋯ or context menu, renames a row, or meets a missing folder, then each behaves as it does in today's dropdown.

## Out of Scope

- System notifications while Frame is in the background
- Peeking at another workspace's terminal without switching
- Git and PR badges on workspace rows
- An Archive suggestion on a row whose PR was merged elsewhere
- A workspace list across all projects
- Keyboard shortcuts for switching workspaces
- An alert for this project's other workspaces while the sidebar is hidden (⌘B)
