---
keywords: settings, preferences, project settings, frame settings, privacy, telemetry, about, updates, git sharing, spec-driven, gear, sidebar header, app icon, logo, mark, branding, icns, dock icon, default project
related: terminals-home-agents, project-settings, non-invasive-overlay, sidebar-nav-groups
---
Split one Settings modal into two surfaces along scope. **Project Settings**
(Workflow: Spec-Driven, Git sharing, Remove Frame) opens from the sliders button
at the sidebar rail's foot; **Frame Settings** (Privacy & Analytics, About) opens
from the gear at the right end of the sidebar header. The gear moved *up* because
it means application preferences everywhere else; one mark for two scopes was the
confusion this ended.

`settingsModal.js` became `projectSettingsModal.js` + `frameSettingsModal.js` +
`settingsOverlay.js` (the shared box: backdrop, ×, Escape, re-read on open, and
the registry that stops the two stacking — `Cmd+,` reaches past a backdrop).
Close buttons are scoped **within** each overlay, never document-wide. Every
entry point re-pointed by scope: `Cmd+,`, the app menu, the telemetry notice, the
update dot and banner → Frame Settings. `specDrivenHint`'s `ANCHOR_ID` follows
the button whose modal holds the switch it describes.

Added here: **the launch project.** `projects[0]` is selected when nothing is
active and nothing restores a previous session, so the front of the list *is* the
default. A row moves this project there — hidden below two projects, a `✓ Default`
chip once it is first. `REORDER_WORKSPACE_PROJECTS` sends no `WORKSPACE_UPDATED`
echo, so the renderer's own order must be updated in the same call.

And **Frame's icon.** The four corner brackets `assets/logo.png` always framed
become `assets/frame-mark.svg` — the app icon (parchment on warm charcoal, macOS
rounded-rect body) and the sidebar header glyph, replacing an anonymous green
square. Icons live in `assets/`, never `build/`: **`build/` is gitignored**, so an
icon path under it is missing on a fresh clone. `package.json` had no `icon` key
at all, which is why Electron's default showed.

Chain: spec.md → plan.md → tasks.md → outcome.md
