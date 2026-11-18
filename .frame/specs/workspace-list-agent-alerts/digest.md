---
keywords: workspace switcher, workspace list, sidebar, agent waiting, status bar agents, other projects, archived workspaces, command palette
related: workspaces, terminals-home-agents, status-bar, multi-server-connections, sidebar-nav-groups, workspace-hardening
---
The workspace switcher is an open list in the sidebar again (reverses the dropdown of `e13dc55`): a "Workspaces" header with `+`, then main, local rows and one block per server. The header folds the list per sidebar view (open in Projects, folded in Files / Changes / GitHub, remembered in localStorage `frame-ws-list-open`); folded it shows the selected workspace and "N waiting". Past eight rows the list scrolls inside itself.
Waiting agents are visible: `workspaces/attention.js` builds one queue (approval before input, then longest wait, `since` = laneStatus `lastActivityAt`) that feeds the row's trailing label (`approval · 2m`), the folded header's count, and the palette's "Go to Next Waiting Agent" and "Switch Workspace…" (`commandPalette.pick`, caller-ordered). No keyboard shortcuts were added (user decision).
The status bar slot keeps its scope (other projects) but reads "Other projects · N agents · M waiting", fills with `--error` / `--warning-ink` while an agent waits, and its popover groups project → workspace → agents (`workspaces/otherProjects.js`). Clicking an agent remembers its workspace, switches project, awaits `workspaceSection.whenLoaded`, selects the workspace, then `enterLane` — `enterLane` alone never changes workspace scope.
The archive is one "Archived N" row opening a dialog (filter, Restore). "Add server…" left the list; with no server saved there is one "Connect a server…" row.
Rejected: a second line for the wait (rows would jump), one palette command per workspace (registry orders by recency, not urgency), a list across all projects, git / PR badges on rows.
Deviations from the plan: the selected row is filled instead of check-marked; the "Local" / "Remote" labels are gone; the header keeps class `ws-switch` because `tour/tourSteps.js` targets it; the archive dialog is built in JS, not `index.html`; `listPrefs.parse`, `workspaceSection.switchItems` and a local subsequence match in `commandPalette.js` are additions.
Rules for future work: status buckets come only from `rollup.bucketOf`; counts only from `projectStatusBadges.computeCounts`; anything that enters a terminal of another workspace must select that workspace first.
Not verified in a running app: implemented on a headless server host; only the pure modules have tests (`workspaceAttention`, `workspaceListPrefs`, `otherProjectsAgents`).
Open followups: the tour's Workspaces step text; flaky `test/structureRead.test.js:107`.

Chain: spec.md → plan.md → tasks.md → outcome.md
