---
keywords: tasks board, task dashboard, detail aside, right panel, new task form, kanban width
related: center-specs-tasks-views, terminals-view
---
The Tasks board's right aside stopped being permanent furniture: it is out
of layout (`display:none`, `.open` restores flex) unless a task is selected
or the New Task form is open, so the three Kanban columns get the full
center width by default (646px → 1094px measured). One `syncAside()` owns
form/detail/collapsed and every selection or form path routes through it;
`resetAside()` clears both when the board is left. The empty-state "Add a
new task" card was deleted — it duplicated the header's New Task button and
only existed to fill the panel. Presentation only; no IPC/main changes. The
Specs dashboard keeps its always-on aside (out of scope).

Chain: spec.md → plan.md → tasks.md → outcome.md
