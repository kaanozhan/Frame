---
keywords: decisions, project notes, decision log, overview removed, structure map, center view
related: center-specs-tasks-views, tasks-detail-on-demand, palette-jump
---
The Overview dashboard was retired and its only irreplaceable card became a
center view: `decisionsView.js` lists every `### [YYYY-MM-DD]` entry in
PROJECT_NOTES.md (not the old top-10 slice), collapsed to date + title, each
expanding in place to its markdown body, with a search box over date/title/
body. The structure map, previously reachable only through Overview's
Structure card, became its own sidebar item and its init moved to
multiTerminalUI. Main: `overviewManager.js` → `projectInsights.js` keeping
decisions + per-file git history, overview loaders deleted; channels
`LOAD_DECISIONS` added, `LOAD_OVERVIEW` + the already-dead `OVERVIEW_DATA`
removed (139 channels before and after). Note: update-structure.js never
prunes channels, so STRUCTURE.json's ipcChannels needed a manual delete.

Chain: spec.md → plan.md → tasks.md → outcome.md
