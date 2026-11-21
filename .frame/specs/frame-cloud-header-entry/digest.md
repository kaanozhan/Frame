---
keywords: frame cloud, app header, header entry, waitlist, early access, cloud window, pitch, tour
related: frame-cloud-projects, frame-cloud-early-access, frame-cloud-no-workspace, frame-cloud-roles, frame-cloud-teammate-connection, shell-chrome-app-header-collapsible-panels
---
Frame Cloud's entry moved from the sidebar rail's foot to the app header (`#cloud-entry`, right of the Frame mark), and the signed-out window's left side became a five-step tour. This reverses frame-cloud-projects' placement; its "never a badge or dot" and "never opens by itself" rules stay.
- The entry rule is pure: `cloudEntry.entryFor(session)` → null without a server address, else `{ kind, label, tag, initial, tooltip, call }`. `appHeader.bindCloudEntry(cloudHub)` paints it; a changed tooltip clones the button (tooltip.js fixes its text), and the clone keeps focus.
- Words stay with their owners: `cloudEarlyAccess.COPY.entryCall/entryEarly/entryJoined`, `cloudNoWorkspace.workspaceRow`, `cloudRoles.workspaceLine`. The workspace name comes from `workspaceRow(workspace).value` because `cloudRoles.workspaceName` is not exported. The role is in the tooltip only.
- Rejected: always "Frame Cloud" when signed in; "Sign in to Frame Cloud" when signed out; a tour link in the signed-in window; `ResizeObserver` for the narrow header (one `max-width: 760px` rule instead); reusing the Briefs panel's classes for the tour's examples.
- The tour's copy, fixed sample data and stepping live in the pure `cloudTour.js`; `cloudWelcome.js` is only the DOM host (`render`, `show`, `reset`). `cloudHub.onOpen` resets to step one; the step is never stored. The tour's pricing guard allows "plan" (its subject) and forbids trial, Pro, price, pricing, paid, upgrade, free.
- Found in the walk, not in the plan: "Use another address" is a flag inside the window, not session state, so `cloudHub` now gives listeners a presented session without `waitlistEmail` while the form is back. Anything that reads `cloudHub.session()` gets that presented session.
- Rules for later work: the entry and tour use `--text-secondary` for quiet text (`--text-tertiary` is 3.2:1 in light-plus); the stylesheets have no global `[hidden]` rule, so a flex element that hides needs its own.
- Open: signed-in states and the narrow header were simulated, and no one has looked at it on screen; `npm test` hangs on `serverConnection` and `specManagerServer` (leaked fake-ssh children, open file watchers), unrelated to this spec.

Chain: spec.md → plan.md → tasks.md → outcome.md
