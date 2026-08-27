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
