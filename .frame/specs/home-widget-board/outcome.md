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
