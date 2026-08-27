# Outcome — Settings by scope — the project's, and Frame's own

## T01–T07 — The split

One gear at the foot of the sidebar rail opened one modal holding both kinds of
setting, so "Remove Frame from this project" sat a scroll away from "Send
anonymous usage stats" as though they were the same kind of choice. They are
not: one writes into the open project's `.frame/` and dies with it, the other is
true of this machine whichever project is open.

Two surfaces now. **Project Settings** keeps the Workflow section — Spec-Driven
Development, Git sharing, Remove Frame — and opens from the rail's foot, where
the old gear was. **Frame Settings** holds Privacy & Analytics and About, and
opens from a new button at the right end of the sidebar header, beside the
update dot that already led into About.

The marks had to differ or the split would only move the confusion. The gear
went up: it means application preferences everywhere else, so it belongs to the
app-wide surface. The project's scope wears `SlidersHorizontal` instead.

`settingsModal.js` (506 lines) became three modules — one per surface, plus
`settingsOverlay.js` for the box they share: backdrop, `×`, Escape, re-read on
open. The overlay layer also keeps the two from stacking (C1): the buttons are
behind the backdrop while a dialog is up, but `Cmd+,` is not. Close buttons are
queried within the overlay element rather than document-wide (C2), which with
two overlays would otherwise have crossed the wires.

Every other entry point was re-pointed by scope: `Cmd+,`, the app menu's
Settings item and the telemetry notice go to Frame Settings; the update dot and
banner go there too, into About. The palette's single "Open Settings" became
"Frame Settings" and "Project Settings".

One quieter thread: `specDrivenHint` anchors its popover on the button whose
modal holds the switch it describes. That button is now Project Settings, so
`ANCHOR_ID` moved with it — otherwise the hint would have pointed at a gear that
no longer opens what it was talking about.

_Captured: 2026-08-26 · 9 file changes_

---

## T08 — The launch project

Frame selects `projects[0]` when nothing is active yet, and nothing restores the
previous session's project — so the front of the workspace list **is** the
default project, always. There was no way to change it: the project list became
a switcher dropdown and its drag-to-reorder went with it.

Project Settings gains a row for it, because which project Frame opens is a
property of this project's place in the workspace. Below two projects the row is
hidden outright — with one project there is no choice to make, and a control
that can only confirm what is already true is furniture. When this project is
already first, the button is replaced by a `✓ Default` chip and the copy states
it. Otherwise a **Make Default** button moves it to the front.

Two things the implementation had to know. `REORDER_WORKSPACE_PROJECTS` keeps
every path it is not told about in its existing relative order, so moving one
project to the front is the whole message. And main deliberately sends no
`WORKSPACE_UPDATED` echo for a reorder — it was built for drag, where
re-rendering mid-gesture fights the user — so `setDefaultProject` updates the
renderer's own order, or the switcher keeps showing the old one until a reload.

The copy is state-dependent rather than one static line: asking someone to make
something the default it already is reads as a no-op row. Neither state mentions
that the list cannot be reordered — the missing reorder is why the row exists,
not something the user needs told, and naming it makes a working control read as
an apology.

_Captured: 2026-08-27 · 4 file changes_

---

## T09 — Frame gets its own icon

Frame shipped with Electron's default icon in the dock, and the sidebar header
wore an anonymous green square. Both are the same omission: the product had a
mark — `assets/logo.png` has always framed its bear in four corner brackets —
and was not using it.

The brackets alone became the mark. `assets/frame-mark.svg` is the source
(24×24, `currentColor`, so a caller sets size and colour). From it: the app icon
in parchment `#f2eee4` on warm charcoal `#14120e` — the two colours the existing
logo uses — inside the macOS rounded-rect body (824/1024, radius 185); and the
sidebar header glyph at 15px in `--accent-primary`, with no glow, because the
shape carries the identity and a halo on a glyph that small only muddies it.

The supplied artwork was a hard-edged black square. A square in the dock reads
as a broken icon next to every other application, so the shape is Apple's and
only the mark is the file's. The icon was generated with a dependency-free PNG
encoder (the mark is pure rectangles) at 4096, downsampled by `sips` for the
antialiasing, and assembled with `iconutil`.

Both icons live in `assets/`, not `build/`: `build/` is gitignored, so an icon
path under it is missing on any fresh clone and packaging would have failed
away from this machine. `package.json` gained `mac`/`win`/`linux` icon paths —
there was no `icon` key at all before, which is why the default appeared — and
`app.dock.setIcon` covers running unpackaged, where the bundle's icns does not
apply yet.

_Captured: 2026-08-27 · 6 file changes_

---

## Status

Complete on `feat/terminals-home-agents`; **not merged**. Recorded after
implementation — the spec offer was declined for the split itself, and T08/T09
were asked for directly in the same session.

Files touched are the plan's `## Footprint`.
