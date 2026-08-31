---
keywords: project rail, sidebar, avatar, initials, flyout, expand, workspace panel, project head
related: sidebar-project-section, terminals-view, retire-rail-and-panels
---
Projects moved from the sidebar list to a far-left 56px rail of initials
avatars (accent ring = FRAME project, corner dot = agent attention) that
expands to a 240px overlay flyout on hover/keyboard focus (class-driven, no
layout shift). Sidebar's Projects tab became the workspace panel: selected
project header + the workspace nav. projectListUI logic untouched — same
DOM, new home and presentation; supersedes sidebar-project-section's
"projects as sidebar root" presentation.

Chain: spec.md → plan.md → tasks.md → outcome.md
