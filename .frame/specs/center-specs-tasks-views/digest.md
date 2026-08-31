---
keywords: specs dashboard, tasks dashboard, inline, center view, viewMode specs, viewMode tasks, lifecycle, section rail
related: terminals-view, deep-spec-plan, implement-modes-v2
---
Specs/Tasks dashboards stopped being full-window overlays: with an inline
host registered by multiTerminalUI they mount inside the center content area
(viewModes 'specs'/'tasks'); all legacy open paths (rails, palette, IPC
toggles) delegate to the host. Sidebar Specs is lifecycle-first — it opens
specSection on the top active spec; the section rail's ↗ switches to the
inline grid; Escape returns to terminals view. Overlay CSS kept dormant as
fallback. Sidebar nav items light up from getActiveSurface().

Chain: spec.md → plan.md → tasks.md → outcome.md
