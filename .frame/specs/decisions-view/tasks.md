# Tasks — decisions-view

- [x] T01 · Main: rename overviewManager → projectInsights, drop the
      overview loaders + LOAD_OVERVIEW handler, make loadDecisions return
      every decision with its body, add the LOAD_DECISIONS channel and
      remove LOAD_OVERVIEW / OVERVIEW_DATA.
- [x] T02 · Renderer: decisionsView.js (header + count + search +
      collapsible rows with markdown bodies) and its stylesheet.
- [x] T03 · Wiring: multiTerminalUI decisions view + structure map entry,
      sidebar nav (Decisions, Structure), palette entries, tab-bar hook
      removal, overviewPanel + overview CSS deleted.
- [x] T04 · Verify live (open from nav, expand/collapse, search, empty
      project, structure map opens, palette entries), tests, STRUCTURE,
      outcome + digest.
