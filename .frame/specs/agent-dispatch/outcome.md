# Outcome — Agent Dispatch — lane-aware task & spec runs

## T01 — Create `src/renderer/agentDispatch.js` with `dispatch()`

Created `agentDispatch.js` with `dispatch({ terminalId, createNew, toolId, prompt, assignment })`: resolves the target lane (validates existing ids via `manager.getTerminal`, creates new Frames with a cap-aware error toast), enters the lane, pre-flights the CLI via `CHECK_AI_TOOL_AVAILABLE` when no agent is detected, and injects via `window.terminalSendPromptThenEnter`; wired `agentDispatch.init(this)` into `MultiTerminalUI._setup()` next to `laneStatus.init`. One deliberate stub beyond the plan: `_waitForAgentReady` returns `false` until T02 lands, so a cold-started CLI aborts with a toast instead of risking injection into a bare shell. Toasts replicate the `.tasks-toast` markup locally instead of importing from tasksPanel. Files: `src/renderer/agentDispatch.js` (new), `src/renderer/multiTerminalUI.js`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T02 — Implement the agent-ready wait in `agentDispatch.js`

Replaced the `_waitForAgentReady` stub with a `laneStatus.onChange` subscription that resolves true on `agentName` set + `status === 'agent-input'` for the target lane, with an immediate `getStatus()` pre-check and a 15 s fallback (`AGENT_READY_TIMEOUT_MS`) resolving false → dispatch aborts via the existing error toast. Restructured `dispatch()` to create the wait promise *before* `sendCommand` so a fast CLI can't slip past the listener. One judgment call worth knowing: `agent-approval` does not count as ready — a cold-started CLI stuck on a trust/permission dialog times out rather than receiving the prompt into a y/n chooser. Files: `src/renderer/agentDispatch.js`.

_Captured: 2026-06-12 · 1 file change(s)_

---

## T03 — Add `assignment` field and `setAssignment()` to terminalManager

Added `assignment: null` to the per-terminal state object in `_initializeTerminal` and a `setAssignment(terminalId, assignment)` method (mirrors `renameTerminal`: mutate + `_notifyStateChange`); `dispatch()` records the assignment only after successful injection, so failed dispatches never relabel a lane. No `saveProjectSession` change was needed — it already whitelists fields (`terminalNames` etc.), so assignment is session-only by construction. Files: `src/renderer/terminalManager.js`, `src/renderer/agentDispatch.js`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T04 — Remove the Terminal choice section from the task run modal

Deleted the Terminal radiogroup + "make sure your AI CLI is running" hint from `#task-run-modal` in `index.html`; the CLI section is now always visible with a new one-line hint ("Runs in a new Frame with the selected CLI"). Stripped `taskRunModal.js` of `terminalRadios`/`currentHintEl`/`cliSection`/`getTerminalChoice`/`updateTerminalChoiceUI` and dropped `useNewTerminal` from the confirm payload; branch UI/logic untouched. Until T05 lands, `tasksPanel.runTaskWithOptions` still reads the now-absent `useNewTerminal` (falsy → current-terminal path) — T05 replaces that function wholesale. Files: `index.html`, `src/renderer/taskRunModal.js`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T05 — Rewrite `runTaskWithOptions` on agentDispatch

Replaced the 80-line dual-path function (current-terminal write / `terminalCreateAndStart` + 5 s `setTimeout` inject) with a single `agentDispatch.dispatch({ createNew: true, toolId, prompt, assignment: { kind: 'task', label: task.title, ref: task.id } })` call, lazy-required per the file's idiom. The CLI pre-flight moved into dispatch, so tasksPanel's own `CHECK_AI_TOOL_AVAILABLE` block and its error toasts went with it; `buildTaskPrompt` untouched. The caller-side contract (return boolean → flip status + "Task sent" toast) is unchanged, and the toast now fires only after the prompt actually landed. Files: `src/renderer/tasksPanel.js`.

_Captured: 2026-06-12 · 1 file change(s)_

---

## T06 — Delete `window.terminalCreateAndStart` from terminal.js

Removed the global (tasksPanel was its only consumer after T05); `window.terminalSendPromptThenEnter` and `window.terminalSendCommand` stay. Repo-wide grep confirms zero remaining references; also reworded agentDispatch's header comment which had referenced the now-gone global. Files: `src/renderer/terminal.js`, `src/renderer/agentDispatch.js`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T07 — Implement `dispatchSpecCommand` in agentDispatch.js

Added the spec→lane `Map<slug, terminalId>` (validated against open terminals on read, stale entries dropped), `BUILD_SPEC_COMMAND_FILE` staging with `aiTool: 'claude-code'` as before, and the `_askContinueOrNew` overlay modal (`spec-modal-overlay` idiom; Continue is primary+focused, backdrop/Escape cancel without a toast). Staging runs before the modal so a staging failure never shows the question; successful new-Frame runs overwrite the map entry (old lane unassigned, never closed). Lane label is baked as `spec: <slug>` so renderers stay dumb; the optional `title` is used only in modal copy. Files: `src/renderer/agentDispatch.js`.

_Captured: 2026-06-12 · 1 file change(s)_

---

## T08 — Migrate the three `runSpecCommand` call sites

specPanel, specSection and specsDashboard now delegate to `agentDispatch.dispatchSpecCommand({ slug, title, command })` — each kept its own slug/title source, everything else (staging, terminal targeting, error surfacing) moved into dispatch. Dropped specSection's `host.hideSections()` since dispatch's `enterLane` already takes the section off screen, and specPanel's inline staging errors are now dispatch toasts. `BUILD_SPEC_COMMAND_FILE` is invoked from exactly one place. Files: `src/renderer/specPanel.js`, `src/renderer/specSection.js`, `src/renderer/specsDashboard.js`.

_Captured: 2026-06-12 · 3 file change(s)_

---

## T09 — Render the assignment label on lane cards

Added a `lane-card-assignment` row to `laneBoard._renderCard` (ClipboardList lucide icon + ellipsis-truncated label, full label in the tooltip), shown only when `t.assignment` is set; styles mirror the branch chip. No live-update wiring was needed — `setAssignment` triggers `_notifyStateChange` → full board re-render. Files: `src/renderer/laneBoard.js`, `src/renderer/styles/components/lane-board.css`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T10 — Render the assignment label on rail items

Added an optional third `lane-rail-item-row` to `laneDetailRail` items with the same label (text-only, no icon — the rail is tighter), `lane-detail-item-assignment` styles alongside the existing rail item rules. Files: `src/renderer/laneDetailRail.js`, `src/renderer/styles/components/lane-board.css`.

_Captured: 2026-06-12 · 2 file change(s)_

---

## T11 — Register `renderer/agentDispatch` in STRUCTURE.json

Ran `npm run structure` (the canonical generator) instead of hand-editing: STRUCTURE.json now lists `renderer/agentDispatch` (exports `init`/`dispatch`/`dispatchSpecCommand`) and `node scripts/find-module.js dispatch` resolves the new module via the `agent-dispatch` intentIndex entry. Files: `STRUCTURE.json` (generated).

_Captured: 2026-06-12 · 1 file change(s)_

---

## Addendum — killed agent read "Awaiting input" forever

User killed claude inside a dispatched Frame and the lane stayed `agent-input`: the buffer-fingerprint fallback in `laneStatus._isAgentMode` matched the dead agent's leftover TUI frame in the last 15 lines. Fixed by scoping the fallback to inconclusive foregrounds only — when a known shell owns the terminal, on-screen agent remnants are ignored and the lane classifies `idle` on the next process poll. Wrapper-process detection (non-shell foreground + fingerprints) verified unchanged. Files: `src/renderer/laneStatus.js`.

_Captured: 2026-06-12 · 1 file change(s)_

---

## Addendum — task run had no reachable entry point

User caught post-implementation that the lane orchestrator had already retired the tasks side panel (nothing sends `TOGGLE_TASKS_PANEL`), so the only ▶ → run-modal path was unreachable and taskSection's "Start Working" only flipped status. Extracted the modal+dispatch flow into an exported `tasksPanel.openRunFlow(task)` and pointed taskSection's `start` action at it (other actions unchanged; `handleAction` now takes the task object). Scope decision: detail screen only — rail/dashboard ▶ buttons deliberately skipped for now. Files: `src/renderer/tasksPanel.js`, `src/renderer/taskSection.js`.

_Captured: 2026-06-12 · 2 file change(s)_

---
