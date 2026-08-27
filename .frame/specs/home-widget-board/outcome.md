## T01 — homeData.js, the single subscription layer

Added `src/renderer/home/homeData.js` owning all six Home sources (`lanes`,
`specs`, `tasks`, `git`, `sessions`, `aiTool`) behind an idempotent `init()`,
exposing `subscribe`/`get`/`refresh` plus a host-only `setHostState()` that
feeds the terminal list in and re-fetches on project change. Two additions
beyond `plan.md`: `setAiTool()` and `reloadSessions()` live here rather than in
a widget, because S6 forbids a widget touching `ipcRenderer` and D5 named the
channels without saying who would call them. `laneBoard.js` is untouched so
far — T02–T04 move it onto this layer.

_Captured: 2026-08-27 · 1 file change(s)_

---
## T02 — registry.js and widgetShell.js, the widget contract

Added `src/renderer/home/registry.js` — the contract documented in full, the
ordered `WIDGETS` list, `resolveLayout()` and a `sourcesFor()` helper the board
will subscribe from — and `src/renderer/home/widgetShell.js`, the card shell
lifted from `LaneBoard._card()` with the header and footer made optional.
Deviation from `plan.md`: `WIDGETS` ships **empty**, because naming widget
modules before they exist would leave a commit that cannot be required; T03,
T07 and T10 each add their own line, which is the one-line cost S5 promises.
The shell keeps the `home-card*` class names verbatim so the existing
stylesheet still carries the cards until T04.

_Captured: 2026-08-27 · 2 file change(s)_

---
## T03 — Specs and Tasks move onto the widget contract

Added `home/widgets/activeSpecs.js` and `activeTasks.js` carrying
`_updateSpecsCard` / `_updateTasksCard` / `_wireTaskCard` over verbatim,
registered both, and rewired `laneBoard.js` to resolve a layout, mount widgets
into the Project planning group and subscribe **once per source** instead of
once per card — which cost the board every `ipcRenderer` listener it had, and
with them the `electron` and `ipcChannels` imports. Two deviations from
`plan.md`: the shared card furniture (`statsHtml`/`tally`/`moreHtml`/
`MAX_ROWS`) went into `widgetShell.js` rather than a new module, keeping the
plan's Files list intact; and `_buildTerminalsCard` now calls `widgetShell()`
so `_card()` could be deleted here rather than shadow it until T05. Nothing
user-visible changed — still two groups, still the Terminals card.

_Captured: 2026-08-27 · 5 file change(s)_

---
## T04 — Flat `.home-grid` replaces the two-group layout

Replaced `.home-group` / `.home-group-title` / `.home-cards` /
`.home-cards-solo` and the `@container (max-width: 699px)` override with one
`.home-grid` on `repeat(auto-fill, minmax(320px, 1fr))`, moved the 232px floor
onto `.home-card`, and rewrote `mount()` to build a single grid — `_buildGroup`
is gone. `auto-fill` does what the container query did by hand, so the
responsive branch disappeared rather than being ported. Beyond `plan.md`: the
no-project branch now disposes the previous mount's widgets and clears
`_layout`, otherwise they keep live subscriptions and detached DOM behind the
no-project state.

_Captured: 2026-08-27 · 2 file change(s)_

---
