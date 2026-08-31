# Tasks — retire-rail-and-panels

- [x] T01 · Generic panel host in multiTerminalUI: viewMode 'panel',
      PANEL_REGISTRY (github/claude/prompts/activity/history),
      showPanel()/togglePanel(), mount + module.show(), MutationObserver
      close-routing, detach/park on view switches, getActiveSurface
      'panel:<key>'.
- [x] T02 · CSS: .panel-inline overrides (full-size, no slide transform) +
      nav styling for the longer workspace nav list.
- [x] T03 · Workspace nav items: Overview, GitHub, Claude, Prompts, History,
      Activity — click wiring + active states (incl. 'overview').
- [x] T04 · Remove the instrument rail: index.html element, index.js
      init/require, delete instrumentRail.js and its CSS; move the theme
      toggle to the sidebar icon rail next to Settings.
- [x] T05 · Retarget legacy openers to the center: ⌘-palette panel entries,
      history keyboard shortcut, sampleBanner spec/tasks opens.
- [x] T06 · Verify: tests green, live run (each nav item, panel × routing,
      theme toggle), STRUCTURE update, outcome.md + digest.md.
