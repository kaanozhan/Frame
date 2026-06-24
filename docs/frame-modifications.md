# Frame modifications ledger (supervisor-integration fork)

Every modification to a tracked Frame source file (not new files in
`src/main/supervisor-bridge/`, `src/renderer/supervisor-ui/`, or
`src/shared/supervisor-ipc.js` — those are additive and don't need tracking)
gets a row here. The `marker count` column is verified by
`scripts/check-supervisor-mods.sh` on every commit. Mismatch = upstream rebase
silently dropped one of our edits.

## Phase A — Skeleton (2026-06-23, Frame @ d324153)

### Q1 resolution

Spec §9 Q1 asked: "Do we add the `supervisor` section type via a registration
call in `multiTerminalUI.js` (1 supervisor-mod line), or is `openSection`
generic enough that no registration is needed?"

**Resolution: no-mod.** `src/renderer/multiTerminalUI.js:217` defines
`openSection(type, itemRef, factory, { newTab })`. `type` is opaque — at
lines 222-224 it is used only for "find existing viewport of same type"
matching against `this.sections`. There is no dispatch table, switch, or
enum. The caller supplies a `factory` module exposing `createViewport()` that
returns a viewport object with `{type, key, viewClass, navigate, getChip,
render, dispose}`. Our `src/renderer/supervisor-ui/` module is that factory,
and the host is acquired via the existing `terminal.getMultiTerminalUI()`
accessor (same pattern used by built-in commands such as `lane.home` /
`terminal.new` in `src/renderer/index.js:639,651,665,675,685,696`). Result:
zero modifications to `multiTerminalUI.js` for Phase A.

### Modifications

| Date | Frame upstream SHA | File | Lines added | Rationale | Marker grep count |
|---|---|---|---|---|---|
| 2026-06-23 | d324153 | `src/main/index.js` | 1 | Register supervisor-bridge IPC channels (Phase A) | 1 |
| 2026-06-23 | d324153 | `src/renderer/index.js` | 1 | Init supervisor-ui (Phase A) | 1 |
| 2026-06-23 | d324153 | `src/renderer/projectSection.js` | 1 | Mount projects-sidebar Supervisor entry (Phase G) | 1 |
| 2026-06-23 | d324153 | `src/renderer/laneBoard.js` | 1 | Mount home-tab Supervisor card (Phase G) | 1 |

## Notes

- 2026-06-23 — Phase L removed sidebarChip (orphan visual; heartbeat dot now lives only on Phase G's top-of-sidebar entry).

## Discipline budget consumed

- **Modified Frame source files:** 4 / 5
- **Modified Frame source lines:** 4 / 15

Well under the ceiling — see `docs/frame-edit-discipline.md` for the budget
and rationale. Everything else (the supervisor-bridge / supervisor-ui / IPC
shared subtree) is additive and doesn't appear here.
