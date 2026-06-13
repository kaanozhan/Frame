# Plan — Agent Dispatch — lane-aware task & spec runs

## Architecture

### 1. `agentDispatch.js` — the single choke point

New renderer module. Initialized from `MultiTerminalUI._setup()` with the
`MultiTerminalUI` instance (same idiom as `laneStatus.init(this.manager)`), so
it never `require`s terminal.js and avoids the circular-dependency dance that
forced the `window.terminalCreateAndStart` global.

Core API:

```js
// Deliver a prompt to an agent in a lane. Resolves { success, terminalId, error }.
async function dispatch({
  terminalId,        // existing lane to target, or null
  createNew,         // true → create a new Frame (per-project cap respected)
  toolId,            // AI CLI to start if none is running (default: aiToolSelector.getCurrentTool().id)
  prompt,            // text to inject once the agent is ready
  assignment         // { kind: 'task'|'spec', label, ref } — lane card metadata
})

// Spec-specific wrapper: assignment lookup + continue/new question +
// BUILD_SPEC_COMMAND_FILE staging, then dispatch() with the instruction.
async function dispatchSpecCommand({ slug, title, command })
```

`dispatch()` flow:

1. **Resolve target lane.** `createNew` → `multiTerminalUI.createTerminalForCurrentProject()`;
   `null` return means the per-project cap was hit → error toast
   ("Maximum frames reached for this project"), abort. Existing `terminalId`
   → validate it's still open.
2. **Enter the lane** (`multiTerminalUI.enterLane`) so the user watches the
   dispatch land — satisfies "user ends up inside that Frame".
3. **Agent check.** `laneStatus.getStatus(terminalId).agentName`:
   - Agent already detected → skip straight to injection (the input box
     exists; an `agent-working` agent queues the prompt like a human typing).
   - No agent → pre-flight `CHECK_AI_TOOL_AVAILABLE` (same call tasksPanel
     makes today; missing CLI → error toast, abort), send the
     `resolvedCommand` to the lane via `multiTerminalUI.sendCommand(cmd, terminalId)`,
     then **wait for the agent-ready signal**.
4. **Agent-ready signal.** Subscribe `laneStatus.onChange` *before* sending
   the start command; resolve when an event for the target terminal has
   `agentName` non-null **and** `status === 'agent-input'` (agent settled at
   its input box). Also check `getStatus()` once immediately after
   subscribing in case the state was already reached. Fallback timeout
   **15 s** → unsubscribe, error toast ("<tool> didn't become ready — prompt
   not sent"), resolve `{ success: false }`. The prompt is never written to a
   bare shell.
5. **Inject** via the existing `window.terminalSendPromptThenEnter(prompt, terminalId)`
   — text-then-Enter mechanics untouched.
6. **Record assignment** on the lane (below). Most recent dispatch wins.

Toasts reuse the existing `.tasks-toast` CSS classes with a local helper
(same markup tasksPanel renders); no cross-module import needed.

`multiTerminalUI.sendCommand`'s other consumers (Cmd+K/Cmd+I accelerators,
Discuss flow) are not touched.

### 2. Assignment state

Two pieces, deliberately separate:

- **Lane label (presentation).** New optional field on the per-terminal state
  object in `terminalManager._initializeTerminal` —
  `assignment: { kind: 'task'|'spec', label, ref } | null` — plus a
  `setAssignment(terminalId, assignment)` method that mutates it and calls
  `_notifyStateChange()`. It lives and dies with the Map entry, so closing a
  lane clears it for free, and `getTerminalStates()` already spreads the
  whole state so the board/rail receive it without further plumbing.
  Session-scoped: it is *not* added to `saveProjectSession`.
- **Spec → lane mapping (functional).** `Map<slug, terminalId>` private to
  `agentDispatch.js`. Read-validated against open terminals: if the mapped
  lane no longer exists, the spec is treated as unassigned. Kept separate
  from the label because a later task dispatch may overwrite a lane's label
  while the spec assignment must survive.

### 3. Spec run flow (`dispatchSpecCommand`)

1. Look up the slug's assigned lane (validated).
2. **No assigned lane** → create a new Frame via `dispatch({ createNew })`,
   record the assignment. No question asked.
3. **Assigned lane alive** → always show a small choice modal (built inline
   with the existing `spec-modal-overlay` idiom, like specPanel's rename
   modal): **"Continue in \<Frame name\>"** (default/focused) vs **"Open a
   new Frame"** vs Cancel. Continue → `dispatch({ terminalId })` — if the
   agent exited, step 3 of dispatch restarts it. New → `dispatch({ createNew })`
   and the map entry is overwritten (old lane unassigned, not closed).
4. Prompt staging unchanged: `BUILD_SPEC_COMMAND_FILE` with
   `aiTool: 'claude-code'` exactly as the three current call sites do; the
   returned short `instruction` is what gets dispatched.

All three existing `runSpecCommand` implementations (specPanel, specSection,
specsDashboard) collapse into calls to `dispatchSpecCommand`. specSection
keeps its `host.hideSections()` behavior (redundant after `enterLane`, but
harmless — drop it during migration since `enterLane` already clears the
section surface).

### 4. Task run flow

- `taskRunModal` loses the Terminal section (radios + "make sure your AI CLI
  is running" hint); the CLI section is always visible. Branch UI/logic
  byte-for-byte unchanged.
- `tasksPanel.runTaskWithOptions` becomes: `buildTaskPrompt(task, opts)`
  (unchanged) → `agentDispatch.dispatch({ createNew: true, toolId: opts.toolId,
  prompt, assignment: { kind: 'task', label: task.title, ref: task.id } })`.
  The CLI pre-flight moves inside dispatch; the 5 s `setTimeout` and the
  `useNewTerminal` branch are deleted. Status flip to `in_progress` still
  happens only on `success: true`.
- `window.terminalCreateAndStart` (terminal.js) is retired — tasksPanel was
  its only consumer. `window.terminalSendPromptThenEnter` stays.

### 5. Lane cards / switcher labels

- `laneBoard._renderCard`: one assignment line per card when
  `t.assignment` is set — `spec: <slug>` or the truncated task title (CSS
  `text-overflow: ellipsis`), with a small lucide icon. Updated on full board
  re-render (a dispatch triggers `_notifyStateChange` → board re-renders).
- `laneDetailRail`: same label compressed into the rail item rows (reads
  `t.assignment` from `lastState.terminals`).

## Files

- **New** `src/renderer/agentDispatch.js` — dispatch layer: target resolution, agent-ready wait, injection, spec assignment map, continue/new-Frame modal, toasts.
- **Modified** `src/renderer/terminalManager.js` — `assignment` field on terminal state + `setAssignment()`.
- **Modified** `src/renderer/multiTerminalUI.js` — `agentDispatch.init(this)` in `_setup()`.
- **Modified** `src/renderer/terminal.js` — remove `window.terminalCreateAndStart`.
- **Modified** `src/renderer/tasksPanel.js` — `runTaskWithOptions` rebuilt on dispatch; blind timeouts deleted.
- **Modified** `src/renderer/taskRunModal.js` — drop terminal-choice state/handlers; CLI section always shown; `useNewTerminal` removed from the options payload.
- **Modified** `index.html` — remove the Terminal radiogroup + hint from `#task-run-modal`.
- **Modified** `src/renderer/specPanel.js` — `runSpecCommand` delegates to `dispatchSpecCommand`.
- **Modified** `src/renderer/specSection.js` — same migration.
- **Modified** `src/renderer/specsDashboard.js` — same migration.
- **Modified** `src/renderer/laneBoard.js` — assignment label on lane cards.
- **Modified** `src/renderer/laneDetailRail.js` — assignment label on rail items.
- **Modified** `src/renderer/styles/components/lane-board.css` — card + rail assignment label styles.
- **Modified** `STRUCTURE.json` — register `renderer/agentDispatch` module (pre-commit hook normally handles this; verify the intentIndex entry).

## Dependencies

None — everything builds on existing renderer modules and IPC channels
(`TERMINAL_INPUT_ID`, `BUILD_SPEC_COMMAND_FILE`, `CHECK_AI_TOOL_AVAILABLE`).

## Sequencing

1. **Dispatch core.** Create `agentDispatch.js` with `dispatch()` (existing +
   new lane targets, CLI pre-flight, agent-ready wait with 15 s fallback,
   injection, error toasts) and wire `init` from `multiTerminalUI._setup()`.
   Nothing calls it yet — shippable as dead code with no behavior change.
2. **Assignment metadata.** Add `assignment` + `setAssignment()` to
   `terminalManager`; `dispatch()` records it after successful injection.
3. **Task run on dispatch.** Strip the Terminal section from `index.html` +
   `taskRunModal.js`; rewrite `tasksPanel.runTaskWithOptions` to call
   `dispatch({ createNew: true, ... })`; delete the timeout path and
   `window.terminalCreateAndStart`. Verify branch options and `buildTaskPrompt`
   are untouched (success criterion 7).
4. **Spec run on dispatch.** Implement `dispatchSpecCommand` (assignment map +
   continue/new modal) and migrate the three `runSpecCommand` call sites.
5. **Lane card / rail labels.** Render `t.assignment` in `laneBoard` and
   `laneDetailRail`, add CSS.
6. **Docs.** Confirm `STRUCTURE.json` picked up the new module + verify no
   stale `terminalCreateAndStart` references remain.
