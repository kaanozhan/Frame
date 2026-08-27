---
keywords: settings, preferences, project settings, frame settings, privacy, telemetry, about, updates, git sharing, spec-driven, gear, sidebar header, app icon, logo, mark, branding, icns, dock icon, default project
related: terminals-home-agents, project-settings, non-invasive-overlay, sidebar-nav-groups
---

# Settings by scope — the project's, and Frame's own

> **What we're building:** one Settings modal held two unrelated kinds of
> setting. It splits into two surfaces along the only line that matters —
> what belongs to the open project, and what belongs to Frame on this machine.

> **Recorded after implementation.** This landed directly (the spec offer was
> declined for it) on the `feat/terminals-home-agents` branch, commit
> `320f572`. The record is written from the decision as it was actually made,
> so `plan.md` carries the footprint but no pre-implementation planning pass.

## Problem

The gear at the foot of the sidebar rail opened a single modal with three
sections: **Workflow** (Spec-Driven Development, Git sharing, Remove Frame from
this project), **Privacy & Analytics** (telemetry, crash dumps) and **About**
(version, updater, logs).

The first is project-scoped — every row writes into the open project's
`.frame/` and none of it outlives that project. The other two are machine-wide
and are the same whichever project is open. Holding them in one scrolling body
put **"Remove Frame from this project"** a short scroll from **"Send anonymous
usage stats"**, as though they were the same kind of choice.

Two further symptoms:

- With no project open, a third of the modal was inert rows explaining why.
- The one gear meant "settings" in general, so neither scope had a mark of its
  own — and the sidebar header, the natural home for anything app-wide, had no
  settings entry at all.

## The decided model

**Two surfaces, split by scope.**

| Surface | Opens from | Holds |
|---|---|---|
| **Project Settings** | the sliders button at the foot of the sidebar rail | Workflow — Spec-Driven Development, Git sharing, Remove Frame |
| **Frame Settings** | the gear at the right end of the sidebar header | Privacy & Analytics, About / updates |

**The marks must differ**, or the split only moves the confusion. The gear goes
**up**: it means application preferences everywhere else, so it belongs to the
app-wide surface. The project's scope takes `SlidersHorizontal` — tuning this
one thing rather than the program.

**Every other entry point is re-pointed by scope.** `Cmd+,`, the app menu's
Settings item (`IPC.OPEN_SETTINGS`) and the telemetry notice all go to Frame
Settings; so do the sidebar's update dot and banner, which already led into
About. The palette's single "Open Settings" becomes **Frame Settings** and
**Project Settings**.

`Cmd+,` goes to Frame Settings because that is what it means in every other
application on the platform. Project Settings gets no shortcut.

### Added after the split — the launch project

Frame selects `projects[0]` when nothing is active yet (`projectListUI.js`
`renderProjects`), and nothing restores the previous session's project. So the
front of the workspace list **is** the default project, always — and there is no
way to change it: the list became a switcher dropdown and its drag-to-reorder
went with it.

Project Settings gains a row for it, because which project Frame opens is a
property of this project's place in the workspace, not of Frame itself:

- **Below two projects the row is hidden outright.** With one project there is
  no choice to make, and a control that can only confirm what is already true is
  furniture.
- **When this project is already first**, the button is replaced by a
  `✓ Default` chip and the copy states it: *"This project is your default.
  Frame opens it every time it launches."* That sentence is the row's real
  value; nothing else in the interface tells you which project launch will pick.
- **Otherwise** the copy asks — *"Frame opens your default project when it
  launches. Make this the default to land here every time."* — and a
  **Make Default** button moves it to the front.

The copy is state-dependent rather than one static line, because asking someone
to make something the default it already is reads as a no-op row.

Neither state's copy mentions that the list cannot be reordered. The missing
reorder is why the row exists; it is not something the user needs to be told
about, and naming it makes a working control read as an apology.

No new storage and no new channel: `REORDER_WORKSPACE_PROJECTS` already exists
and keeps every other project's relative order.

### Added on the way out — the app's own icon

Frame shipped with Electron's default icon in the dock, and the sidebar header
wore an anonymous green square. Both are the same omission: the product had a
mark (`assets/logo.png` has always framed its bear in four corner brackets) and
was not using it.

The brackets alone become the mark. `assets/frame-mark.svg` is the source —
24×24, `currentColor`, so a caller sets size and colour. From it:

- **The app icon**, parchment `#f2eee4` on warm charcoal `#14120e` — the same
  two colours `assets/logo.png` uses — inside the macOS rounded-rect body
  (824/1024 with a 185 radius). The supplied artwork was a hard-edged black
  square; a square in the dock reads as a broken icon next to every other
  application, so the shape is Apple's and only the mark is the file's.
- **The sidebar header glyph**, at 15px in `--accent-primary`, with no glow —
  the shape carries the identity and a halo on a glyph that small only muddies
  it.

`build/` holds electron-builder's input; the runtime copy lives in `assets/`
because `build/` is not shipped inside the app, so `app.dock.setIcon` would have
reached for a file that is not there in a packaged build.

## Constraints

- **C1 — the two must not stack.** The buttons sit behind the backdrop while a
  dialog is up, but `Cmd+,` does not. Opening one closes the other; a settings
  dialog over a settings dialog is a state the user backs out of twice.
- **C2 — each overlay's `×` closes only its own.** The previous module bound
  `[data-settings-close]` document-wide, which with two overlays would have
  crossed the wires.
- **C3 — re-read on open.** Each surface reloads its own values when shown, so
  a panel never displays a state the disk has moved past.
- **C5 — the reorder channel sends no echo.** Main deliberately skips
  `WORKSPACE_UPDATED` after a reorder (it was built for drag, where re-rendering
  mid-gesture fights the user), so the renderer's own order must be updated in
  the same call or the switcher keeps showing the old one.
- **C4 — a surface that fails to bind must say so.** A settings button that
  silently does nothing is found by clicking it (audit-q3-ux-error-feedback).

## Out of scope

- The contents of any setting. Nothing was added, removed or re-worded; only
  the container changed.
- The no-project state. Project Settings still opens with inert rows explaining
  why, exactly as before. Disabling the button instead was raised and deferred.

## Decisions explicitly reversed

- **`project-settings` (2026-07-30)** — Git sharing and Spec-Driven were made
  real per-project choices there, and placed in the one Settings modal. The
  choices stand; only their address changes. That spec's folder is missing from
  the archive (only `status.json.bak` survives), so this is recorded from the
  code rather than from its outcome.

## Alternatives considered and rejected

- **One modal with two tabs.** Less work and one code path, but a tab is one
  click from the other scope, so "the sidebar's button holds only project
  settings" would not have been true.
- **Making the whole "Frame v2.6.0" header text clickable.** No new icon, so no
  icon confusion — but nothing about it reads as clickable.
- **A dropdown menu in the header** (Settings, Check for Updates, Open Logs).
  Room to grow, but with today's contents it is an extra click for nothing.
- **Leaving the gear at the rail's foot and putting sliders in the header.**
  Rejected: it puts the app-preferences mark on the project scope, which is
  backwards from every other application the user has open.
