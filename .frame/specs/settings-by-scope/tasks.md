# Tasks — Settings by scope

Implemented as a single commit (`320f572`); listed here as the steps it took.

- T01 · Split `#settings-overlay` into `#project-settings-overlay` (Workflow)
  and `#frame-settings-overlay` (Privacy & Analytics, About). — **done**
- T02 · Add the gear to the sidebar header beside the update dot; swap the
  rail's foot button to `SlidersHorizontal` and retitle it Project Settings. — **done**
- T03 · Extract `settingsOverlay.js` — backdrop, per-overlay `×`, Escape,
  re-read on open, and the registry that stops the two stacking (C1, C2, C3). — **done**
- T04 · Split `settingsModal.js` into `projectSettingsModal.js` and
  `frameSettingsModal.js`; delete the original. — **done**
- T05 · Re-point every entry point by scope: both buttons, `Cmd+,`, the app
  menu trigger, the telemetry notice, the update dot and banner, and the two
  palette commands. — **done**
- T06 · Move `specDrivenHint`'s `ANCHOR_ID` to `project-settings-btn` — the
  popover must point at the button whose modal holds the switch it describes. — **done**
- T07 · Style `.sidebar-header-btn`. — **done**

- T08 · Add the launch-project row to Project Settings: "Make Default" moves
  this project to the front of the workspace list, which is the whole of what
  default means — `renderProjects` selects `projects[0]` and nothing restores a
  previous session's project. Hidden below two projects; once it *is* first the
  button is replaced by a `✓ Default` chip and the copy switches to state it,
  because nothing else in Frame tells you which project launch will pick. — **done**

- T09 · Give Frame its own icon. The mark — four corner brackets, the same one
  `assets/logo.png` has always framed — becomes `assets/frame-mark.svg`, an app
  icon (`build/icon.icns` + `assets/icon.png`, parchment on warm charcoal in the
  macOS rounded-rect body), and the sidebar header's glyph, replacing the
  anonymous green square. electron-builder gains `mac`/`win`/`linux` icon paths;
  `app.dock.setIcon` covers running unpackaged, where the bundle's icns does not
  apply yet. — **done**

**Remaining before this spec can close:** write `outcome.md` and `digest.md`,
then set `phase: done` — at branch end, when the work merges.
