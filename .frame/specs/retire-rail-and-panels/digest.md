---
keywords: instrument rail, side panels, panel host, workspace nav, theme toggle, github panel, activity panel, inline
related: terminals-view, center-specs-tasks-views, lane-orchestrator
---
The right instrument rail and slide-in panels are retired. A generic inline
panel host in multiTerminalUI (viewMode 'panel' + PANEL_REGISTRY) re-parents
GitHub/Claude/Prompts/History/Activity panel elements into the center as a
900px column, keeps each module's own show()/hide() as the contract, and
watches class mutations to route closes back to terminals view. Workspace
nav now has nine data-driven entries with surface-based highlights; theme
toggle moved to the sidebar icon rail; palette/sampleBanner openers
retargeted. Also of record: earlier hand-made specs skipped the tasks.json
mirror — backfilled; this spec did it properly at creation time.

Chain: spec.md → plan.md → tasks.md → outcome.md
