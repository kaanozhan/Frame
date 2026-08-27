# Plan — Settings by scope

> **Recorded after implementation.** The work landed in one commit (`320f572`).
> This plan documents the shape it took, so the archive and the file index have
> the footprint; it is not a pre-implementation planning pass.

## Architecture

`settingsModal.js` (506 lines) held two unrelated responsibilities that were
already cleanly separated inside it: project writes through
`SET_SPEC_DRIVEN` / `SET_GIT_SHARING` / `REMOVE_FRAME_FROM_PROJECT`, and
machine-wide state through `GET_USER_SETTING` / `TELEMETRY_SET_ENABLED` and the
updater. It splits into three modules along that seam.

| Module | Role |
|---|---|
| `projectSettingsModal.js` | Workflow rows; reads and writes the open project's `.frame/` |
| `frameSettingsModal.js` | Privacy & Analytics, About, the updater, the app-menu trigger |
| `settingsOverlay.js` | the box both share — backdrop, `×`, Escape, re-read on open, and the registry that keeps the two from stacking (C1) |

`settingsOverlay.create(overlayId, onOpen)` returns `{open, close, toggle,
isOpen}` and pushes itself onto a module-level list; `open()` closes every other
registered overlay first. Close buttons are queried **within** the overlay
element, never document-wide (C2).

The markup splits the same way: one `#settings-overlay` becomes
`#project-settings-overlay` and `#frame-settings-overlay`, each `.settings-modal`
so the existing CSS applies unchanged to both.

## Files

- `src/renderer/settingsModal.js` — deleted
- `src/renderer/projectSettingsModal.js` — new
- `src/renderer/frameSettingsModal.js` — new
- `src/renderer/settingsOverlay.js` — new
- `src/renderer/index.js` — both buttons, both palette commands, the update
  dot/banner and the telemetry notice re-pointed by scope
- `src/renderer/specDrivenHint.js` — `ANCHOR_ID` follows the button whose modal
  holds the switch it describes
- `index.html` — the header button, the rail's sliders icon, the two overlays
- `src/renderer/styles/layout.css` — `.sidebar-header-btn`

## Footprint

- src/renderer/settingsModal.js
- src/renderer/projectSettingsModal.js
- src/renderer/frameSettingsModal.js
- src/renderer/settingsOverlay.js
- src/renderer/index.js
- src/renderer/specDrivenHint.js
- src/renderer/projectListUI.js
- src/renderer/styles/layout.css
- src/renderer/styles/components/settings-modal.css
- src/main/index.js
- assets/frame-mark.svg
- assets/icon.png
- build/icon.icns
- build/icon.png
- package.json
- index.html

## Dependencies

None. No new packages and no new IPC channels — every channel the two surfaces
use already existed.
