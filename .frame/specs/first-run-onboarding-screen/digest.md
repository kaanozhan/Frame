---
keywords: onboarding, first run, welcome, boot splash, empty state, default agent, open project, clone from github
related: how-to-use-frame-guide, sidebar-project-section, audit-q3-ux-error-feedback, audit-q3-generic-any-project
---
Replaced the every-launch welcome modal with a first-run screen that the boot splash becomes when the workspace has zero projects: the lockup holds, three ways in and the default-agent chips fade in beneath it, and Skip leaves.

- The gate is pure (`src/renderer/onboarding/onboardingGate.js`, 6 tests). `launch` shows only when the `WORKSPACE_DATA` projects array is empty, and is never dismissible; a non-array payload counts as unknown, not empty. `command` (palette "Show the Start Screen", Help › "Start with a Project", id `help.welcome` kept) always shows, with × and Escape. No new IPC.
- One surface: `#onboarding` lives inside `#app-loader`, and `appLoader.hide()` now parks the node (`display: none`) instead of removing it, so boot and palette reuse the same lockup. Rejected: crossfading to a fresh composition, a cloned second element, Escape at boot. `showFailureState()` appends its error instead of replacing innerHTML, so the failsafe retry still wins and a retry keeps the panel.
- Agent chips (`onboarding.js`): the selection moves only after `SET_AI_TOOL` resolves true, and every failed read or write goes to `notify.error`.
- Deleted `welcomeOverlay.js`, `welcome-overlay.css` and the `#welcome-overlay` markup. The `onboardingDismissed` setting is left in place, read by nothing, on purpose.
- Revised after the tasks: the How to Use Frame link was removed at the user's request (overturns plan D6), so the screen neither opens nor links the guide. The boxes no longer close the screen before their route: `state.onProjectChange` closes it, so a cancelled folder picker leaves the user on it. Clone is an inline URL row instead of the Open a Project modal; `openProjectModal.open({ clone })` and the blocking clone-failure `alert()` are gone.
- The three ways in became one block, `src/renderer/projectStart.js` + `project-start.css`, mounted by the first-run screen, Home's empty state and the Open a Project modal (240d073), so the three cannot drift. The sidebar's "Add new Project" CTA is gone: with no project the sidebar folds to its rail through `sidebarResize.hide/show({ persist: false })`.
- Fixes from the final pass: the × moved out of the transformed panel, whose transform captured its `position: fixed`; `.app-loader-complete` freezes the lockup so a summon does not replay the intro; the `.app-loader-failed` hide rule now uses two classes, since it had won only on `@import` order.
- Verified live on two isolated profiles (empty workspace ends on the screen, seeded workspace parks). The DOM is untested because no harness exists.
- Rules: a rule the app applies for the user never becomes the user's stored setting; a first-run surface stays up until a project actually opens; the ways into a project live only in `projectStart.js`.

Chain: spec.md → plan.md → tasks.md → outcome.md
