# Outcome — terminals-view

Shipped 2026-08-20. All acceptance criteria verified live (Playwright-driven
app run + screenshots) and the full test suite passes (222).

## What shipped

- **`terminalsView.js` (new)** — the project's default center view: every
  terminal of the current project as a live xterm pane in an N-column grid.
  Layout bar (1/2/3 columns), drag-header reorder with dropover highlight,
  ⤢ maximize / ❐ back-to-grid, CSS `resize: vertical` panes refit via a
  debounced ResizeObserver, "+ New terminal" ghost pane (hidden at the 9
  cap), empty state with create CTA. Prefs `{cols, order, maximizedId}`
  persist per project under localStorage `frame-terminals-view`; saved order
  is normalized against open terminals (dead ids dropped, new appended).
  Status dots + agent labels update in place via `laneStatus.onChange` — no
  remounts, no new polling.
- **Routing** — new viewMode `'terminals'`; `TerminalManager.setCurrentProject`
  always lands on it (restored session viewMode no longer survives a project
  switch — deliberate). Closing the last detail lane falls back to the
  terminals view, not the board. Board stays reachable via Home.
- **Sidebar workspace nav** — `Terminals (n)` block under the selected project
  (projectListUI), count and active highlight refreshed from
  `multiTerminalUI._onStateChange` (lazy require; no polling). Click →
  `showTerminals()`.
- **Naming sweep** — user-facing "Frame" (work-stream sense) → "Terminal":
  default names (`Terminal N`), tab labels/fallbacks, board empty state and
  card actions, detail-rail titles, dispatch/implement modal buttons, error
  toasts. Product-name "Frame" and "Frame project" untouched. laneBoard's
  naming-convention comment rewritten to record the reversal.
- **CSS** — `terminals-view.css` in the prototype's language (panes darker
  than chrome at `#0a0908`, compact bar, dashed ghost) + workspace-nav styles.

## Decisions of record

- **Overturns lane-orchestrator's "user-facing = Frame" rule** — user-facing
  is now "Terminal"; code/DOM ids keep "lane"/"tv".
- **Demotes the board as landing view** — project selection always lands on
  terminals; the board and detail views remain reachable (Home, tab-bar
  terminal tabs) and their code is untouched. Removing them is explicitly a
  later decision.
- Tab bar's `onFrames` highlight now means `viewMode === 'detail'` only.

## Follow-up (same day)

- Pane headers gained inline **rename** (pencil button / double-click name,
  Enter commits, Escape reverts; header drag suspended while editing) and the
  **scroll-to-bottom** overlay button (reuses `.btn-scroll-bottom-overlay`).
  Live-verified: rename propagates to the tab bar; Escape leaves the name
  untouched.

## Known gaps / later steps

- Drag-reorder persistence was code-verified but not exercised in the live
  run (HTML5 drag is awkward to synthesize); logic mirrors the prototype's.
- Report templates and `agentPanel`/`agentDispatch` comments still say Frame
  (non-user-facing).
- Sidebar nav has a single entry; Specs/Tasks entries and the fate of the
  right-side panels are the next redesign steps.
