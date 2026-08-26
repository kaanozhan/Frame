---
keywords: status bar, bottom bar, session usage, claude usage, theme toggle, top bar
related: retire-rail-and-panels, topbar-presence, sidebar-project-section
---
A 26px status bar was added at the foot of the window for ambient state, on
the principle that the top bar holds controls you click and the status bar
holds readouts you glance at. The Claude usage meters moved there from the
top bar, along with their logic: a new `statusBar.js` owns the widget the
tab bar had been rendering and updating (−111 lines there), behaviour moved
verbatim. The theme toggle moved from the sidebar rail's foot to the top
bar's right end, wired inside `terminalTabBar` — which renders it and
already owned boot-time theme restore — instead of from index.js, where the
listener would bind before the element exists. Shell impact is one fixed
element plus `body { padding-bottom }`, both reading `--status-bar-height`;
overlays stay body children. The bar's left half is an empty declared slot.

Chain: spec.md → plan.md → tasks.md → outcome.md
