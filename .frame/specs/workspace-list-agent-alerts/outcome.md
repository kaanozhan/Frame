## T01 — Attention logic: the waiting queue of a project's agents

Added `src/renderer/workspaces/attention.js` (pure) with `waitingQueue`, `workspaceWait`, `othersWaiting`, `nextWaiting` and `waitLabel`, exported `bucketOf` from `workspaces/rollup.js` for it, and covered all five in `test/workspaceAttention.test.js`. Not in the plan's wording: a wait with no known start sorts last of its kind and labels as the kind alone, under a minute reads `<1m`, an hour or more reads in hours, and the agent name falls back to the terminal's name.
Followup: `test/structureRead.test.js:107` is flaky on the server host (same-tick rewrite), unrelated to this spec.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T02 — The open list: a Workspaces header and inline rows replace the trigger and dropdown

Replaced the trigger and floating menu in `workspaceSection.js` with a "Workspaces" header carrying `+` and an inline `.ws-list`; removed `triggerHtml`, `openDropdown`, `closeDropdown`, the outside-click and Escape handlers and `menuOpen`, and updated `workspaces.css` and the comment in `index.html`. Deviations: the selected row is filled with an accent label instead of a check mark (the trailing slot is T03's), the "Local" / "Remote" labels are gone as in the plan's Shape, the header keeps the `ws-switch` class because `tour/tourSteps.js` targets it, and a focused row keeps focus across redraws. Not seen running: no DOM harness, no display on this host.
Followup: the tour's Workspaces step still says "New workspace at the top of this list" (`src/renderer/tour/tourSteps.js`, outside this spec's footprint).

_Captured: 2026-11-18 · 3 file change(s)_

---
## T03 — Wait label on rows: which agent waits, on what, for how long

Added the trailing wait label (`approval · 2m`, agent name in the tooltip, before ⋯) to workspace rows and the main row in `workspaceSection.js` from `attention.workspaceWait` and `waitLabel`, and a 30-second redraw that runs only while a label is on screen. Styled it in `workspaces.css` with `--error` and, for input, `--warning-ink` instead of plain `--warning`, because that is the theme's text-safe warning colour. Not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T04 — Fold per view: open in Projects, folded elsewhere, each view remembers

Added `workspaces/listPrefs.js` with `test/workspaceListPrefs.test.js`, `workspaceSection.setView(view)` called from `revealSidebarTab` in `index.js`, and a fold button in the header that saves each view's state to localStorage `frame-ws-list-open`; folded, the header shows the selected workspace's dot and branch and "N waiting" in the most urgent colour. Beyond the task text: `listPrefs.parse` does the tolerant read, and the list is shown while an inline rename is open even in a folded view. Not seen running.

_Captured: 2026-11-18 · 5 file change(s)_

---
## T05 — Eight-row cap: the list scrolls inside itself

Capped `.ws-list` at eight rows with its own scroll in `workspaces.css` (one `--ws-row-height` variable drives the cap and the rows' height) and, in `workspaceSection.js`, kept the scroll position across redraws and added `revealRow`, which brings the selected row into view when the selection changes or the list unfolds. `revealRow` sets the list's own `scrollTop` rather than calling `scrollIntoView`, so the sidebar around it never moves. Rows with a second line are taller, so such a list scrolls a little before eight; not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T06 — Server foot rows: no Add server row, one Connect row while no server is saved

Removed the "Add server…" row from the list in `workspaceSection.js` and replaced the three-line no-server offer with one "Connect a server…" row that opens the Servers dialog on its add field; the explanation line became that row's tooltip. Server sub-headers, their Connect / Set up action and their empty states are untouched. Dropped `.ws-add-server` and its last companion `.ws-new-key` from `workspaces.css`; not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T07 — Archive dialog: one Archived N row instead of an archive that unfolds in place

Replaced the unfolding Archived section in `workspaceSection.js` with one "Archived N" row that opens a dialog (records in the order main returns them, a filter over branch, name and host, a self-scrolling list, Restore per row via `restoreWorkspace`), and styled both in `workspaces.css`. Deviations: the dialog's markup is built in JS on first use because the plan limits `index.html` to its comment, a successful restore closes the dialog, and `restoreWorkspace` now returns whether it succeeded. Not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T08 — Palette picker and the two workspace commands

Added `pick({ placeholder, items })` to `commandPalette.js`, `selectById`, `goToNextWaiting` and `switchItems` to `workspaceSection.js`, and registered `workspace.switch` and `workspace.nextWaiting` in `index.js` without shortcuts. Deviations: the picker reimplements the registry's subsequence match locally (it is not exported and `commandRegistry.js` is outside the plan), and `switchItems()` is a fifth entry point that keeps the urgency ordering beside the attention queue. Not seen running.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T09 — Status bar slot face: named scope, filled while an agent waits

Added `workspaces/otherProjects.js` (`group`, `slotFace`) with `test/otherProjectsAgents.test.js`, made `statusBar.updateAgents` use it, and rendered the slot as "Other projects · N agents[ · M waiting]": an outlined chip that fills with `--error` for approval or `--warning-ink` for input in `status-bar.css`. `group` already accepts a names map for T10 and gives each project an `agentCount`; the old count and pill rules were removed. Not seen running, so the chip's look per theme is unchecked.

_Captured: 2026-11-18 · 4 file change(s)_

---
## T10 — Popover by workspace, and landing on the agent's workspace

Grouped the status bar popover in `statusBar.js` by project, workspace, then agents (ids at once, names from `WORKSPACES_LIST` on open, cached while open), exported `rememberWorkspace` from `state.js`, added `workspaceSection.whenLoaded(projectPath)` (resolves on load, or after 2 seconds), and made `_focus` remember the agent's workspace, switch project, await the load, select the workspace and then `enterLane`. `_focus` also gives up when the user changes project while it waits, and a project that starts running agents while the popover is open shows ids until it is reopened. Not seen running: the cross-project landing is the least exercised path of this spec.

_Captured: 2026-11-18 · 4 file change(s)_

---
## T11 — Guide: the workspace list instead of the dropdown

Rewrote the three sentences in `guide/guideContent.js` for the open list (the `+` beside Workspaces, the "Connect a server…" row) and redrew the workspaces sketch in `guide/guideSketches.js` as the open list with a wait label and an "Archived 3" row. Beyond the three sentences: the Add a server page focuses the `servers` region only (the sketch lost `add-server`), and "Under Remote, every server…" became "In the workspace list, …" because T02 dropped the Local / Remote labels. The sketch reuses existing guide classes (`guide.css` is outside the plan); its layout was not seen running.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T12 — Follow-up: the wait label names the wait, not how long it has lasted

At the user's request the row label no longer shows time: `waitLabel` in `workspaces/attention.js` now takes only the kind and returns `waiting` for an input wait and `approval` for an approval wait (`input · 9m` and `approval · 2m` are gone). With no minutes on screen, the 30-second redraw in `workspaceSection.js` (`WAIT_TICK_MS`, `waitTimer`, `syncWaitTimer`) had nothing to refresh and was removed. The guide sketch shows `approval`, and `test/workspaceAttention.test.js` asserts the new labels. The internal kind stays `input` (and the `.ws-wait.input` class with it); `since` stays in the queue because it still orders waits. This overturns the time part of T01/T03 and spec.md's `approval · 2m` / `input · 9m` wording; those texts are left as the record. The user only named "input": approval keeping its own word is an assumption. Not seen running; `test/workspaceAttention.test.js` passes, and the full `npm test` was not finished (`specManagerServer.test.js` and `serverConnection.test.js` hung on this host, unrelated to this change; the user said to set tests aside).

_Captured: 2026-11-18 · 4 file change(s)_

---
## T13 — Follow-up: outside Projects the workspace header is a dropdown with only the selected workspace

At the user's request, in Files, Changes and GitHub the header no longer folds and unfolds the list in place: `workspaceSection.js` draws a trigger with the selected workspace's branch, its remote / offline tag and a chevron (`triggerHtml`, sharing `selectedFace` with the folded header), and opens the same rows as a dropdown under it (`.ws-list.ws-dropdown` in `workspaces.css`, the project switcher's menu surface). A pick closes it and the trigger shows the new workspace; a click outside (the row menu counts as inside) or Escape closes it too, and anything that opens a dialog closes it first. There the rows carry no status dot and no wait label (`plain`), and the header has no "N waiting". Projects is unchanged: the open list with its fold, dots, wait labels and "N waiting". This overturns plan B11 and T7 for those three views (the folded header is a menu trigger again there, though the rows come from the one render path, not a second copy); `listPrefs` still stores per-view state, but only Projects reads it now. Server sub-headers keep their link-state styling. Not seen running; tests not run (the user set them aside after the full suite hung).

_Captured: 2026-11-18 · 2 file change(s)_

---
## T14 — Follow-up: "+ Add New" in Projects, no new-workspace button elsewhere

At the user's request the header's "+" in Projects now reads "+ Add New". "If the space is not too small" became a container query: `.ws-head` is an inline-size container and below 190px the label drops and the bare "+" remains (the sidebar runs 231–500px; at the default 300px the header is about 214px wide, so the label shows, and it drops once the sidebar is narrower than about 276px). In Files, Changes and GitHub the header draws no new-workspace button at all, so the dropdown trigger takes the whole row; ⌘⇧N, the File menu's "New Workspace…" and the palette still create one there. Not done: the guide's switcher sketch still draws a bare "+". Not seen running; tests not run.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T15 — Follow-up: upstream's nav-group look on this branch's list

While syncing with upstream/main the user chose to take #196's look (the workspace section drawn as one more nav group, like Work and Context) over this branch's own, keeping this branch's behaviour. `index.html` gives `#workspace-section` the `project-nav-group` class and `render()` toggles `collapsed` while the rows are hidden, so the nav's chevron points right when folded or when the dropdown is closed. The header is a `<button class="ws-fold project-nav-group-header">` with the chevron and a semibold "Workspaces"; folded (Projects) or as the dropdown trigger (Files, Changes, GitHub) it names the selected workspace on its right in `.ws-head-current`, with the dot and "N waiting" only in Projects. The Projects list carries `project-nav-group-rows`, so it hangs off the guide line, still capped at eight rows; the dropdown keeps its elevated surface. Rows take #196's selection: the active background, an inset accent edge and a primary-coloured label (with a combined rule so a focused selected row keeps its focus ring). Removed: the small-caps title, the elbow and the module's own chevron. Deviations from #196: the title reads "Workspaces" (this branch's word, which the guide and tour use) rather than "Workspace", "+ Add New" sits at the header's right, and the rows are drawn only while open, so the fold snaps instead of sliding. Not seen running; tests not run.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T16 — Follow-up: outside Projects the header is the selected workspace, in the project switcher's box

The user found the "Workspaces" group title out of place in Files, Changes and GitHub: there the header should be the selected workspace, changeable from a dropdown, with a hint that it is a workspace. `triggerHtml` now draws the project switcher's own box (`.sidebar-current-project`): a small-caps "Workspace" label — the hint, and the pair of "Project" right above — then the branch, the remote / offline tag and the caret, which turns while the dropdown is open. The dropdown sits under the box at full width (`left: 0`, 4px below, as the project menu does). The trigger is found by `.ws-trigger` now that it no longer carries `.ws-fold`, whose button reset would have stripped the box. Projects is unchanged (T15's group header). Not seen running; tests not run.

_Captured: 2026-11-18 · 2 file change(s)_

---
## T17 — Follow-up: back to this branch's own look

Having seen #196's nav-group look (T15) the user preferred the branch's own, so T15 is reversed: `index.html`, `workspaceSection.js` and `workspaces.css` are back to the merge commit's look — the small-caps "Workspaces" fold header with its own chevron, the elbow and the section's inset, the selected row's accent label, the list without the guide line. The decision for the PR: this branch's look replaces #196's. T16 stays: in Files, Changes and GitHub the selected workspace sits in the project switcher's box, and in this look the elbow ties it to the project box above, as the switcher was first drawn; the header row drops its inset there (`.ws-head.dropdown { padding: 0 }`) and the dropdown opens under the box (`left: 14px`, 4px below). #205's `headBranch` label, carried over in the merge, is unaffected. Not seen running.

_Captured: 2026-11-18 · 3 file change(s)_

---
## T18 — Follow-up: server blocks list only servers in use, and do not fold

The user found folding server sections and a server's "No workspaces yet" line pointless. Of the two proposals (A: fixed sub-headers, only servers that hold this project's workspaces; B: no sub-headers, host on each row's second line) they chose A. `serverHeadHtml` is a label now — icon, host, hairline, and Connect / Set up while the link is down or its state ("Connecting…") muted while it comes up; the caret, the count, the locked-open rule and the per-server memory (`frame-ws-server-open`, `toggleServer`, `openServersThatGrew`) are gone. `remoteGroupHtml` skips a server without workspaces of the project, so `serverEmptyHtml` and its "No workspaces yet" / "Connecting…" / Reconnect / Finish setup lines go, and `render` drops the hairline before Remote when nothing follows it. "+ Add New" still creates on any server (the dialog picks it); the "Connect a server…" row while no server is saved stays (B7), as the user did not ask to drop it. This overturns multi-server-connections' collapsible sections (`ca742d0`) and T06's choice to keep the server empty states. A stored `frame-ws-server-open` is left in place, unread. Not seen running; tests not run.

_Captured: 2026-11-18 · 2 file change(s)_

---
