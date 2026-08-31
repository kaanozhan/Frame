# Tasks — topbar-presence

- [x] T01 · presenceBar.js: chip derivation (all-projects terminals ×
      laneStatus), rAF-debounced recompute on laneStatus change +
      TERMINAL_DESTROYED, click → focus lane with project switch, overflow
      "+n" beyond 8 chips.
- [x] T02 · Top bar: presence container + relocated Default Agent launcher
      (selector + Start, IDs preserved) in .terminal-tab-actions; CSS for
      chips and the compact launcher.
- [x] T03 · Retire the Agent tab: rail button + content markup out of
      index.html, agentPanel.js deleted, index.js require/init/recompute
      special-case removed, dead agent-tab CSS stripped.
- [x] T04 · Verify: tests green, live run (chip appears when an agent runs,
      click focuses across projects, launcher works from top bar), STRUCTURE
      update, outcome.md + digest.md.
