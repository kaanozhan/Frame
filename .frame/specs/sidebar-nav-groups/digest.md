---
keywords: sidebar, workspace nav, nav groups, collapse, history panel, prompts, dead shortcuts
related: sidebar-project-section, retire-rail-and-panels, status-bar
---
The workspace nav's ten flat rows became three collapsible groups — Work
(Terminals, GitHub, Claude), Context (Specs, Tasks, Decisions, Structure,
Prompts), Frame (Activity) — with per-group state in localStorage
(`frame-nav-groups`) and the active-surface highlight moving to a group's
header while it is folded. History retired: it and Prompts both sent
`LOAD_PROMPT_HISTORY` and rendered `PROMPT_HISTORY_DATA`, so the panel,
module, markup, palette entry and duplicate command went and Prompts kept the
channels. The icon rail, Files, Changes and Settings were left alone (the
user withdrew the Project group mid-request). Verification turned up four
commands that had never worked: `registerCommands()` closed over
`multiTerminalUI`, a const inside `init()`, so the Prompts/Claude/GitHub
panel shortcuts threw ReferenceError into `runById`'s catch — now resolved
through `getMultiTerminalUI()`.

Chain: spec.md → plan.md → tasks.md → outcome.md
